"""Vyra — servidor da aplicação.

Segue as boas práticas da documentação da API Futebol (api-futebol.com.br/documentacao/boas-praticas):

* a chave fica só no backend; o navegador fala apenas com /api/* deste servidor (o /me nunca é exposto);
* um agendador mantém o cache quente, em intervalos por recurso;
* 5xx: novas tentativas com backoff (1 s, 2 s, 4 s); timeout de 20 s; 429/queda: último dado bom;
* 401/403 = fora do plano: o recurso é atendido pela reserva (ESPN).

ORÇAMENTO DIÁRIO. O plano tem um limite de requisições por dia (lido em GET /me). O servidor conta
cada chamada, guarda o contador e o cache em disco (.cache/) para um reinício não gastar o plano de
novo, ajusta os TTLs ao tamanho do plano e, ao chegar perto do limite, passa a servir só cache e
reserva. Num plano pequeno (ex.: 100/dia) o placar minuto a minuto vem da ESPN e é aplicado sobre os
jogos oficiais da API Futebol — consultar /ao-vivo a cada 30 s custaria ~2.900 requisições por dia.

Fontes:
  1. API Futebol (oficial, FUTEBOL_API_KEY) — campeonatos do plano e notícias (add-on);
  2. ESPN (pública, não oficial; espn.py) — o que o plano não cobre e o ao vivo (ESPN_FALLBACK=0 desliga);
  3. Transfermarkt (transfermarkt.py) — perfil completo, valor de mercado e transferências dos jogadores.

Uso:  python server.py [porta]   (o server.py da raiz chama placar.server.main)
"""

import gzip
import hashlib
import html
import json
import os
import queue
import re
import signal
import socket
import sys
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from . import config
from .ai import client as ai
from .ai import news as ai_news
from .core import auth, identity, news_filter, prob
from .sources import espn, footballdata, news_rss, stadium, transfermarkt
from . import ai_routes, sports

ROOT = config.ROOT
PUBLIC = config.PUBLIC
DATA_DIR = config.DATA_DIR  # disco persistente na hospedagem
CACHE = DATA_DIR / "api"
BUDGET_FILE = DATA_DIR / "orcamento.json"
UPSTREAM = "https://api.api-futebol.com.br/v1"
BRT = config.BRT

LIVE_KEY = os.environ.get("FUTEBOL_API_KEY", "")
ESPN_ON = os.environ.get("ESPN_FALLBACK", "1") != "0"
PORT = int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else int(os.environ.get("PORT", "8080"))
RESERVA = 0.10      # fração do limite diário guardada para emergências (abrir uma partida, etc.)
DENIED_TTL = 1800   # recurso fora do plano: não insiste por 30 min
TIMEOUT = 20

H, MIN = 3600, 60
# TTL (s) por rota em dois perfis: plano grande e plano econômico (<= 500 req/dia)
TTL_RULES = [
    # padrão,  econômico
    (r"^/ao-vivo$", 30, 30),
    (r"^/times/\d+/partidas/ao-vivo$", 30, 30),
    (r"^/partidas/\d+$", 30, 30 * MIN),
    (r"^/campeonatos/\d+/tabela$", 2 * MIN, 2 * H),
    (r"^/campeonatos/\d+/rodadas/\d+$", 2 * MIN, 2 * H),
    (r"^/campeonatos/\d+/(fases/\d+|partidas)$", 5 * MIN, 3 * H),
    (r"^/times/\d+/partidas/(proximas|anteriores)$", 10 * MIN, 12 * H),
    (r"^/campeonatos/\d+/(artilharia|assistencias)$", 15 * MIN, 6 * H),
    (r"^/noticias$", 10 * MIN, 2 * H),
    (r"^/(times|atletas)/\d+(/campeonatos|/elenco)?$", 1 * H, 7 * 24 * H),
    (r"^/campeonatos(/\d+)?(/rodadas|/fases)?$", 1 * H, 24 * H),
    (r"^/me$", 1 * H, 6 * H),
]
TTL_RULES = [(re.compile(p), a, b) for p, a, b in TTL_RULES]
ALLOWED = [r for r, _, _ in TTL_RULES if r.pattern != "^/me$"] + [re.compile(r"^/(jogador-tm|time-tm|estadio|minijogos/craques)$"), re.compile(r"^/campeonatos/\d+/chances$"),
                                                                 re.compile(r"^/esportes/(nba/(jogos|jogo/\d+|classificacao|time/\d+|jogador/\d+)|f1(/corrida/\d+(/analise)?|/piloto/[a-z_]+|/equipe/[a-z_]+)?)$"),
                                                                 re.compile(r"^/transmissoes$"), re.compile(r"^/agenda$")]
NEWS_PARAMS = {"pagina", "por_pagina", "time_id", "campeonato_id", "provedor", "desde", "tipo", "assunto", "competicao"}
# Ordem de exibição: Brasil primeiro (Série A antes da Série B), depois América do Sul e Europa
PRIORITY = [10, 2, 7, 9, 14, 106, 101, 102, 103, 104, 105, 107, 108] + [l for l in espn.LEAGUE_ORDER if l not in (10, 14, 2, 7, 9)]
COMP_SLUG = {10: "brasileirao_serie_a", 14: "brasileirao_serie_b", 2: "copa_do_brasil", 7: "libertadores", 9: "sul_americana"}

_mem: dict[str, tuple[float, int, bytes]] = {}
_denied: dict[str, float] = {}
_plan = {"until": 0.0, "list": [], "ids": set(), "info": None, "limit": 100}
_stats = {"api_futebol": 0, "fora_do_plano": 0, "limite_429": 0, "retentativas": 0, "cache_hits": 0,
          "bloqueadas_pelo_orcamento": 0, "started": time.time()}
_lock = threading.Lock()


# ---------------------------------------------------------------- orçamento diário
def _today():
    return datetime.now(BRT).strftime("%Y-%m-%d")


