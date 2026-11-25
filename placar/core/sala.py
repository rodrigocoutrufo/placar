"""Sala do jogo: a resenha de cada partida (antes, durante e depois).

- Bate-papo: ler é livre; escrever precisa de conta. Mensagens curtas, sem links, palavrão disfarçado com asteriscos e
  ofensa racista/homofóbica recusada. Três denúncias escondem a mensagem; quem escreveu pode apagar a sua.
- Reações rápidas (🔥 😂 😡 👏 😱): o "termômetro da torcida" do último minuto. Não precisam de conta (limite por IP).
- Enquetes automáticas puxadas pelos lances (gol, cartão vermelho, pênalti perdido, gol anulado, intervalo) e o
  "quem vence?" antes do jogo. Votar também não precisa de conta (um voto por pessoa).
- Nota da torcida: depois do jogo, de 1 a 10 para cada jogador que entrou em campo (precisa de conta); sai o craque.
- Tempo real: um canal por partida (GET /api/sala/{id}/eventos, Server-Sent Events) — cada pessoa só recebe a sala
  em que está. As tabelas ficam no mesmo banco das contas (contas.db).
"""

import hashlib
import json
import queue
import re
import threading
import time
import unicodedata
from collections import Counter, deque

from . import auth

fetch_match = None  # ligado em server.py: pid -> partida completa (com escalações) ou None
EMOJIS = ["🔥", "😂", "😡", "👏", "😱"]
MAX_TEXT, PAGE = 280, 60
NOTAS_DIAS = 7  # dá para dar nota até 7 dias depois do jogo
MIN_VOTOS_CRAQUE = 3

with auth._lock:
    auth._db.executescript("""
    CREATE TABLE IF NOT EXISTS sala_msgs (
      id INTEGER PRIMARY KEY, partida_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      texto TEXT NOT NULL, criado REAL NOT NULL, oculta INTEGER NOT NULL DEFAULT 0, denuncias INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS sala_msgs_partida ON sala_msgs(partida_id, id);
    CREATE TABLE IF NOT EXISTS sala_denuncias (
      msg_id INTEGER NOT NULL REFERENCES sala_msgs(id) ON DELETE CASCADE, user_id INTEGER NOT NULL, PRIMARY KEY (msg_id, user_id));
    CREATE TABLE IF NOT EXISTS sala_enquetes (
      id INTEGER PRIMARY KEY, partida_id INTEGER NOT NULL, chave TEXT NOT NULL, pergunta TEXT NOT NULL, opcoes TEXT NOT NULL,
      criada REAL NOT NULL, fecha REAL NOT NULL, UNIQUE (partida_id, chave));
    CREATE TABLE IF NOT EXISTS sala_votos (
      enquete_id INTEGER NOT NULL REFERENCES sala_enquetes(id) ON DELETE CASCADE, eleitor TEXT NOT NULL, opcao INTEGER NOT NULL,
      PRIMARY KEY (enquete_id, eleitor));
    CREATE TABLE IF NOT EXISTS sala_notas (
      partida_id INTEGER NOT NULL, atleta_id INTEGER NOT NULL, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      nota INTEGER NOT NULL, quando REAL NOT NULL, PRIMARY KEY (partida_id, atleta_id, user_id));
    """)


