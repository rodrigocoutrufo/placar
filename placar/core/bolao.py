"""Bolão com amigos: grupos privados com código de convite e ranking da semana e geral.

Regras que ninguém pode burlar (por isso fica no servidor, e não no navegador de cada um):
- palpite só antes do começo do jogo: o servidor confere pela própria hora e pelos próprios dados da partida;
- os pontos saem dos resultados reais (placar exato 3, vencedor ou empate 1), calculados aqui;
- o palpite dos amigos só aparece depois que o jogo começa (ninguém copia).

A "rodada" do ranking é a semana (segunda a domingo, horário de Brasília): o bolão mistura campeonatos com rodadas
diferentes. Usa o mesmo banco das contas (contas.db). `fetch_match(pid)` é ligado pelo servidor (dados da partida).
"""

import secrets
import time
from datetime import datetime, timedelta, timezone

from . import auth

BRT = timezone(timedelta(hours=-3))
CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"  # sem 0/O, 1/I/L: o código é ditado e digitado
MAX_GROUPS, MAX_MEMBERS, MAX_NAME = 20, 100, 40
fetch_match = None  # ligado em server.py: pid -> dict da partida (formato da API) ou None

with auth._lock:
    auth._db.executescript("""
    CREATE TABLE IF NOT EXISTS bolao_grupos (
      id INTEGER PRIMARY KEY, codigo TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      dono INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, criado REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS bolao_membros (
      grupo_id INTEGER NOT NULL REFERENCES bolao_grupos(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, entrou REAL NOT NULL,
      PRIMARY KEY (grupo_id, user_id));
    CREATE INDEX IF NOT EXISTS bolao_membros_user ON bolao_membros(user_id);
    CREATE TABLE IF NOT EXISTS bolao_palpites (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, partida_id INTEGER NOT NULL,
      h INTEGER NOT NULL, a INTEGER NOT NULL, quando REAL NOT NULL, PRIMARY KEY (user_id, partida_id));
    CREATE TABLE IF NOT EXISTS bolao_jogos (
      partida_id INTEGER PRIMARY KEY, inicio REAL NOT NULL, mandante TEXT, visitante TEXT, escudo_m TEXT, escudo_v TEXT,
      campeonato TEXT, placar_m INTEGER, placar_v INTEGER, status TEXT, atualizado REAL NOT NULL);
    """)

q, x, Err = auth.q, auth.x, auth.Err


def _week(ts: float) -> str:
    d = datetime.fromtimestamp(ts, BRT)
    y, w, _ = d.isocalendar()
    return f"{y}-S{w:02d}"


def _week_label(key: str) -> str:
    y, w = key.split("-S")
    monday = datetime.fromisocalendar(int(y), int(w), 1)
    sunday = monday + timedelta(days=6)
    return f"{monday:%d/%m} a {sunday:%d/%m}"


def score(h, a, m) -> int | None:
    """Pontos de um palpite: placar exato 3, vencedor ou empate 1, senão 0 (None: jogo não terminou)."""
    if not m or m["status"] != "finalizado" or m["placar_m"] is None:
        return None
    if h == m["placar_m"] and a == m["placar_v"]:
        return 3
    sign = lambda v: (v > 0) - (v < 0)
    return 1 if sign(h - a) == sign(m["placar_m"] - m["placar_v"]) else 0


# ---------------------------------------------------------------- partidas
def _store_match(pid: int):
    """Guarda (ou atualiza) a partida a partir dos dados do servidor. None se não existir."""
    m = fetch_match(pid) if fetch_match else None
    if not m or not m.get("data_realizacao_iso"):
        return None
    try:
        start = datetime.strptime(m["data_realizacao_iso"], "%Y-%m-%dT%H:%M:%S%z").timestamp()
    except ValueError:
        return None
    H, A = m.get("time_mandante") or {}, m.get("time_visitante") or {}
    started = m.get("status") in ("andamento", "finalizado")
    x("""INSERT INTO bolao_jogos (partida_id, inicio, mandante, visitante, escudo_m, escudo_v, campeonato, placar_m, placar_v, status, atualizado)
         VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(partida_id) DO UPDATE SET inicio=excluded.inicio, placar_m=excluded.placar_m,
         placar_v=excluded.placar_v, status=excluded.status, atualizado=excluded.atualizado""",
      (pid, start, H.get("nome_popular"), A.get("nome_popular"), H.get("escudo"), A.get("escudo"),
       (m.get("campeonato") or {}).get("nome_popular"), m.get("placar_mandante") if started else None,
       m.get("placar_visitante") if started else None, m.get("status"), time.time()))
    return q("SELECT * FROM bolao_jogos WHERE partida_id=?", (pid,), one=True)