def _budget():
    try:
        b = json.loads(BUDGET_FILE.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        b = {}
    if b.get("dia") != _today():
        b = {"dia": _today(), "usadas": 0}
    return b


def _spend():
    with _lock:
        b = _budget()
        b["usadas"] += 1
        BUDGET_FILE.parent.mkdir(parents=True, exist_ok=True)
        BUDGET_FILE.write_text(json.dumps(b), encoding="utf-8")
        return b["usadas"]


def budget_left(essential=False) -> int:
    limit = _plan["limit"] or 100
    reserve = 0 if essential else int(limit * RESERVA)
    return limit - reserve - _budget()["usadas"]


def economy() -> bool:
    return (_plan["limit"] or 100) <= 500


def ttl_for(path: str) -> int:
    for rule, normal, eco in TTL_RULES:
        if rule.match(path.split("?")[0]):
            return eco if economy() else normal
    return 3600 if economy() else 60


# ---------------------------------------------------------------- cache em disco
def _cfile(path):
    return CACHE / (hashlib.sha1(path.encode()).hexdigest() + ".json")


def _cache_get(path):
    hit = _mem.get(path)
    if hit:
        return hit
    f = _cfile(path)
    if f.exists():
        try:
            d = json.loads(f.read_text(encoding="utf-8"))
            hit = (d["exp"], d["status"], d["body"].encode())
            _mem[path] = hit
            return hit
        except (OSError, ValueError, KeyError):
            return None
    return None


def _cache_put(path, status, body, ttl):
    exp = time.time() + ttl
    _mem[path] = (exp, status, body)
    if path == "/me":  # contém as chaves: fica só em memória
        return
    CACHE.mkdir(parents=True, exist_ok=True)
    _cfile(path).write_text(json.dumps({"path": path, "exp": exp, "status": status, "body": body.decode()}), encoding="utf-8")


def _upstream(path: str, force: bool = False, essential: bool = False) -> tuple[int, bytes]:
    """GET na API Futebol: cache (memória + disco), orçamento diário, retry com backoff."""
    now = time.time()
    hit = _cache_get(path)
    if hit and hit[0] > now and not force:
        _stats["cache_hits"] += 1
        return hit[1], hit[2]
    if budget_left(essential) <= 0:
        _stats["bloqueadas_pelo_orcamento"] += 1
        if hit:  # vencido, mas é o que temos
            return hit[1], hit[2]
        return 429, json.dumps({"message": "Orçamento diário da API Futebol esgotado; usando a reserva."}).encode()
    req = urllib.request.Request(UPSTREAM + path, headers={
        "Authorization": f"Bearer {LIVE_KEY}", "Accept": "application/json", "User-Agent": "Vyra/5.0"})
    status, body = 0, b""
    for wait in (0, 1, 2, 4):
        if wait:
            time.sleep(wait)
            _stats["retentativas"] += 1
        _spend()
        _stats["api_futebol"] += 1
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
                status, body = resp.status, resp.read()
        except urllib.error.HTTPError as e:
            status, body = e.code, e.read() or b"{}"
        except (urllib.error.URLError, TimeoutError) as e:
            status, body = 502, json.dumps({"message": f"Falha ao contatar a API Futebol: {e}"}).encode()
        if status < 500 or budget_left(essential) <= 0:
            break
    if status in (401, 403):
        _stats["fora_do_plano"] += 1
    if status == 429:
        _stats["limite_429"] += 1
    if status == 200:
        _cache_put(path, status, body, ttl_for(path))
    elif hit and (status == 429 or status >= 500):
        return hit[1], hit[2]
    return status, body


# ---------------------------------------------------------------- plano
def plan() -> tuple[list, set]:
    """Campeonatos liberados (GET /me, como indica a documentação) e limite diário do plano."""
    if not LIVE_KEY:
        return [], set()
    if _plan["until"] > time.time():
        return _plan["list"], _plan["ids"]
    ids: set[int] = set()
    st, body = _upstream("/me", essential=True)
    if st == 200:
        info = json.loads(body)
        ids = {int(c["campeonato_id"]) for c in info.get("campeonatos", [])}
        _plan["info"] = {"plano": info.get("plano"), "campeonatos": info.get("campeonatos")}  # sem as chaves
        _plan["limit"] = int((info.get("plano") or {}).get("requisicoes") or 100)
    items = []
    if ids:
        st2, body2 = _upstream("/campeonatos", essential=True)
        items = json.loads(body2) if st2 == 200 else []
        # /campeonatos lista o catálogo; só entram os liberados no plano
        items = [c for c in items if isinstance(c, dict) and int(c.get("campeonato_id", 0)) in ids] if isinstance(items, list) else []
    _plan.update(until=time.time() + ttl_for("/me"), list=items, ids=ids)
    return items, ids


# ---------------------------------------------------------------- ao vivo (ESPN sobre jogos oficiais)
def _nk(name):
    s = unicodedata.normalize("NFD", name or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]", "", s)


def _same(a, b):
    a, b = _nk(a), _nk(b)
    return bool(a and b) and (a == b or a.startswith(b[:6]) or b.startswith(a[:6]))


_overlay: dict[int, dict] = {}  # partida_id oficial -> dados ao vivo da ESPN


def _official_matches(cid):
    """Partidas oficiais em cache (rodada atual) — não gasta orçamento se já estiverem guardadas."""
    camps, _ = plan()
    c = next((x for x in camps if int(x["campeonato_id"]) == cid), None)
    if not c or not c.get("rodada_atual"):
        return []
    st, body = _upstream(f"/campeonatos/{cid}/rodadas/{c['rodada_atual']['rodada']}")
    return (json.loads(body).get("partidas") or []) if st == 200 else []


def live_for_plan(ids) -> list:
    """Placar ao vivo dos campeonatos do plano: ESPN aplicada sobre as partidas da API Futebol."""
    out = []
    if not ESPN_ON:
        return out
    espn_live = [m for m in espn.ao_vivo() if m["campeonato"]["campeonato_id"] in ids]
    for cid in {m["campeonato"]["campeonato_id"] for m in espn_live}:
        official = _official_matches(cid)
        for m in (x for x in espn_live if x["campeonato"]["campeonato_id"] == cid):
            o = next((p for p in official if _same(p["time_mandante"]["nome_popular"], m["time_mandante"]["nome_popular"])
                      and _same(p["time_visitante"]["nome_popular"], m["time_visitante"]["nome_popular"])), None)
            if o:
                merged = {**o, **{k: m.get(k) for k in ("placar_mandante", "placar_visitante", "status", "periodo", "cronometro", "cronometro_label", "disputa_penalti")},
                          "campeonato": o.get("campeonato") or m["campeonato"], "fonte_placar": "espn"}
                identity.canonicalize(merged, cid, _espn_teams)  # mesmos IDs de time do resto da Vyra
                _overlay[o["partida_id"]] = merged
                out.append(merged)
            else:
                out.append(m)
    return out


# ---------------------------------------------------------------- notícias
COMP_WORDS = {cid: re.compile(rx, re.I) for cid, rx in {
    10: r"brasileir[ãa]o(?! s[ée]rie [bcd])|s[ée]rie a\b(?! italiana)", 14: r"s[ée]rie b\b", 2: r"copa do brasil", 7: r"libertadores",
    9: r"sul-americana|sudamericana", 106: r"champions", 101: r"premier league|campeonato ingl[êe]s", 102: r"la liga|campeonato espanhol",
    103: r"serie a italiana|campeonato italiano|calcio", 104: r"bundesliga|campeonato alem[ãa]o", 105: r"ligue 1|campeonato franc[êe]s",
    107: r"liga portugal|campeonato portugu[êe]s|liga betclic", 108: r"eredivisie|campeonato holand[êe]s"}.items()}
_rss_state = {"at": 0.0}


def known_teams() -> list[dict]:
    """Todos os times que o app conhece (ESPN + football-data em cache), para marcar as notícias."""
    teams = {}
    for lid in espn.CORE:  # só Brasil e Conmebol: milhares de times estrangeiros dariam falsos positivos nas manchetes
        try:
            for e in espn._events(lid):
                for c in e["competitions"][0]["competitors"]:
                    t = espn.team(c["team"])
                    teams.setdefault(t["nome_popular"], t)
        except Exception:  # noqa: BLE001
            continue
    for path, (_, data) in list(footballdata._mem.items()):
        if path.endswith("/matches") and isinstance(data, dict):
            for m in data.get("matches", []):
                for side in ("homeTeam", "awayTeam"):
                    if (m.get(side) or {}).get("id"):
                        t = footballdata.team(m[side])
                        teams.setdefault(t["nome_popular"], t)
    return list(teams.values())


def _rss_teams():
    if time.time() - _rss_state["at"] > 1800 or news_rss.TEAM_RX[0] is None:
        news_rss.set_teams(known_teams())
        _rss_state["at"] = time.time()


def team_name_any(tid: str):
    if not tid.isdigit():
        return None
    n = int(tid)
    if n >= espn.OFFSET:
        return espn.team_name(n)
    if n >= footballdata.OFFSET:
        return next((t["nome_popular"] for t in known_teams() if t["time_id"] == n), None)
    for cid in _plan["ids"]:  # time da API Futebol: procura na tabela em cache (sem gastar o plano)
        hit = _cache_get(f"/campeonatos/{cid}/tabela")
        if hit:
            for r in json.loads(hit[2]) if isinstance(json.loads(hit[2]), list) else []:
                if r["time"]["time_id"] == n:
                    return r["time"]["nome_popular"]
    return None


_league_names: dict[int, tuple[float, set]] = {}


def _league_team_names(cid: int) -> set:
    """Times de uma liga (pela tabela em cache), para ligar notícias de time ao campeonato."""
    hit = _league_names.get(cid)
    if hit and hit[0] > time.time():
        return hit[1]
    names = set()
    try:
        st, body, _ = route(f"/campeonatos/{cid}/tabela")
        t = json.loads(body) if st == 200 else []
        if isinstance(t, list):
            names = {_nk(r["time"]["nome_popular"]) for r in t}
    except Exception:  # noqa: BLE001 — football-data ocupada ou copa: fica só o filtro por palavra
        pass
    _league_names[cid] = (time.time() + (1800 if names else 120), names)
    return names


_league_index = {"at": 0.0, "map": {}}


def _team_domestic_league(name: str | None):
    """Liga nacional de um time pelo nome (os IDs mudam de fonte para fonte; o nome não)."""
    if time.time() - _league_index["at"] > 1800:
        idx = {}
        for lid in sorted(news_filter.DOMESTIC):
            for n in _league_team_names(lid):
                idx.setdefault(n, lid)
        if idx:
            _league_index.update(at=time.time(), map=idx)
    return _league_index["map"].get(_nk(name))


def news_labels(n: dict) -> dict:
    """Rótulos de uma notícia: os da IA quando existem, senão as regras (core/news_filter.py)."""
    team_leagues = {}
    for t in n.get("times") or []:
        lid = _team_domestic_league(t.get("nome_popular"))
        if lid:
            team_leagues[t.get("nome_popular")] = lid
    return news_filter.merge(news_filter.rule_labels(n, team_leagues), ai_news.labels_for(n.get("noticia_id") or ""))


def ai_label_news():
    """Agendador: manda para a IA as manchetes ainda sem rótulo (ai/news.py)."""
    st, body, _ = route("/campeonatos")
    comps = {c["campeonato_id"]: c.get("nome_popular") or c.get("nome") for c in (json.loads(body) if st == 200 else [])}
    if comps:  # em segundo plano: com a IA local, só usa o modelo se ele estiver livre (nunca segura uma pergunta)
        from .ai import ollama
        ollama.background(lambda: ai_news.refresh(news_rss.all_news(), comps, [t["nome_popular"] for t in known_teams()]))


def _clean_news(items):
    for n in items:
        for k in ("titulo", "resumo"):
            if n.get(k):
                n[k] = html.unescape(html.unescape(n[k]))
    return items


def news(query: dict, ids: set) -> tuple[int, bytes, str]:
    """Notícias da API Futebol (add-on; uma chamada grande em cache, filtrada aqui) + ESPN Brasil."""
    per = max(1, min(int(query.get("por_pagina") or 30), 100))
    page = max(1, int(query.get("pagina") or 1))
    tid = str(query.get("time_id") or "").split(",")[0]
    cid = int(query.get("campeonato_id") or 0) or None
    prov = query.get("provedor")
    items, sources = [], set()

    if LIVE_KEY and _denied.get("/noticias", 0) < time.time():
        st, body = _upstream("/noticias?por_pagina=100")
        if st in (401, 403):
            _denied["/noticias"] = time.time() + DENIED_TTL
        elif st == 200:
            api_items = _clean_news(json.loads(body).get("noticias", []))
            if tid:
                if tid.isdigit() and int(tid) >= espn.OFFSET:  # time da ESPN: casa pelo nome
                    name = espn.team_name(int(tid))
                    api_items = [n for n in api_items if any(_same(t.get("nome_popular"), name) for t in n.get("times", []))]
                else:
                    api_items = [n for n in api_items if any(str(t.get("time_id")) == tid for t in n.get("times", []))]
            if cid:
                slug = COMP_SLUG.get(cid)
                api_items = [n for n in api_items if slug in ((n.get("classificacao") or {}).get("competicoes") or [])]
            items += api_items
            sources.add("live")

    if ESPN_ON:
        q = {"por_pagina": str(min(50, per * page))}
        if tid and tid.isdigit() and int(tid) >= espn.OFFSET:
            q["time_id"] = tid
        elif tid:  # time da API Futebol: sem equivalente direto na ESPN
            q = None
        if cid in espn.LEAGUES:
            q and q.update(campeonato_id=str(cid))
        elif cid:
            q = None
        if q:
            st, body = espn.handle("/noticias", q)
            if st == 200:
                _rss_teams()
                for n in json.loads(body).get("noticias", []):  # a ESPN não marca os times: usa o mesmo marcador dos portais
                    if not n.get("times"):
                        n["times"] = news_rss.teams_in(f"{n.get('titulo') or ''} {n.get('resumo') or ''}")
                    items.append(n)
                sources.add("espn")

    # Portais via RSS (ge, Gazeta, Trivela, Folha, Estadão, Placar, Terra, Metrópoles)
    try:
        _rss_teams()
        rss = news_rss.all_news()
        if tid:
            name = team_name_any(tid)
            rss = [n for n in rss if any(str(t["time_id"]) == tid or (name and _same(t["nome_popular"], name)) for t in n["times"])]
        items += rss
    except Exception as e:  # noqa: BLE001 — um portal fora do ar não derruba as notícias
        sys.stderr.write(f"rss: {e!r}\n")

    seen, uniq = set(), []
    for n in sorted(items, key=lambda n: n.get("publicado_em") or "", reverse=True):
        k = _nk(n.get("titulo"))[:60]
        if k not in seen:
            seen.add(k)
            lab = news_labels(n)
            if lab["esporte"] != "futebol":
                continue  # outro esporte que escapou do filtro dos portais
            if cid and not news_filter.matches(lab, cid):
                continue  # o campeonato vem da classificação (IA ou regras), não só do nome do time
            uniq.append({**n, "campeonatos": lab["competicoes"] or lab.get("inferidas", []), "classificado_por": lab["origem"]})
    # a lista de veículos sai ANTES do filtro de veículo: assim dá para trocar de um portal para outro
    provs = {}
    for n in uniq:
        p = n.get("provedor") or {}
        if p.get("slug") and p.get("nome"):
            e = provs.setdefault(p["slug"], {"slug": p["slug"], "nome": p["nome"], "logo": p.get("logo"), "total": 0})
            e["total"] += 1
    if prov:
        wanted = set(prov.split(","))
        uniq = [n for n in uniq if (n.get("provedor") or {}).get("slug") in wanted]
    total = len(uniq)
    body = {"noticias": uniq[(page - 1) * per: page * per],
            "provedores": sorted(provs.values(), key=lambda p: (-p["total"], p["nome"].lower())),
            "paginacao": {"pagina": page, "por_pagina": per, "total": total, "total_paginas": max(1, -(-total // per))}}
    return 200, json.dumps(body, ensure_ascii=False).encode(), "live" if "live" in sources else "espn"


# ---------------------------------------------------------------- minijogo "Craque do dia"
_craques = {"exp": 0.0, "data": []}
_POS_GROUP = [("Goleiro", r"goleir|goalkeeper"), ("Defensor", r"zague|lateral|defens|defence|back|ala "),
              ("Meio-campista", r"meio|volante|meia|midfield"), ("Atacante", r"atacante|ponta|centroavante|offence|forward|winger|attack")]


def _pos_group(p):
    p = (p or "").lower()
    return next((g for g, rx in _POS_GROUP if re.search(rx, p)), None)


def craques_pool() -> list[dict]:
    """Artilheiros com atributos comparáveis (liga, time, posição, idade, nacionalidade, camisa).
    Fontes gratuitas apenas (ESPN e football-data) — não gasta o orçamento da API Futebol."""
    if _craques["exp"] > time.time() and _craques["data"]:
        return _craques["data"]
    out = []
    # Brasileirão e Libertadores (ESPN): atributos vêm do elenco de cada time
    for lid in (10, 7):
        st, body = espn.handle(f"/campeonatos/{lid}/artilharia")
        if st != 200:
            continue
        camp = espn.LEAGUES[lid]["popular"]
        for s in json.loads(body)[:40]:
            if s["gols"] < 3 or not s.get("time"):
                continue
            st2, body2 = espn.handle(f"/times/{s['time']['time_id']}/elenco")
            roster = {x["atleta"]["atleta_id"]: x for x in json.loads(body2)} if st2 == 200 else {}
            r = roster.get(s["atleta"]["atleta_id"], {})
            out.append({"id": s["atleta"]["atleta_id"], "nome": s["atleta"]["nome_popular"], "time": s["time"], "liga": camp,
                        "posicao": _pos_group((r.get("posicao") or {}).get("nome")), "idade": r.get("idade"),
                        "nacionalidade": r.get("nacionalidade"), "camisa": int(r["camisa"]) if str(r.get("camisa", "")).isdigit() else None,
                        "gols": s["gols"]})
    # Ligas europeias (football-data): os artilheiros já trazem nascimento, nacionalidade e posição
    # ligas nacionais antes da Champions: a "liga" do jogador é a do seu país
    for lid in [x for x in footballdata.ORDER if x != 106] + [106]:
        try:
            out += footballdata.craques(lid)
        except Exception:  # liga ainda não carregada (limite de 10/min): entra na próxima atualização
            continue
    seen, uniq = set(), []
    for p in out:
        if p["nome"] not in seen and p.get("posicao") and p.get("idade"):
            seen.add(p["nome"])
            uniq.append(p)
    _craques.update(exp=time.time() + (6 * 3600 if len(uniq) > 80 else 600), data=uniq)
    return uniq


# ---------------------------------------------------------------- agenda (jogos de todos os campeonatos)
_agenda = {"exp": 0.0, "body": b""}
_agenda_lock = threading.Lock()


def _rounds_list(r):
    items = r if isinstance(r, list) else [x for v in (r or {}).values() for x in (v if isinstance(v, list) else [v])]
    return sorted((x for x in items if isinstance(x, dict) and x.get("rodada") is not None), key=lambda x: x["rodada"])


def _fase_matches(f):
    out = []

    def walk(v):
        if isinstance(v, list):
            for x in v:
                walk(x)
        elif isinstance(v, dict):
            if v.get("partida_id"):
                out.append(v)
            else:
                for x in v.values():
                    walk(x)
    walk((f or {}).get("partidas"))
    for c in (f or {}).get("chaves") or []:
        walk(c.get("partida_ida"))
        walk(c.get("partida_volta"))
    return out


def agenda() -> bytes:
    """Rodada anterior, atual e próxima de cada liga e a fase atual (com a anterior e a próxima) de cada copa,
    numa resposta só. Antes o navegador montava isso sozinho com ~5 chamadas por campeonato: com 40
    campeonatos passava do limite de requisições por visitante."""
    if _agenda["exp"] > time.time():
        return _agenda["body"]
    with _agenda_lock:  # várias visitas ao mesmo tempo montam a agenda uma vez só
        if _agenda["exp"] > time.time():
            return _agenda["body"]
        st, body, _ = route("/campeonatos")
        comps = json.loads(body) if st == 200 else []

        def get(p):
            st, b, _ = route(p)
            return json.loads(b) if st == 200 else None

        def one(c):
            cid = c["campeonato_id"]
            try:
                if c.get("rodada_atual"):
                    nums = [r["rodada"] for r in _rounds_list(get(f"/campeonatos/{cid}/rodadas"))]
                    cur = c["rodada_atual"]["rodada"]
                    i = nums.index(cur) if cur in nums else -1
                    want = nums[max(0, i - 1): i + 2] if i >= 0 else [cur]
                    return [m for n in want for m in ((get(f"/campeonatos/{cid}/rodadas/{n}") or {}).get("partidas") or [])]
                if c.get("fase_atual"):
                    ids = [c["fase_atual"]["fase_id"]]
                    fases = (get(f"/campeonatos/{cid}") or {}).get("fases") or []
                    k = next((j for j, f in enumerate(fases) if f.get("fase_id") == ids[0]), -1)
                    if 0 <= k < len(fases) - 1:
                        ids.append(fases[k + 1]["fase_id"])
                    if k > 0:
                        ids.append(fases[k - 1]["fase_id"])
                    return [m for fid in ids for m in _fase_matches(get(f"/campeonatos/{cid}/fases/{fid}"))]
            except Exception as e:  # noqa: BLE001 — um campeonato com problema não tira os outros da agenda
                sys.stderr.write(f"agenda {cid}: {e!r}\n")
            return []

        with ThreadPoolExecutor(8) as ex:
            lists = list(ex.map(one, comps))
        # só o que as telas usam (calendário, destaques, bolão): de 21 dias atrás a 30 dias à frente. Uma fase de
        # liga inteira (Europa League, Liga das Nações) traria meses de jogos à toa.
        lo, hi = datetime.now(BRT) - timedelta(days=21), datetime.now(BRT) + timedelta(days=30)

        def in_window(m):
            try:
                return lo <= datetime.strptime(m["data_realizacao_iso"], "%Y-%m-%dT%H:%M:%S%z") <= hi
            except (KeyError, TypeError, ValueError):
                return True  # sem data (a definir): fica
        seen, out = set(), []
        for ms in lists:
            for m in ms:
                if m.get("partida_id") not in seen and in_window(m):
                    seen.add(m.get("partida_id"))
                    out.append(m)
        body = json.dumps(out, ensure_ascii=False).encode()
        _agenda.update(exp=time.time() + 60, body=body)
        return body


# ---------------------------------------------------------------- roteamento
def route(path: str, query: dict | None = None) -> tuple[int, bytes, str]:
    query = query or {}
    camps, ids = plan()

    if path == "/campeonatos":
        merged = list(camps)
        if ESPN_ON:
            st, body = espn.handle(path)
            if st == 200:
                merged += [c for c in json.loads(body) if c["campeonato_id"] not in ids]
        if footballdata.TOKEN:
            st, body = footballdata.handle(path)
            if st == 200:
                merged += json.loads(body)
        rank = {cid: i for i, cid in enumerate(PRIORITY)}
        merged.sort(key=lambda c: rank.get(int(c["campeonato_id"]), 99))
        return 200, json.dumps(merged, ensure_ascii=False).encode(), "live" if camps else "espn"

    if path == "/agenda":
        return 200, agenda(), "server"

    if path == "/ao-vivo":
        live = live_for_plan(ids)
        if not economy() and ids:  # plano grande: usa o ao vivo oficial
            st, body = _upstream(path)
            if st == 200:
                live = json.loads(body)
        if ESPN_ON:
            live += espn.ao_vivo(exclude=ids)
        if footballdata.TOKEN:
            try:
                for m in footballdata.ao_vivo():  # minuto e placar em tempo real pela ESPN
                    code = footballdata.LEAGUES.get(m["campeonato"]["campeonato_id"], {}).get("code")
                    live.append(espn.bridge(m, code, detail=False) if code else m)
            except Exception:  # noqa: BLE001 — sem a Europa, segue com o resto
                pass
        return 200, json.dumps(live, ensure_ascii=False).encode(), "live" if ids else "espn"

    if path == "/noticias":
        return news({k: v for k, v in query.items() if k in NEWS_PARAMS}, ids)

    if path == "/jogador-tm":
        nome = (query.get("nome") or "").strip()
        if not nome:
            return 400, b'{"message":"Informe o nome"}', "transfermarkt"
        idade = int(query["idade"]) if str(query.get("idade", "")).isdigit() else None
        p = transfermarkt.player(nome, query.get("clube") or None, idade)
        return (200, json.dumps(p, ensure_ascii=False).encode(), "transfermarkt") if p else (404, b'{"message":"Jogador n\\u00e3o encontrado no Transfermarkt"}', "transfermarkt")

    if path == "/time-tm":  # perfil do clube, títulos e elenco detalhado (Transfermarkt)
        nome = (query.get("nome") or "").strip()
        if not nome:
            return 400, b'{"message":"Informe o nome"}', "transfermarkt"
        c = transfermarkt.club(nome, query.get("nome_completo") or None, query.get("pais") or None)
        return (200, json.dumps(c, ensure_ascii=False).encode(), "transfermarkt") if c else (404, b'{"message":"Clube n\\u00e3o encontrado no Transfermarkt"}', "transfermarkt")

    if path == "/estadio":  # foto, mapa e panoramas 360° do estádio (Wikipédia/Wikidata/Commons)
        nome, clube = (query.get("nome") or "").strip()[:120], (query.get("clube") or "").strip()[:80]
        if not nome and not clube:
            return 400, b'{"message":"Informe o nome do est\\u00e1dio"}', "wikimedia"
        e = stadium.lookup(nome, clube or None)
        return (200, json.dumps(e, ensure_ascii=False).encode(), "wikimedia") if e else (404, b'{"message":"Est\\u00e1dio n\\u00e3o encontrado"}', "wikimedia")

    m = re.match(r"^/campeonatos/(\d+)/chances$", path)
    if m:  # probabilidades de título, vagas e rebaixamento (simulação)
        try:
            c = chances(int(m.group(1)))
        except footballdata.Busy:
            return 503, b'{"message":"Carregando os dados desta liga. Tente em instantes."}', "server"
        return (200, json.dumps(c, ensure_ascii=False).encode(), "server") if c else (404, b'{"message":"Chances dispon\\u00edveis s\\u00f3 para ligas de pontos corridos"}', "server")

    if path.startswith("/esportes/"):  # basquete (NBA) e Fórmula 1
        st, body = sports.handle(path[len("/esportes"):], query)
        return st, body, "espn"

    if path == "/transmissoes":
        return 200, json.dumps(tv_guide(), ensure_ascii=False).encode(), "server"

    if path == "/minijogos/craques":
        return 200, json.dumps(craques_pool(), ensure_ascii=False).encode(), "server"

    if footballdata.owns(path):  # ligas europeias e IDs da football-data.org
        return (*footballdata.handle(path), "football-data")

    m = re.match(r"^/campeonatos/(\d+)", path)
    if m:
        cid = int(m.group(1))
        if cid in ids:
            st, body = _upstream(path)
            if st == 200:
                return 200, canon_body(body, cid), "live"
            if not ESPN_ON:
                return st, body, "live"
        return (*espn.handle(path), "espn") if ESPN_ON else (403, b'{"message":"Campeonato fora do plano"}', "live")

    m = re.match(r"^/(partidas|times|atletas)/(\d+)", path)
    if m and int(m.group(2)) >= espn.OFFSET:
        return (*espn.handle(path), "espn")
    if m and m.group(1) == "times" and int(m.group(2)) in identity.api_to_canon and ESPN_ON:
        # time da API Futebol que já tem ID canônico (ESPN): mesma página, sem gastar o plano diário
        canon = identity.api_to_canon[int(m.group(2))]["time_id"]
        return (*espn.handle(path.replace(f"/times/{m.group(2)}", f"/times/{canon}", 1)), "espn")
    st, body = _upstream(path, essential=path.startswith("/partidas/"))
    if st == 200 and path.startswith("/partidas/"):  # aplica o placar ao vivo da ESPN, se houver
        pid = int(m.group(2))
        d = json.loads(body)
        if pid in _overlay:
            d.update({k: v for k, v in _overlay[pid].items() if k in ("placar_mandante", "placar_visitante", "status", "periodo", "cronometro", "cronometro_label")})
        cid = (d.get("campeonato") or {}).get("campeonato_id")
        body = canon_body(json.dumps(d, ensure_ascii=False).encode(), cid) if cid else json.dumps(d, ensure_ascii=False).encode()
    return st, body, "live"


def _espn_teams(cid: int) -> list[dict]:
    """Times de um campeonato na ESPN (lista canônica para core/identity.py)."""
    if not ESPN_ON or cid not in espn.LEAGUES:
        return []
    out = {}
    for e in espn._events(cid):
        for c in e["competitions"][0]["competitors"]:
            t = espn.team(c["team"])
            out.setdefault(t["time_id"], t)
    return list(out.values())


def canon_body(body: bytes, cid) -> bytes:
    """Resposta da API Futebol com os times no ID canônico (ver core/identity.py)."""
    try:
        return json.dumps(identity.canonicalize(json.loads(body), int(cid), _espn_teams), ensure_ascii=False).encode()
    except (ValueError, TypeError):
        return body


# ---------------------------------------------------------------- probabilidades (diferencial)
_chances: dict[int, tuple[float, dict]] = {}
_ratings = {"at": 0.0, "idx": {}}
_chances_lock = threading.Lock()


def _league_data(cid):
    """(tabela, jogos da temporada, faixas) de uma liga de pontos corridos; None para copas."""
    if cid in footballdata.LEAGUES and footballdata.LEAGUES[cid]["code"] != "CL":
        rows = footballdata.tabela(cid)
        ms = [footballdata.match(m, cid) for m in footballdata.season_matches(cid)]
        return rows, ms, footballdata.ZONES.get(footballdata.LEAGUES[cid]["code"], [])
    if cid in espn.LEAGUES and espn.LEAGUES[cid]["league"]:
        rows = espn.tabela(cid)
        return rows, espn._all_matches(cid)[0], espn.ZONES.get(cid, [])
    return None


def _fraction(m):
    if m["status"] != "andamento":
        return 1.0, (0, 0)
    mins = m.get("cronometro") or (45 if m.get("periodo") == "intervalo" else 60)
    return max(0.02, (90 - min(mins, 90)) / 90), (m.get("placar_mandante") or 0, m.get("placar_visitante") or 0)


def chances(cid: int):
    hit = _chances.get(cid)
    if hit and hit[0] > time.time():
        return hit[1]
    with _chances_lock:  # uma simulação por vez
        hit = _chances.get(cid)
        if hit and hit[0] > time.time():
            return hit[1]
        data = _league_data(cid)
        if not data or not isinstance(data[0], list) or not data[0]:
            return None
        rows, ms, zones = data
        pending = [m for m in ms if m["status"] in ("agendado", "adiado", "andamento")]
        fixtures = []
        for m in pending:
            frac, cur = _fraction(m)
            fixtures.append({"casa": m["time_mandante"]["time_id"], "fora": m["time_visitante"]["time_id"], "placar_atual": cur, "fracao": frac})
        result = prob.simulate(rows, fixtures, zones)
        mu, rat = prob.ratings(rows)
        result.update({
            "campeonato_id": cid, "zonas": [{"de": lo, "ate": hi, "chave": k} for lo, hi, k in zones],
            "tabela": rows, "atualizado_em": datetime.now(BRT).strftime("%Y-%m-%dT%H:%M:%S%z"),
            "jogos": [{"partida_id": m["partida_id"], "rodada": m.get("rodada_numero"), "data": m.get("data_realizacao_iso"), "status": m["status"],
                       "time_mandante": m["time_mandante"], "time_visitante": m["time_visitante"],
                       "placar_mandante": m.get("placar_mandante"), "placar_visitante": m.get("placar_visitante"),
                       "probabilidades": prob.outcome(*prob.expected_goals(mu, rat.get(m["time_mandante"]["time_id"], (1, 1)), rat.get(m["time_visitante"]["time_id"], (1, 1))))}
                      for m in sorted(pending, key=lambda m: m.get("data_realizacao_iso") or "9")],
        })
        _chances[cid] = (time.time() + 600, result)
        return result


def rating_index(block=True):
    """Força (ataque/defesa) de todos os times das ligas em cache, pelo nome — serve também para copas.
    block=False (visitantes): devolve o que houver e recalcula em segundo plano, sem travar a página."""
    if time.time() - _ratings["at"] < 1800 and _ratings["idx"]:
        return _ratings["idx"]
    if not block:
        if not _ratings.get("busy"):
            _ratings["busy"] = True
            threading.Thread(target=lambda: (rating_index(), _ratings.update(busy=False)), daemon=True).start()
        return _ratings["idx"]
    idx = {}
    for cid in [10, 14] + [c for c in footballdata.ORDER if c != 106]:
        try:
            data = _league_data(cid)
            if data and isinstance(data[0], list) and data[0]:
                idx.update(prob.name_index(data[0], prob.ratings(data[0])))
        except Exception:  # noqa: BLE001 — liga ainda não carregada
            continue
    _ratings.update(at=time.time(), idx=idx)
    return idx


def with_probabilities(body: bytes) -> bytes:
    """Anexa à partida: chance de vitória antes do jogo e, se estiver rolando, ao vivo."""
    try:
        m = json.loads(body)
        idx = rating_index(block=False)
        if not idx:
            return body
        h = idx.get(prob._norm(m["time_mandante"]["nome_popular"]))
        a = idx.get(prob._norm(m["time_visitante"]["nome_popular"]))
        mu = (h or a or (1.3, None))[0]
        lh, la = prob.expected_goals(mu, h[1] if h else (1, 1), a[1] if a else (1, 1))
        out = {"pre": prob.outcome(lh, la), "gols_esperados": {"casa": round(lh, 2), "fora": round(la, 2)}, "confianca": "alta" if h and a else "baixa"}
        if m.get("status") == "andamento":
            frac, cur = _fraction(m)
            out["ao_vivo"] = prob.outcome(lh, la, cur, frac)
        m["probabilidades"] = out
        return json.dumps(m, ensure_ascii=False).encode()
    except Exception:  # noqa: BLE001 — sem probabilidade, a partida segue normal
        return body


# ---------------------------------------------------------------- onde assistir
TV_FILE = config.DATA / "transmissoes.json"
_tv = {"mtime": 0.0, "data": {}}


def tv_guide() -> dict:
    """transmissoes.json (editável): relido quando o arquivo muda."""
    try:
        mt = TV_FILE.stat().st_mtime
        if mt != _tv["mtime"]:
            _tv.update(mtime=mt, data=json.loads(TV_FILE.read_text(encoding="utf-8")))
    except (OSError, ValueError) as e:
        sys.stderr.write(f"transmissoes.json: {e!r}\n")
    return _tv["data"]


WATCH_RX = re.compile(r"onde assistir|onde ver|transmiss[ãa]o|vai passar|ao vivo e online", re.I)


def where_to_watch(m: dict) -> dict | None:
    """Canais do campeonato + a matéria "onde assistir" deste jogo publicada pelos portais (quando houver)."""
    g = tv_guide()
    cid = str((m.get("campeonato") or {}).get("campeonato_id") or "")
    camp = (g.get("campeonatos") or {}).get(cid)
    out = {"canais": (camp or {}).get("canais", []), "nota": (camp or {}).get("nota"), "atualizado_em": g.get("atualizado_em")}
    try:
        h, a = _nk(m["time_mandante"]["nome_popular"]), _nk(m["time_visitante"]["nome_popular"])
        when = datetime.strptime(m["data_realizacao_iso"], "%Y-%m-%dT%H:%M:%S%z") if m.get("data_realizacao_iso") else None
        for n in news_rss.all_news():
            title = _nk(n.get("titulo"))
            if not WATCH_RX.search(n.get("titulo") or "") or h[:5] not in title or a[:5] not in title:
                continue
            pub = datetime.strptime(n["publicado_em"], "%Y-%m-%dT%H:%M:%S%z") if n.get("publicado_em") else None
            if when and pub and not (when - timedelta(days=4) <= pub <= when + timedelta(hours=3)):
                continue
            out["materia"] = {"titulo": n["titulo"], "link": n["link"], "veiculo": (n.get("provedor") or {}).get("nome")}
            break
    except Exception:  # noqa: BLE001
        pass
    return out if out["canais"] or out.get("materia") else None


def enrich_match(body: bytes) -> bytes:
    try:
        m = json.loads(body)
        lid = (m.get("campeonato") or {}).get("campeonato_id")
        if m.get("partida_id", 0) >= footballdata.OFFSET and m["partida_id"] < espn.OFFSET and lid in footballdata.LEAGUES:
            m = espn.bridge(m, footballdata.LEAGUES[lid]["code"])  # minuto, escalações e lances da ESPN
        w = where_to_watch(m)
        if w:
            m["onde_assistir"] = w
        body = json.dumps(m, ensure_ascii=False).encode()
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"enrich_match: {e!r}\n")
    return with_probabilities(body)


# ---------------------------------------------------------------- tempo real (Server-Sent Events)
class LiveHub:
    """Observa os jogos ao vivo a cada 15 s e empurra as mudanças para todos os navegadores conectados.
    Um único ciclo atende todos os visitantes: o consumo das APIs não cresce com a audiência."""
    INTERVAL = 15
    MAX_CLIENTS = int(os.environ.get("MAX_STREAMS", "500"))

    def __init__(self):
        self.clients: set[queue.Queue] = set()
        self.lock = threading.Lock()
        self.state: dict[int, dict] = {}
        self.live: list[dict] = []
        self.other: dict = {"nba": [], "f1": None}
        self.other_sig = ""
        self.ready = False

    def subscribe(self):
        with self.lock:
            if len(self.clients) >= self.MAX_CLIENTS:
                return None
            q = queue.Queue(maxsize=100)
            self.clients.add(q)
            return q

    def unsubscribe(self, q):
        with self.lock:
            self.clients.discard(q)

    def publish(self, event: str, data):
        msg = f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False, separators=(',', ':'))}\n\n".encode()
        with self.lock:
            for q in list(self.clients):
                try:
                    q.put_nowait(msg)
                except queue.Full:  # navegador lento: descarta o cliente, ele reconecta sozinho
                    self.clients.discard(q)

    @staticmethod
    def _sig(m):
        return (m.get("placar_mandante"), m.get("placar_visitante"), m.get("status"), m.get("periodo"), m.get("cronometro_label") or m.get("cronometro"))

    def _scorer(self, m, side):
        """Autor do último gol (quando a fonte informa)."""
        try:
            pid = m["partida_id"]
            if pid >= espn.OFFSET:
                d = espn.partida(pid)
                gols = sorted(d.get("gols", {}).get(side, []), key=lambda g: g.get("ordem_seg") or 0)
                if gols:
                    g = gols[-1]
                    return {"nome": (g.get("atleta") or {}).get("nome_popular"), "minuto": g.get("minuto_label"), "penalti": g.get("penalti"), "contra": g.get("gol_contra")}
        except Exception:  # noqa: BLE001
            pass
        return None

    def tick(self):
        st, body, _ = route("/ao-vivo")
        if st != 200:
            return
        live = json.loads(body)
        now = {m["partida_id"]: m for m in live}
        changed = False
        for pid, m in now.items():
            old = self.state.get(pid)
            if old is None or self._sig(old) != self._sig(m):
                changed = True
            if old is not None and self.ready:
                for side, key in (("mandante", "placar_mandante"), ("visitante", "placar_visitante")):
                    if (m.get(key) or 0) > (old.get(key) or 0):
                        team = m["time_mandante" if side == "mandante" else "time_visitante"]
                        self.publish("gol", {"partida": m, "lado": side, "time": team, "autor": self._scorer(m, side)})
                if old.get("periodo") != m.get("periodo") and m.get("periodo") == "intervalo":
                    self.publish("periodo", {"partida": m, "texto": "Intervalo"})
            elif old is None and self.ready:
                self.publish("periodo", {"partida": m, "texto": "Começou"})
        for pid, old in self.state.items():
            if pid not in now and self.ready:  # saiu do ao vivo: terminou
                changed = True
                self.publish("periodo", {"partida": {**old, "status": "finalizado", "periodo": "fim-de-jogo"}, "texto": "Fim de jogo"})
        self.state, self.live, self.ready = now, live, True
        if changed:
            self.publish("update", live)
        # outros esportes: NBA rolando e sessão de F1 em andamento
        try:
            other = sports.live_summary()
            sig = json.dumps(other, sort_keys=True, ensure_ascii=False)
            if sig != self.other_sig:
                self.other_sig, self.other = sig, other
                self.publish("outros", other)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"outros esportes: {e!r}\n")

    def run(self):
        while True:
            try:
                self.tick()
            except Exception as e:  # noqa: BLE001 — o ciclo nunca para
                sys.stderr.write(f"ao vivo: {e!r}\n")
            time.sleep(self.INTERVAL)


HUB = LiveHub()


def status_payload() -> bytes:
    camps, ids = plan()
    b = _budget()
    return json.dumps({
        "api_futebol": {"chave": bool(LIVE_KEY), "plano": _plan["info"], "campeonatos_no_plano": sorted(ids),
                        "orcamento_hoje": {"usadas": b["usadas"], "limite": _plan["limit"], "restantes": max(0, _plan["limit"] - b["usadas"])},
                        "modo": "econômico (plano pequeno)" if economy() else "normal"},
        "espn": {"ativo": ESPN_ON, **espn.stats},
        "nba_f1": sports.stats,
        "ia": ai.status(),
        "football_data": {"ativo": bool(footballdata.TOKEN), "limite": "10/min", **footballdata.stats},
        "tempo_real": {"conexoes": len(HUB.clients), "jogos_ao_vivo": len(HUB.live)},
        "portais_rss": news_rss.stats,
        "requisicoes": {k: v for k, v in _stats.items() if k != "started"},
        "uptime_s": int(time.time() - _stats["started"]),
    }, ensure_ascii=False).encode()


# ---------------------------------------------------------------- agendador (cron)
def scheduler():
    """Mantém o cache quente; os TTLs já limitam quantas chamadas cada recurso faz por dia."""
    footballdata._tl.can_wait = True  # só este thread espera vaga no limite de 10/min
    last: dict[str, float] = {}

    def f1_warm():
        o = json.loads(sports.handle("/f1")[1])
        done = [r["rodada"] for r in o.get("calendario", []) if r.get("status") == "finalizada"]
        if done:
            sports.handle(f"/f1/corrida/{done[-1]}/analise")

    def every(key, seconds, fn):
        if time.time() - last.get(key, 0) >= seconds:
            last[key] = time.time()
            try:
                fn()
            except Exception:  # noqa: BLE001 — falha de uma rodada não para o agendador
                pass

    def tables():
        st, body, _ = route("/campeonatos")
        for c in json.loads(body) if st == 200 else []:
            cid = c["campeonato_id"]
            if cid in footballdata.LEAGUES:
                continue  # aquecidas uma a uma em fd_warm (limite de 10/min)
            route(f"/campeonatos/{cid}/tabela")
            if c.get("rodada_atual"):
                route(f"/campeonatos/{cid}/rodadas/{c['rodada_atual']['rodada']}")

    fd_queue = list(footballdata.ORDER)

    def fd_warm():  # uma liga europeia por vez: ~2 chamadas a cada 25 s, bem abaixo de 10/min
        lid = fd_queue.pop(0)
        fd_queue.append(lid)
        route(f"/campeonatos/{lid}/tabela")
        route(f"/campeonatos/{lid}")
        route(f"/campeonatos/{lid}/artilharia")  # também alimenta o minijogo Craque do dia

    while True:
        if ESPN_ON:
            every("espn", 60, espn.warm)  # temporadas das ~30 ligas da ESPN sempre em cache (em paralelo)
        every("agenda", 55, agenda)  # agenda da página inicial pronta antes do visitante pedir
        every("tabelas", 300, tables)
        every("noticias", 600, lambda: route("/noticias", {"por_pagina": "20"}))
        every("craques", 1800, craques_pool)  # minijogo Craque do dia pronto antes do primeiro jogador
        every("forcas", 1500, rating_index)  # probabilidades das partidas prontas antes do visitante pedir
        every("limpeza", 3600, auth.cleanup)  # sessões, códigos e desafios vencidos
        every("f1-analise", 3 * 3600, f1_warm)  # análise da última corrida (OpenF1) pronta antes do visitante pedir
        if ai.background_news():
            every("ia-noticias", 900, ai_label_news)  # IA rotula as manchetes novas (campeonato, categoria, times)
        if footballdata.TOKEN:
            every("fd", 25, fd_warm)
        time.sleep(5)


# ---------------------------------------------------------------- HTTP (produção)
MIME = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json", ".svg": "image/svg+xml",
        ".png": "image/png", ".ico": "image/x-icon", ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp", ".jpg": "image/jpeg", ".txt": "text/plain; charset=utf-8", ".xml": "application/xml"}
COMPRESSIBLE = (".html", ".css", ".js", ".json", ".webmanifest", ".svg", ".txt", ".xml")
CSP = ("default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; "
       "font-src 'self' https://fonts.gstatic.com; media-src 'self' https://livetiming.formula1.com; script-src 'self' 'unsafe-inline'; connect-src 'self'; "
       "manifest-src 'self'; worker-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'")
TRUST_PROXY = os.environ.get("TRUST_PROXY", "1") != "0"  # atrás do proxy da hospedagem (Render, Railway, Fly...)
STATUS_TOKEN = os.environ.get("STATUS_TOKEN", "")
# Limite por visitante (IP): protege as cotas das APIs. Rotas que acessam o Transfermarkt são mais caras.
RATE = {"api": (int(os.environ.get("RATE_API_MIN", "240")), 60), "heavy": (int(os.environ.get("RATE_HEAVY_MIN", "20")), 60)}
HEAVY = re.compile(r"^/(jogador-tm|time-tm|estadio)$")
AUTH_PATH = re.compile(r"^/(auth|conta)(/[\w-]+){1,2}$")
AI_POST = {"/ia/perguntar"}
_frames = []  # iframes de fora liberados um a um
if auth.TURNSTILE_SITE and auth.TURNSTILE_SECRET:  # captcha da Cloudflare: libera só o domínio dela
    CSP = CSP.replace("script-src 'self' 'unsafe-inline'", "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com")
    _frames.append("https://challenges.cloudflare.com")
if stadium.EMBED_KEY:  # Street View do estádio (opcional): só o iframe do Google Maps
    _frames.append("https://www.google.com")
if _frames:
    CSP = CSP.replace("frame-ancestors", f"frame-src {' '.join(_frames)}; frame-ancestors")

_static: dict[str, tuple[float, bytes, bytes, str]] = {}  # caminho -> (mtime, corpo, corpo gzip, etag)
# Frontend: o app novo (React, compilado em web/dist) tem prioridade; o clássico (public/) atende o resto e fica em /classic
WEB_DIST = config.ROOT / "web" / "dist"
def _roots():
    return [r for r in (WEB_DIST, PUBLIC) if (r / "index.html").is_file()]
_hits: dict[tuple[str, str], list[float]] = {}
_hits_lock = threading.Lock()


# ---------------------------------------------------------------- proxy de imagens (escudos e logos)
IMG_HOSTS = ("a.espncdn.com", "crests.football-data.org", "cdn.api-futebol.com.br", "media.formula1.com", "flagcdn.com",
             "upload.wikimedia.org", "img.a.transfermarkt.technology", "tmssl.akamaized.net")
IMG_MAX = 2_000_000
_img_cache: dict[str, tuple[float, bytes, str]] = {}
_img_lock = threading.Lock()


def image_proxy(url: str):
    """Baixa uma imagem de um dos sites de escudos permitidos (e só deles) e devolve (status, bytes, tipo).
    Não segue para outros domínios: evita que o servidor vire um proxy aberto."""
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return 400, b"", ""
    if u.scheme != "https" or (u.hostname or "") not in IMG_HOSTS:
        return 400, b"", ""
    now = time.time()
    with _img_lock:
        hit = _img_cache.get(url)
    if hit and hit[0] > now:
        return 200, hit[1], hit[2]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Vyra/2.0"})
        with urllib.request.urlopen(req, timeout=10) as r:
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip().lower()
            if r.geturl() and (urllib.parse.urlsplit(r.geturl()).hostname or "") not in IMG_HOSTS:
                return 400, b"", ""
            if not ctype.startswith("image/") or ctype == "image/svg+xml":  # SVG pode carregar script: fica de fora
                return 415, b"", ""
            body = r.read(IMG_MAX + 1)
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        return 502, b"", ""
    if len(body) > IMG_MAX:
        return 413, b"", ""
    with _img_lock:
        _img_cache[url] = (now + 7 * 86400, body, ctype)
        if len(_img_cache) > 600:
            for k in sorted(_img_cache, key=lambda k: _img_cache[k][0])[:200]:
                _img_cache.pop(k, None)
    return 200, body, ctype


def _allow(ip: str, kind: str) -> bool:
    limit, window = RATE[kind]
    now = time.time()
    with _hits_lock:
        q = [t for t in _hits.get((ip, kind), []) if now - t < window]
        ok = len(q) < limit
        if ok:
            q.append(now)
        _hits[(ip, kind)] = q
        if len(_hits) > 50_000:  # memória limitada mesmo com muitos IPs
            _hits.clear()
        return ok


def _static_file(rel: str, roots=None):
    """Procura o arquivo nas pastas do frontend: o app novo (web/dist, se compilado) e depois o clássico (public)."""
    for root in roots or _roots():
        p = (root / rel.lstrip("/")).resolve()
        if (root.resolve() in p.parents or p == root.resolve()) and p.is_file():
            break
    else:
        return None
    mtime = p.stat().st_mtime
    hit = _static.get(str(p))
    if hit and hit[0] == mtime:
        return hit
    body = p.read_bytes()
    gz = gzip.compress(body, 6) if p.suffix in COMPRESSIBLE and len(body) > 512 else b""
    entry = (mtime, body, gz, '"' + hashlib.sha1(body).hexdigest()[:16] + '"')
    _static[str(p)] = entry
    return entry


class Handler(BaseHTTPRequestHandler):
    server_version = "Vyra"
    sys_version = ""
    timeout = 30
    protocol_version = "HTTP/1.1"

    # -------- utilidades
    def _ip(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if TRUST_PROXY and fwd else self.client_address[0]

    def _gzip_ok(self):
        return "gzip" in (self.headers.get("Accept-Encoding") or "")

    def _common_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
        self.send_header("Content-Security-Policy", CSP)
        if self.headers.get("X-Forwarded-Proto") == "https":
            self.send_header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")

    def _send(self, status, body: bytes, ctype, cache, extra=None, gz: bytes = b"", head=False):
        use_gz = bool(gz) and self._gzip_ok()
        if not gz and len(body) > 1024 and self._gzip_ok() and ctype.split(";")[0] in ("application/json", "text/html"):
            gz, use_gz = gzip.compress(body, 5), True
        payload = gz if use_gz else body
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", cache)
        self.send_header("Vary", "Accept-Encoding")
        if use_gz:
            self.send_header("Content-Encoding", "gzip")
        for k, v in (extra.items() if isinstance(extra, dict) else extra or []):  # lista: permite vários Set-Cookie
            self.send_header(k, v)
        self._common_headers()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if not head:
            self.wfile.write(payload)
        self._status = status

    def _json(self, status: int, body: bytes, source: str):
        self._send(status, body, "application/json; charset=utf-8", "no-store", {"X-Data-Source": source})

    # -------- rotas
    def do_HEAD(self):
        self._serve(head=True)

    def do_GET(self):
        self._serve(head=False)

    def do_POST(self):
        self._t0, self._status = time.time(), 0
        try:
            parsed = urllib.parse.urlsplit(self.path)
            path = parsed.path[4:].rstrip("/") if parsed.path.startswith("/api/") else ""
            if not AUTH_PATH.match(path) and path not in AI_POST:
                return self._json(405, b'{"message":"M\\u00e9todo n\\u00e3o permitido"}', "server")
            return self._auth("POST", path, parsed)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"erro em POST {self.path}: {e!r}\n")
            try:
                self._json(500, b'{"message":"Erro interno"}', "server")
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._log()

    def _cookies(self) -> dict:
        try:
            c = SimpleCookie(self.headers.get("Cookie") or "")
            return {k: m.value for k, m in c.items()}
        except CookieError:
            return {}

    def _auth(self, method, path, parsed):
        """Contas: /api/auth/* e /api/conta/* (auth.py)."""
        body = {}
        if method == "POST":
            n = int(self.headers.get("Content-Length") or 0)
            if n > 256_000:
                self.close_connection = True
                return self._json(413, b'{"message":"Corpo grande demais"}', "server")
            raw = self.rfile.read(n) if n else b""
            if raw:
                if "application/json" not in (self.headers.get("Content-Type") or ""):
                    return self._json(415, b'{"message":"Envie JSON"}', "server")
                try:
                    body = json.loads(raw)
                except ValueError:
                    return self._json(400, b'{"message":"JSON inv\\u00e1lido"}', "server")
                if not isinstance(body, dict):
                    return self._json(400, b'{"message":"JSON inv\\u00e1lido"}', "server")
        fwd_proto = self.headers.get("X-Forwarded-Proto", "") if TRUST_PROXY else ""
        ctx = {"ip": self._ip(), "cookies": self._cookies(), "host": self.headers.get("Host", ""),
               "proto": "https" if fwd_proto == "https" else "http", "origin": self.headers.get("Origin"),
               "xrw": self.headers.get("X-Requested-With"), "ua": self.headers.get("User-Agent", "")}
        if path in AI_POST:  # assistente: mesma proteção CSRF das contas (cabeçalho próprio + origem do site)
            origin = ctx["origin"] or ""
            if ctx["xrw"] != "placar" or (origin and urllib.parse.urlsplit(origin).netloc != ctx["host"]):
                return self._json(403, b'{"message":"Requisi\\u00e7\\u00e3o bloqueada por seguran\\u00e7a."}', "server")
            st, obj = ai_routes.handle_post(path, body, ctx)
            headers = []
        else:
            st, obj, headers = auth.handle(method, path, dict(urllib.parse.parse_qsl(parsed.query)), body, ctx)
        if st in (301, 302, 303):
            self.send_response(st)
            for k, v in headers:
                self.send_header(k, v)
            self.send_header("Cache-Control", "no-store")
            self._common_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
            self._status = st
            return None
        return self._send(st, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8", "no-store",
                          [("X-Data-Source", "server"), *headers])

    def _serve(self, head):
        self._t0, self._status = time.time(), 0
        try:
            parsed = urllib.parse.urlsplit(self.path)
            if parsed.path == "/healthz":  # verificação de saúde da hospedagem
                return self._send(200, json.dumps({"ok": True, "uptime_s": int(time.time() - _stats["started"])}).encode(),
                                  "application/json", "no-store", head=head)
            if parsed.path.startswith("/api/"):
                return self._api(parsed)
            return self._static(parsed, head)
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:  # noqa: BLE001 — nunca derruba a conexão sem resposta
            sys.stderr.write(f"erro em {self.path}: {e!r}\n")
            try:
                self._json(500, b'{"message":"Erro interno"}', "server")
            except Exception:  # noqa: BLE001
                pass
        finally:
            self._log()

    def _api(self, parsed):
        path = parsed.path[4:].rstrip("/")
        query = dict(urllib.parse.parse_qsl(parsed.query))
        ip = self._ip()
        if path == "/_status":  # protegido: só com STATUS_TOKEN ou a partir da própria máquina
            if (STATUS_TOKEN and query.get("token") == STATUS_TOKEN) or (not STATUS_TOKEN and self.client_address[0] in ("127.0.0.1", "::1")):
                return self._json(200, status_payload(), "server")
            return self._json(403, b'{"message":"Acesso restrito"}', "server")
        if path == "/stream":
            return self._stream()
        if path == "/img":  # escudos e logos de outros sites servidos daqui (o card de compartilhar precisa da mesma origem)
            if not _allow(ip, "api"):
                return self._json(429, b'{"message":"Muitas requisi\\u00e7\\u00f5es."}', "server")
            st, body, ctype = image_proxy(query.get("u", ""))
            if st != 200:
                return self._json(st, b'{"message":"Imagem indispon\\u00edvel"}', "server")
            return self._send(200, body, ctype, "public, max-age=604800")
        if AUTH_PATH.match(path):
            return self._auth("GET", path, parsed)
        if path.startswith("/ia/"):  # camada de IA (ai_routes.py)
            if not _allow(ip, "api"):
                return self._json(429, b'{"message":"Muitas requisi\\u00e7\\u00f5es."}', "server")
            st, obj = ai_routes.handle_get(path, query, ip)
            return self._json(st, json.dumps(obj, ensure_ascii=False).encode(), "ia")
        if not any(r.match(path) for r in ALLOWED):  # /me nunca é exposto: devolve as chaves
            return self._json(404, b'{"message":"Rota n\\u00e3o suportada"}', "server")
        if not _allow(ip, "api") or (HEAVY.match(path) and not _allow(ip, "heavy")):
            return self._send(429, b'{"message":"Muitas requisi\\u00e7\\u00f5es. Aguarde um instante."}', "application/json; charset=utf-8",
                              "no-store", {"Retry-After": "30"})
        try:
            st, body, src = route(path, query)
            if st == 200 and re.match(r"^/partidas/\d+$", path):
                body = enrich_match(body)  # ESPN (Europa), onde assistir e chance de vitória
            return self._json(st, body, src)
        except Exception as e:  # noqa: BLE001 — uma fonte com problema não derruba o servidor
            sys.stderr.write(f"erro na API {path}: {e!r}\n")
            return self._json(502, json.dumps({"message": "Fonte de dados indisponível no momento."}).encode(), "error")

    def _stream(self):
        """Tempo real: Server-Sent Events. O navegador recebe a lista ao vivo e cada gol na hora."""
        q = HUB.subscribe()
        if q is None:
            return self._json(503, b'{"message":"Muitas conex\\u00f5es ao vivo agora"}', "server")
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("X-Accel-Buffering", "no")  # proxies não seguram os eventos
        self._common_headers()
        self.end_headers()
        self._status = 200
        self.close_connection = True
        try:
            self.wfile.write(b"retry: 5000\n")
            self.wfile.write(f"event: snapshot\ndata: {json.dumps(HUB.live, ensure_ascii=False, separators=(',', ':'))}\n\n".encode())
            self.wfile.write(f"event: outros\ndata: {json.dumps(HUB.other, ensure_ascii=False, separators=(',', ':'))}\n\n".encode())
            self.wfile.flush()
            while True:
                try:
                    self.wfile.write(q.get(timeout=20))
                except queue.Empty:
                    self.wfile.write(b": ping\n\n")  # mantém a conexão aberta
                self.wfile.flush()
        except OSError:  # o visitante fechou a página
            pass
        finally:
            HUB.unsubscribe(q)

    def _static(self, parsed, head):
        rel = parsed.path
        roots = None
        if rel == "/" or "." not in rel.rsplit("/", 1)[-1]:
            rel = "/index.html"  # SPA: as rotas usam #, qualquer caminho sem extensão abre o app
        entry = _static_file(rel, roots)
        if not entry:
            return self._send(404, b"Nao encontrado", "text/plain; charset=utf-8", "no-store", head=head)
        _, body, gz, etag = entry
        suffix = Path(rel).suffix
        if rel in ("/index.html", "/sw.js"):
            cache = "no-cache"  # sempre revalida: novas versões chegam na hora
        elif parsed.query.startswith("v=") or rel.startswith("/assets/"):
            cache = "public, max-age=31536000, immutable"  # arquivos versionados (?v=)
        else:
            cache = "public, max-age=86400"
        if self.headers.get("If-None-Match") == etag:
            self.send_response(304)
            self.send_header("ETag", etag)
            self.send_header("Cache-Control", cache)
            self._common_headers()
            self.send_header("Content-Length", "0")
            self.end_headers()
            self._status = 304
            return
        self._send(200, body, MIME.get(suffix, "application/octet-stream"), cache, {"ETag": etag}, gz=gz, head=head)

    def _log(self):
        if LOG_LEVEL == "off" or (LOG_LEVEL == "api" and not self.path.startswith("/api/")):
            return
        ms = (time.time() - getattr(self, "_t0", time.time())) * 1000
        sys.stdout.write(f"{datetime.now(BRT):%H:%M:%S} {self._ip():>15} {getattr(self, '_status', 0)} {ms:6.0f}ms {self.command} {self.path[:120]}\n")
        sys.stdout.flush()

    def log_message(self, fmt, *args):  # o log acima substitui o padrão
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 128

    def handle_error(self, request, client_address):
        # navegador que fechou a aba ou cancelou o pedido no meio: normal, não é erro do servidor
        if isinstance(sys.exc_info()[1], (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)
    # No Windows, SO_REUSEADDR deixa dois servidores ouvirem a mesma porta (e o antigo continua respondendo).
    # Lá a porta fica exclusiva: se já houver uma Vyra rodando, este avisa em vez de dividir a porta.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt" and hasattr(socket, "SO_EXCLUSIVEADDRUSE"):
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


LOG_LEVEL = os.environ.get("LOG_LEVEL", "api")  # api | all | off


def main():
    if not LIVE_KEY and not ESPN_ON and not footballdata.TOKEN:
        raise SystemExit("Configure ao menos uma fonte: FUTEBOL_API_KEY, FOOTBALL_DATA_TOKEN ou ESPN_FALLBACK=1")
    host = os.environ.get("HOST", "0.0.0.0")
    print(f"Vyra rodando em http://localhost:{PORT}  (host {host})")
    _, ids = plan()
    b = _budget()
    if ids:
        print(f"  API Futebol: campeonatos no plano {sorted(ids)} · {b['usadas']}/{_plan['limit']} requisições usadas hoje"
              f"{' · modo econômico' if economy() else ''}")
    else:
        print(f"  API Futebol: {'chave sem campeonatos no plano' if LIVE_KEY else 'sem chave'}")
    print(f"  ESPN: {'ativa' if ESPN_ON else 'desligada'} · football-data: {'ativa' if footballdata.TOKEN else 'sem token'} · dados em {DATA_DIR}")
    threading.Thread(target=scheduler, daemon=True).start()
    threading.Thread(target=HUB.run, daemon=True).start()  # tempo real: /api/stream
    try:
        httpd = Server((host, PORT), Handler)
    except OSError:
        raise SystemExit(f"\nA porta {PORT} já está em uso — provavelmente outra Vyra ainda está aberta.\n"
                         f"Feche a outra janela do servidor (Ctrl+C) ou rode em outra porta: python server.py {PORT + 1}")

    def stop(*_):  # a hospedagem envia SIGTERM ao reiniciar/publicar uma versão nova
        print("Encerrando…")
        threading.Thread(target=httpd.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