class Err(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status, self.message = status, message


# ================================================================ tempo real: um canal por sala
class RoomHub:
    MAX_PER_ROOM, MAX_TOTAL = 2000, 5000

    def __init__(self):
        self.rooms: dict[int, set] = {}
        self.lock = threading.Lock()

    def total(self):
        return sum(len(s) for s in self.rooms.values())

    def subscribe(self, pid: int):
        with self.lock:
            if self.total() >= self.MAX_TOTAL or len(self.rooms.get(pid, ())) >= self.MAX_PER_ROOM:
                return None
            q = queue.Queue(maxsize=200)
            self.rooms.setdefault(pid, set()).add(q)
        self.publish(pid, "online", {"online": self.online(pid)})
        return q

    def unsubscribe(self, pid: int, q):
        with self.lock:
            s = self.rooms.get(pid)
            if s:
                s.discard(q)
                if not s:
                    self.rooms.pop(pid, None)
        self.publish(pid, "online", {"online": self.online(pid)})

    def online(self, pid: int) -> int:
        return len(self.rooms.get(pid, ()))

    def publish(self, pid: int, event: str, data):
        msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()
        with self.lock:
            for q in list(self.rooms.get(pid, ())):
                try:
                    q.put_nowait(msg)
                except queue.Full:  # navegador lento: sai da sala e reconecta sozinho
                    self.rooms[pid].discard(q)


HUB = RoomHub()


# ================================================================ moderação
def _fold(s: str) -> str:
    s = unicodedata.normalize("NFD", s.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"(.)\1{2,}", r"\1\1", s)  # "porrraaa" -> "porraa"


# ofensa a raça, orientação ou deficiência: a mensagem é recusada
BLOCK = [r"macac[oa]s?", r"viad[oa]s?", r"bichas?", r"travec[oa]s?", r"retardad[oa]s?", r"crioul[oa]s?", r"sapat[aã]o",
         r"mongoloide", r"favelad[oa]s?"]
# palavrão comum de arquibancada: fica, mas disfarçado
MASK = [r"porra", r"caralh[oa]", r"merda", r"put[ao]s?", r"fdp", r"filh[oa] da puta", r"arrombad[oa]s?", r"cuzao", r"buceta",
        r"desgracad[oa]s?", r"otari[oa]s?", r"vagabund[oa]s?", r"babac[oa]s?", r"cacete", r"foder", r"fod[ae]", r"fodid[oa]"]
_block_rx = re.compile("(" + "|".join(BLOCK) + ")")
_mask_rx = re.compile("(" + "|".join(MASK) + ")")


def _word_key(w: str) -> str:
    """Palavra para comparar: sem acento, minúscula, sem letra esticada ("porrraaa" -> "porra", "caralhooo" -> "caralho")."""
    k = _fold(w)
    k = re.sub(r"(.)\1+$", r"\1", k)  # repetição no fim vira uma letra
    return re.sub(r"([^rs])\1+", r"\1", k)  # e no meio também (menos rr e ss, que existem em português)
_link_rx = re.compile(r"(https?://|www\.|\b[\w-]+\.(com|net|org|br|io|bet|gg|me|ly)\b)", re.I)


def clean_text(texto) -> str:
    t = re.sub(r"\s+", " ", str(texto or "")).strip()
    if not t:
        raise Err(400, "Escreva alguma coisa.")
    if len(t) > MAX_TEXT:
        raise Err(400, f"Mensagem longa demais (até {MAX_TEXT} caracteres).")
    words = re.findall(r"\w+", t)
    if any(_block_rx.fullmatch(_word_key(w)) for w in words):
        raise Err(400, "Mensagem recusada: ofensa não tem vez na Sala do jogo.")
    if _link_rx.search(t):
        raise Err(400, "Links não são permitidos na sala.")
    if len(re.findall(r"[A-ZÁ-Ú]", t)) > 20 and t.upper() == t:  # tudo em maiúsculas: grito vira fala
        t = t.capitalize()
    # palavrão de arquibancada fica, mas disfarçado: "p****"
    return re.sub(r"\w+", lambda m: m.group(0)[0] + "*" * (len(m.group(0)) - 1) if _mask_rx.fullmatch(_word_key(m.group(0))) else m.group(0), t)


# ================================================================ dados da partida (cache curto)
_match_cache: dict[int, tuple[float, dict]] = {}


def _match(pid: int) -> dict | None:
    hit = _match_cache.get(pid)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        m = fetch_match(pid) if fetch_match else None
    except Exception:  # noqa: BLE001
        m = hit[1] if hit else None
    if m:
        _match_cache[pid] = (time.time() + 60, m)
        if len(_match_cache) > 500:
            _match_cache.clear()
    return m


def _user_pub(u) -> dict:
    return {"id": u["id"], "nome": u["name"] or u["username"], "usuario": u["username"], "avatar": u["avatar"]}


# ================================================================ mensagens
def _msg_out(r, me_id=None) -> dict:
    return {"id": r["id"], "texto": r["texto"], "quando": r["criado"], "minha": me_id == r["user_id"],
            "autor": {"id": r["user_id"], "nome": r["nome"] or r["username"], "usuario": r["username"], "avatar": r["avatar"]}}


def messages(pid: int, me_id=None, antes: int | None = None) -> list:
    rows = auth.q("""SELECT m.*, u.name AS nome, u.username, u.avatar FROM sala_msgs m JOIN users u ON u.id = m.user_id
                     WHERE m.partida_id=? AND m.oculta=0 AND (? IS NULL OR m.id < ?) ORDER BY m.id DESC LIMIT ?""",
                  (pid, antes, antes, PAGE))
    return [_msg_out(r, me_id) for r in reversed(rows)]


def post_message(pid: int, u, texto, ip: str) -> dict:
    t = clean_text(texto)  # primeiro valida: mensagem recusada não gasta a vez de quem vai corrigir o texto
    if not auth.LIMIT.allow(f"sala:msg:{u['id']}", 1, 3) or not auth.LIMIT.allow(f"sala:msgmin:{u['id']}", 15, 60):
        raise Err(429, "Calma! Espera uns segundos para mandar outra.")
    if not auth.LIMIT.allow(f"sala:msgip:{ip}", 40, 60):
        raise Err(429, "Muitas mensagens deste endereço. Aguarde um instante.")
    last = auth.q("SELECT texto FROM sala_msgs WHERE partida_id=? AND user_id=? ORDER BY id DESC LIMIT 1", (pid, u["id"]), one=True)
    if last and _fold(last["texto"]) == _fold(t):
        raise Err(400, "Você acabou de mandar essa mesma mensagem.")
    now = time.time()
    mid = auth.x("INSERT INTO sala_msgs(partida_id, user_id, texto, criado) VALUES (?,?,?,?)", (pid, u["id"], t, now)).lastrowid
    msg = {"id": mid, "texto": t, "quando": now, "autor": _user_pub(u)}
    HUB.publish(pid, "msg", msg)
    return {**msg, "minha": True}


def report(pid: int, u, mid: int) -> dict:
    r = auth.q("SELECT * FROM sala_msgs WHERE id=? AND partida_id=?", (mid, pid), one=True)
    if not r:
        raise Err(404, "Mensagem não encontrada.")
    if r["user_id"] == u["id"]:
        raise Err(400, "Você não pode denunciar a sua própria mensagem.")
    try:
        auth.x("INSERT INTO sala_denuncias(msg_id, user_id) VALUES (?,?)", (mid, u["id"]))
    except Exception:  # noqa: BLE001 — já denunciou
        return {"ok": True}
    auth.x("UPDATE sala_msgs SET denuncias = denuncias + 1 WHERE id=?", (mid,))
    if r["denuncias"] + 1 >= 3 and not r["oculta"]:
        auth.x("UPDATE sala_msgs SET oculta=1 WHERE id=?", (mid,))
        HUB.publish(pid, "apagada", {"id": mid})
    return {"ok": True}


def delete(pid: int, u, mid: int) -> dict:
    r = auth.q("SELECT * FROM sala_msgs WHERE id=? AND partida_id=?", (mid, pid), one=True)
    if not r or r["user_id"] != u["id"]:
        raise Err(404, "Mensagem não encontrada.")
    auth.x("UPDATE sala_msgs SET oculta=1 WHERE id=?", (mid,))
    HUB.publish(pid, "apagada", {"id": mid})
    return {"ok": True}


# ================================================================ reações (termômetro da torcida)
_reac: dict[int, deque] = {}  # pid -> deque de (instante, emoji) do último minuto
_reac_total: dict[int, Counter] = {}
_reac_dirty: set[int] = set()
_reac_lock = threading.Lock()


def _reac_snapshot(pid: int) -> dict:
    now = time.time()
    with _reac_lock:
        d = _reac.get(pid, deque())
        while d and now - d[0][0] > 60:
            d.popleft()
        recent = Counter(e for _, e in d)
        tot = _reac_total.get(pid, Counter())
    return {"minuto": {e: recent.get(e, 0) for e in EMOJIS}, "total": {e: tot.get(e, 0) for e in EMOJIS}}


def react(pid: int, emoji: str, ip: str, uid=None) -> dict:
    if emoji not in EMOJIS:
        raise Err(400, "Reação inválida.")
    if not auth.LIMIT.allow(f"sala:reac:{uid or ip}:{pid}", 8, 10):
        raise Err(429, "Muitas reações seguidas.")
    with _reac_lock:
        _reac.setdefault(pid, deque()).append((time.time(), emoji))
        if len(_reac[pid]) > 5000:
            _reac[pid].popleft()
        _reac_total.setdefault(pid, Counter())[emoji] += 1
        _reac_dirty.add(pid)
    _start_flusher()
    return {"ok": True}


_flusher = [None]


def _start_flusher():
    """A cada 2 s, manda o termômetro das salas que receberam reação (uma mensagem por sala, não uma por clique)."""
    if _flusher[0] and _flusher[0].is_alive():
        return

    def run():
        while True:
            time.sleep(2)
            with _reac_lock:
                dirty = list(_reac_dirty)
                _reac_dirty.clear()
            for pid in dirty:
                HUB.publish(pid, "reacoes", _reac_snapshot(pid))
    _flusher[0] = threading.Thread(target=run, name="sala-reacoes", daemon=True)
    _flusher[0].start()


# ================================================================ enquetes
def _poll_out(r, voter=None) -> dict:
    opts = json.loads(r["opcoes"])
    counts = Counter({v["opcao"]: v["n"] for v in auth.q("SELECT opcao, COUNT(*) AS n FROM sala_votos WHERE enquete_id=? GROUP BY opcao", (r["id"],))})
    mine = auth.q("SELECT opcao FROM sala_votos WHERE enquete_id=? AND eleitor=?", (r["id"], voter), one=True) if voter else None
    return {"id": r["id"], "pergunta": r["pergunta"], "opcoes": opts, "votos": [counts.get(i, 0) for i in range(len(opts))],
            "aberta": r["fecha"] > time.time(), "fecha": r["fecha"], "meu_voto": mine["opcao"] if mine else None}


def polls(pid: int, voter=None) -> list:
    rows = auth.q("SELECT * FROM sala_enquetes WHERE partida_id=? ORDER BY id DESC LIMIT 6", (pid,))
    return [_poll_out(r, voter) for r in rows]


def create_poll(pid: int, chave: str, pergunta: str, opcoes: list, minutos: int) -> dict | None:
    """Cria uma vez por chave (o mesmo lance não gera duas enquetes) e avisa a sala."""
    now = time.time()
    try:
        eid = auth.x("INSERT INTO sala_enquetes(partida_id, chave, pergunta, opcoes, criada, fecha) VALUES (?,?,?,?,?,?)",
                     (pid, chave, pergunta[:140], json.dumps(opcoes, ensure_ascii=False), now, now + minutos * 60)).lastrowid
    except Exception:  # noqa: BLE001 — já existe
        return None
    r = auth.q("SELECT * FROM sala_enquetes WHERE id=?", (eid,), one=True)
    out = _poll_out(r)
    HUB.publish(pid, "enquete", out)
    return out


def vote(pid: int, eid: int, opcao: int, voter: str) -> dict:
    r = auth.q("SELECT * FROM sala_enquetes WHERE id=? AND partida_id=?", (eid, pid), one=True)
    if not r:
        raise Err(404, "Enquete não encontrada.")
    if r["fecha"] <= time.time():
        raise Err(400, "Essa enquete já fechou.")
    if not (0 <= int(opcao) < len(json.loads(r["opcoes"]))):
        raise Err(400, "Opção inválida.")
    try:
        auth.x("INSERT INTO sala_votos(enquete_id, eleitor, opcao) VALUES (?,?,?)", (eid, voter, int(opcao)))
    except Exception:  # noqa: BLE001
        raise Err(400, "Você já votou nessa.") from None
    out = _poll_out(r)
    HUB.publish(pid, "votos", {"id": eid, "votos": out["votos"]})
    return _poll_out(r, voter)


def _names(m: dict):
    return (m.get("time_mandante") or {}).get("nome_popular") or "Mandante", (m.get("time_visitante") or {}).get("nome_popular") or "Visitante"


def ensure_prematch_poll(pid: int, m: dict):
    if m and m.get("status") in ("agendado", "andamento"):
        h, a = _names(m)
        create_poll(pid, "quem-vence", "Quem vence?", [h, "Empate", a], 240)


def on_event(event: str, data: dict):
    """Lances do ao vivo viram enquetes (chamado pelo ao vivo do servidor; barato: só cria se ainda não existe)."""
    p = (data or {}).get("partida") or {}
    pid = p.get("partida_id")
    if not pid:
        return
    h, a = _names(p)
    t = ((data.get("time") or {}).get("nome_popular")) or ""
    who = ((data.get("autor") or {}).get("nome")) or ""
    if event == "gol":
        placar = f"{p.get('placar_mandante') or 0}x{p.get('placar_visitante') or 0}"
        create_poll(pid, f"gol-{placar}", f"Gol do {t}! Agora, quem leva?", [h, "Empate", a], 30)
    elif event == "lance":
        tipo = data.get("tipo")
        if tipo == "vermelho":
            create_poll(pid, f"vermelho-{who}", f"Vermelho para {who or 'o jogador do ' + t}. Foi justo?", ["Justo", "Exagero"], 15)
        elif tipo == "penalti":
            if data.get("detalhe") == "Defendido":
                create_poll(pid, f"penalti-{who}", f"Pênalti defendido! Mérito de quem?", ["Do goleiro", "Culpa do batedor"], 15)
            else:
                create_poll(pid, f"penalti-{who}", f"{who or t} perdeu o pênalti. Vai fazer falta?", ["Vai", "Ainda dá"], 15)
        elif tipo == "anulado":
            create_poll(pid, f"anulado-{p.get('placar_mandante')}-{p.get('placar_visitante')}", f"Gol do {t} anulado. Concorda?", ["Concordo", "Roubado"], 15)
    elif event == "periodo" and data.get("texto") == "Intervalo":
        create_poll(pid, "intervalo", f"Intervalo: {h} {p.get('placar_mandante') or 0}x{p.get('placar_visitante') or 0} {a}. Quem leva?", [h, "Empate", a], 75)


# ================================================================ nota da torcida
def _players(m: dict) -> list:
    """Quem entrou em campo: titulares e reservas que entraram (pelas substituições)."""
    esc = m.get("escalacoes") or {}
    subs_in = set()
    for side in ("mandante", "visitante"):
        for s in ((m.get("substituicoes") or {}).get(side) or []):
            if (s.get("entrou") or {}).get("atleta_id"):
                subs_in.add(s["entrou"]["atleta_id"])
    out = []
    for side in ("mandante", "visitante"):
        team = m.get("time_mandante" if side == "mandante" else "time_visitante") or {}
        e = esc.get(side) or {}
        for x in (e.get("titulares") or []) + [r for r in (e.get("reservas") or []) if (r.get("atleta") or {}).get("atleta_id") in subs_in]:
            a = x.get("atleta") or {}
            if a.get("atleta_id"):
                out.append({"atleta_id": a["atleta_id"], "nome": a.get("nome_popular"), "lado": side, "time": team.get("sigla") or team.get("nome_popular"),
                            "posicao": (x.get("posicao") or {}).get("sigla") or ""})
    return out


def ratings(pid: int, m: dict | None, me_id=None) -> dict | None:
    if not m or m.get("status") != "finalizado":
        return None
    players = _players(m)
    if not players:
        return None
    agg = {r["atleta_id"]: (r["media"], r["n"]) for r in auth.q(
        "SELECT atleta_id, AVG(nota) AS media, COUNT(*) AS n FROM sala_notas WHERE partida_id=? GROUP BY atleta_id", (pid,))}
    mine = {r["atleta_id"]: r["nota"] for r in auth.q("SELECT atleta_id, nota FROM sala_notas WHERE partida_id=? AND user_id=?", (pid, me_id))} if me_id else {}
    for p in players:
        media, n = agg.get(p["atleta_id"], (None, 0))
        p.update(media=round(media, 1) if media else None, votos=n, minha=mine.get(p["atleta_id"]))
    rated = [p for p in players if p["votos"] >= MIN_VOTOS_CRAQUE]
    craque = max(rated, key=lambda p: (p["media"], p["votos"])) if rated else None
    pessoas = auth.q("SELECT COUNT(DISTINCT user_id) AS n FROM sala_notas WHERE partida_id=?", (pid,), one=True)["n"]
    return {"jogadores": players, "craque": craque, "min_votos": MIN_VOTOS_CRAQUE, "pessoas": pessoas}


def rate(pid: int, u, atleta_id: int, nota: int) -> dict:
    m = _match(pid)
    if not m or m.get("status") != "finalizado":
        raise Err(400, "A nota da torcida abre quando o jogo acaba.")
    if not (1 <= int(nota) <= 10):
        raise Err(400, "A nota vai de 1 a 10.")
    if int(atleta_id) not in {p["atleta_id"] for p in _players(m)}:
        raise Err(400, "Esse jogador não entrou em campo.")
    if not auth.LIMIT.allow(f"sala:nota:{u['id']}", 60, 60):
        raise Err(429, "Muitas notas seguidas. Aguarde um instante.")
    auth.x("""INSERT INTO sala_notas(partida_id, atleta_id, user_id, nota, quando) VALUES (?,?,?,?,?)
              ON CONFLICT(partida_id, atleta_id, user_id) DO UPDATE SET nota=excluded.nota, quando=excluded.quando""",
           (pid, int(atleta_id), u["id"], int(nota), time.time()))
    r = auth.q("SELECT AVG(nota) AS media, COUNT(*) AS n FROM sala_notas WHERE partida_id=? AND atleta_id=?", (pid, int(atleta_id)), one=True)
    out = {"atleta_id": int(atleta_id), "media": round(r["media"], 1), "votos": r["n"]}
    HUB.publish(pid, "nota", out)
    return {**out, "minha": int(nota)}


# ================================================================ rotas
def _voter(u, ctx) -> str:
    """Eleitor da enquete: a conta, ou (sem conta) um código do endereço — um voto por pessoa."""
    if u:
        return f"u{u['id']}"
    return "ip" + hashlib.sha256(f"{ctx.get('ip', '')}|{(ctx.get('ua') or '')[:80]}".encode()).hexdigest()[:20]


def snapshot(pid: int, u, ctx) -> dict:
    m = _match(pid)
    if m is None:
        raise Err(404, "Partida não encontrada.")
    ensure_prematch_poll(pid, m)
    me = u["id"] if u else None
    return {"partida_id": pid, "status": m.get("status"), "mensagens": messages(pid, me), "enquetes": polls(pid, _voter(u, ctx)),
            "reacoes": _reac_snapshot(pid), "emojis": EMOJIS, "online": HUB.online(pid), "notas": ratings(pid, m, me),
            "eu": _user_pub(u) if u else None, "max_texto": MAX_TEXT}


def handle(method: str, path: str, query: dict, body: dict, ctx: dict):
    """/sala/{partida}[/acao] -> (status, JSON)."""
    try:
        if not auth.LIMIT.allow(f"sala:{ctx.get('ip', '')}", 240, 60):
            raise Err(429, "Muitas requisições. Aguarde um instante.")
        parts = path.strip("/").split("/")  # ["sala", pid, ação?]
        pid = int(parts[1])
        act = parts[2] if len(parts) > 2 else ""
        u, _ = auth.current(ctx)
        if method == "GET" and act == "":
            return 200, snapshot(pid, u, ctx)
        if method == "GET" and act == "mensagens":  # mais antigas (rolar para cima)
            antes = int(query.get("antes") or 0) or None
            return 200, {"mensagens": messages(pid, u["id"] if u else None, antes)}
        if method != "POST":
            raise Err(405, "Método não permitido.")
        if act == "reagir":
            return 200, react(pid, str(body.get("emoji") or ""), ctx.get("ip", ""), u["id"] if u else None)
        if act == "votar":
            if not auth.LIMIT.allow(f"sala:voto:{ctx.get('ip', '')}", 30, 60):
                raise Err(429, "Muitos votos seguidos.")
            return 200, vote(pid, int(body.get("enquete") or 0), int(body.get("opcao") if body.get("opcao") is not None else -1), _voter(u, ctx))
        if not u:
            raise Err(401, "Entre na sua conta para participar da resenha.")
        if act == "mensagens":
            if _match(pid) is None:
                raise Err(404, "Partida não encontrada.")
            return 200, post_message(pid, u, body.get("texto"), ctx.get("ip", ""))
        if act == "denunciar":
            return 200, report(pid, u, int(body.get("id") or 0))
        if act == "apagar":
            return 200, delete(pid, u, int(body.get("id") or 0))
        if act == "nota":
            return 200, rate(pid, u, int(body.get("atleta_id") or 0), int(body.get("nota") or 0))
        raise Err(404, "Rota não encontrada.")
    except Err as e:
        return e.status, {"message": e.message}
    except (TypeError, ValueError):
        return 400, {"message": "Dados inválidos."}