def refresh_results(limit=40):
    """Agendador: atualiza o placar dos jogos já começados que ainda não terminaram (para os pontos)."""
    now = time.time()
    rows = q("SELECT partida_id FROM bolao_jogos WHERE inicio < ? AND (status IS NULL OR status NOT IN ('finalizado','cancelado')) "
             "AND atualizado < ? ORDER BY inicio LIMIT ?", (now, now - 120, limit))
    for r in rows:
        try:
            _store_match(r["partida_id"])
        except Exception:  # noqa: BLE001 — uma partida com problema não para as outras
            continue


# ---------------------------------------------------------------- palpites
def save_picks(u, picks) -> dict:
    if not isinstance(picks, list) or len(picks) > 80:
        raise Err(400, "Palpites inválidos.")
    ok, closed = [], []
    now = time.time()
    for p in picks:
        try:
            pid, h, a = int(p["partida_id"]), p.get("h"), p.get("a")
        except (KeyError, TypeError, ValueError):
            raise Err(400, "Palpites inválidos.") from None
        m = q("SELECT * FROM bolao_jogos WHERE partida_id=?", (pid,), one=True)
        if not m or m["atualizado"] < now - 600:
            m = _store_match(pid) or m
        if not m:
            raise Err(404, "Jogo não encontrado.")
        if m["inicio"] <= now or m["status"] in ("andamento", "finalizado"):
            closed.append(pid)  # começou: palpite fechado
            continue
        if h is None or a is None:
            x("DELETE FROM bolao_palpites WHERE user_id=? AND partida_id=?", (u["id"], pid))
        else:
            h, a = int(h), int(a)
            if not (0 <= h <= 20 and 0 <= a <= 20):
                raise Err(400, "Placar inválido.")
            x("INSERT INTO bolao_palpites (user_id, partida_id, h, a, quando) VALUES (?,?,?,?,?) "
              "ON CONFLICT(user_id, partida_id) DO UPDATE SET h=excluded.h, a=excluded.a, quando=excluded.quando", (u["id"], pid, h, a, now))
        ok.append(pid)
    return {"salvos": ok, "fechados": closed}


def my_picks(u) -> dict:
    rows = q("SELECT p.partida_id, p.h, p.a, j.status, j.placar_m, j.placar_v FROM bolao_palpites p "
             "LEFT JOIN bolao_jogos j ON j.partida_id=p.partida_id WHERE p.user_id=? AND p.quando > ?", (u["id"], time.time() - 120 * 86400))
    return {str(r["partida_id"]): {"h": r["h"], "a": r["a"], "pts": score(r["h"], r["a"], r)} for r in rows}


# ---------------------------------------------------------------- grupos
def _code():
    while True:
        c = "".join(secrets.choice(CODE_CHARS) for _ in range(6))
        if not q("SELECT 1 FROM bolao_grupos WHERE codigo=?", (c,), one=True):
            return c


def _member(gid, uid):
    return q("SELECT 1 FROM bolao_membros WHERE grupo_id=? AND user_id=?", (gid, uid), one=True)


def create(u, body) -> dict:
    nome = str(body.get("nome") or "").strip()[:MAX_NAME]
    if len(nome) < 2:
        raise Err(400, "Dê um nome ao grupo (2 letras ou mais).", campo="nome")
    if q("SELECT COUNT(*) n FROM bolao_membros WHERE user_id=?", (u["id"],), one=True)["n"] >= MAX_GROUPS:
        raise Err(400, f"Você já está em {MAX_GROUPS} grupos.")
    if not auth.LIMIT.allow(f"bolao-criar:{u['id']}", 10, 3600):
        raise Err(429, "Você criou muitos grupos agora. Tente mais tarde.")
    now = time.time()
    with auth._lock:
        cur = auth._db.execute("INSERT INTO bolao_grupos (codigo, nome, dono, criado) VALUES (?,?,?,?)", (_code(), nome, u["id"], now))
        gid = cur.lastrowid
        auth._db.execute("INSERT INTO bolao_membros (grupo_id, user_id, entrou) VALUES (?,?,?)", (gid, u["id"], now))
    return group(u, gid)


def join(u, body) -> dict:
    code = str(body.get("codigo") or "").strip().upper().replace(" ", "").replace("-", "")
    if not auth.LIMIT.allow(f"bolao-entrar:{u['id']}", 20, 600):  # sem chutar códigos
        raise Err(429, "Muitas tentativas. Aguarde alguns minutos.")
    g = q("SELECT * FROM bolao_grupos WHERE codigo=?", (code,), one=True) if len(code) == 6 else None
    if not g:
        raise Err(404, "Código não encontrado. Confira com quem te convidou.", campo="codigo")
    if not _member(g["id"], u["id"]):
        if q("SELECT COUNT(*) n FROM bolao_membros WHERE grupo_id=?", (g["id"],), one=True)["n"] >= MAX_MEMBERS:
            raise Err(400, "Este grupo está cheio.")
        if q("SELECT COUNT(*) n FROM bolao_membros WHERE user_id=?", (u["id"],), one=True)["n"] >= MAX_GROUPS:
            raise Err(400, f"Você já está em {MAX_GROUPS} grupos.")
        x("INSERT INTO bolao_membros (grupo_id, user_id, entrou) VALUES (?,?,?)", (g["id"], u["id"], time.time()))
    return group(u, g["id"])


def leave(u, gid) -> dict:
    g = q("SELECT * FROM bolao_grupos WHERE id=?", (gid,), one=True)
    if not g or not _member(gid, u["id"]):
        raise Err(404, "Grupo não encontrado.")
    x("DELETE FROM bolao_membros WHERE grupo_id=? AND user_id=?", (gid, u["id"]))
    rest = q("SELECT user_id FROM bolao_membros WHERE grupo_id=? ORDER BY entrou", (gid,))
    if not rest:
        x("DELETE FROM bolao_grupos WHERE id=?", (gid,))  # último a sair: o grupo acaba
    elif g["dono"] == u["id"]:
        x("UPDATE bolao_grupos SET dono=? WHERE id=?", (rest[0]["user_id"], gid))  # o mais antigo vira dono
    return {"ok": True}


def _ranking(gid, since):
    """Pontos de cada membro: geral (jogos desde a criação do grupo) e por semana."""
    members = q("SELECT u.id, u.username, u.name, u.avatar, m.entrou FROM bolao_membros m JOIN users u ON u.id=m.user_id "
                "WHERE m.grupo_id=? ORDER BY m.entrou", (gid,))
    ids = [r["id"] for r in members]
    if not ids:
        return [], {}
    rows = q(f"SELECT p.user_id, p.h, p.a, j.* FROM bolao_palpites p JOIN bolao_jogos j ON j.partida_id=p.partida_id "
             f"WHERE p.user_id IN ({','.join('?' * len(ids))}) AND j.inicio >= ?", (*ids, since))
    tot = {i: {"pontos": 0, "exatos": 0, "acertos": 0, "palpites": 0} for i in ids}
    weeks: dict[str, dict[int, int]] = {}
    for r in rows:
        s = score(r["h"], r["a"], r)
        t = tot[r["user_id"]]
        t["palpites"] += 1
        if s is None:
            continue
        t["pontos"] += s
        t["exatos"] += s == 3
        t["acertos"] += s > 0
        wk = weeks.setdefault(_week(r["inicio"]), {})
        wk[r["user_id"]] = wk.get(r["user_id"], 0) + s
    people = {r["id"]: {"id": r["id"], "usuario": r["username"], "nome": r["name"] or r["username"], "avatar": r["avatar"]} for r in members}
    return [{**people[i], **tot[i]} for i in ids], weeks


def group(u, gid) -> dict:
    g = q("SELECT * FROM bolao_grupos WHERE id=?", (gid,), one=True)
    if not g or not _member(gid, u["id"]):
        raise Err(404, "Grupo não encontrado.")
    since = g["criado"] - 3600
    people, weeks = _ranking(gid, since)
    # mais pontos primeiro; empate: mais placares exatos; depois o nome
    order = lambda rows, key: sorted(rows, key=lambda r: (*(-v for v in key(r)), r["nome"].lower()))
    geral = order(people, lambda r: (r["pontos"], r["exatos"]))
    this_week = _week(time.time())
    semanas = []
    for wk in sorted(weeks, reverse=True)[:8]:
        pts = weeks[wk]
        rows = order([{**p, "pontos": pts.get(p["id"], 0)} for p in people], lambda r: (r["pontos"],))
        semanas.append({"semana": wk, "periodo": _week_label(wk), "atual": wk == this_week, "ranking": rows,
                        "vencedor": rows[0]["nome"] if rows and rows[0]["pontos"] > 0 and wk != this_week else None})
    # palpites de todos nos jogos que já começaram (os futuros ficam escondidos)
    now = time.time()
    ids = [p["id"] for p in people]
    games = q(f"SELECT DISTINCT j.* FROM bolao_jogos j JOIN bolao_palpites p ON p.partida_id=j.partida_id "
              f"WHERE p.user_id IN ({','.join('?' * len(ids))}) AND j.inicio >= ? AND j.inicio <= ? ORDER BY j.inicio DESC LIMIT 12",
              (*ids, since, now)) if ids else []
    names = {p["id"]: p["nome"] for p in people}
    jogos = []
    for j in games:
        ps = q(f"SELECT user_id, h, a FROM bolao_palpites WHERE partida_id=? AND user_id IN ({','.join('?' * len(ids))})", (j["partida_id"], *ids))
        jogos.append({"partida_id": j["partida_id"], "mandante": j["mandante"], "visitante": j["visitante"], "escudo_m": j["escudo_m"],
                      "escudo_v": j["escudo_v"], "campeonato": j["campeonato"], "placar_m": j["placar_m"], "placar_v": j["placar_v"],
                      "status": j["status"], "palpites": [{"nome": names[p["user_id"]], "h": p["h"], "a": p["a"], "pts": score(p["h"], p["a"], j)}
                                                          for p in sorted(ps, key=lambda p: names[p["user_id"]].lower())]})
    return {"id": g["id"], "nome": g["nome"], "codigo": g["codigo"], "dono": g["dono"] == u["id"], "criado": int(g["criado"]),
            "membros": len(people), "geral": geral, "semanas": semanas, "jogos": jogos, "eu": u["id"]}


def my_groups(u) -> list:
    out = []
    for g in q("SELECT g.* FROM bolao_grupos g JOIN bolao_membros m ON m.grupo_id=g.id WHERE m.user_id=? ORDER BY m.entrou", (u["id"],)):
        people, _ = _ranking(g["id"], g["criado"] - 3600)
        geral = sorted(people, key=lambda r: (-r["pontos"], -r["exatos"], r["nome"].lower()))
        pos = next((i + 1 for i, r in enumerate(geral) if r["id"] == u["id"]), None)
        out.append({"id": g["id"], "nome": g["nome"], "codigo": g["codigo"], "membros": len(people), "posicao": pos,
                    "lider": geral[0]["nome"] if geral and geral[0]["pontos"] else None,
                    "meus_pontos": next((r["pontos"] for r in geral if r["id"] == u["id"]), 0)})
    return out


# ---------------------------------------------------------------- rotas /api/bolao/*
def handle(method: str, path: str, query: dict, body: dict, ctx: dict):
    """Devolve (status, objeto JSON). Precisa de conta: o ranking é entre pessoas."""
    try:
        if not auth.LIMIT.allow(f"bolao:{ctx.get('ip', '')}", 120, 60):
            raise Err(429, "Muitas requisições. Aguarde um instante.")
        u, _ = auth.current(ctx)
        if not u:
            raise Err(401, "Entre na sua conta para jogar o bolão com amigos.")
        parts = path.strip("/").split("/")  # ["bolao", ...]
        r = (method, "/".join(parts[1:]))
        if r == ("GET", "grupos"):
            return 200, {"grupos": my_groups(u)}
        if r == ("POST", "grupos"):
            return 200, create(u, body)
        if r == ("POST", "entrar"):
            return 200, join(u, body)
        if r == ("GET", "palpites"):
            return 200, {"palpites": my_picks(u)}
        if r == ("POST", "palpites"):
            return 200, save_picks(u, body.get("palpites"))
        if len(parts) >= 3 and parts[1] == "grupos" and parts[2].isdigit():
            gid = int(parts[2])
            if method == "GET" and len(parts) == 3:
                return 200, group(u, gid)
            if method == "POST" and len(parts) == 4 and parts[3] == "sair":
                return 200, leave(u, gid)
        raise Err(404, "Rota não encontrada.")
    except Err as e:
        return e.status, {"message": e.message, **e.extra}
