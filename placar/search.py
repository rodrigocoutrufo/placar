"""Busca do site (/api/busca?q=): campeonatos, times e jogadores de futebol, NBA e F1.

- Campeonatos e times: índice do próprio site (as ~40 competições, os times de todas elas, NBA e equipes da F1), então
  todo resultado abre uma página que existe.
- Jogadores: busca da ESPN (futebol, NBA e F1; acha enquanto digita, "vini" -> Vinícius Júnior), filtrada para o que o
  site cobre e com foto. Pilotos de F1 viram o id da Jolpica (página do piloto).
Ignora acentos e maiúsculas, aceita as palavras em qualquer ordem e troca apelidos ("jr" -> "junior").
"""

import json
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

ESPN_SEARCH = "https://site.web.api.espn.com/apis/common/v3/search"
ALIASES = {"jr": "junior", "jr.": "junior", "fla": "flamengo", "flu": "fluminense", "sp": "sao paulo", "spfc": "sao paulo",
           "cam": "atletico mg", "galo": "atletico mg", "timao": "corinthians", "verdao": "palmeiras", "mengao": "flamengo",
           "cap": "athletico pr", "furacao": "athletico pr", "inter": "internacional", "colorado": "internacional", "real": "real madrid",
           "barca": "barcelona", "psg": "paris saint", "man utd": "manchester united", "man city": "manchester city"}
POS = {"forward": "Atacante", "midfielder": "Meio-campista", "defender": "Defensor", "goalkeeper": "Goleiro", "guard": "Armador",
       "point guard": "Armador", "shooting guard": "Ala-armador", "small forward": "Ala", "power forward": "Ala-pivô", "center": "Pivô",
       "forward-center": "Ala-pivô", "guard-forward": "Ala-armador", "center-forward": "Pivô"}
# base, juvenil e futebol feminino ficam de fora (o site não cobre); slugs da ESPN como eng.w.1, usa.nwsl, uefa.wchampions
YOUTH = re.compile(r"\bu-?\d{2}\b|sub-?\d{2}|youth|junior league|\.w\.|\bw\.\d|nwsl|wchampions|fifa\.wwc|women|feminin|copinha|saopaulo_youth", re.I)

_route = None  # ligado pelo servidor: route(path, query) -> (status, bytes, fonte)
_espn = _footballdata = _sports = None
_lock = threading.Lock()
_index = {"at": 0.0, "teams": [], "comps": [], "espn": {}, "names": {}}  # espn: id ESPN -> nome; names: nome normalizado -> nome
_cache: dict[str, tuple[float, list]] = {}


def norm(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def _expand(q: str) -> str:
    """Nome de jogador: "jr" vira "junior" (a ESPN escreve "Vinícius Júnior")."""
    return " ".join("junior" if w == "jr" else w for w in norm(q).split())


def _team_alias(q: str) -> str | None:
    """Apelido de time ("timão", "galo", "barça"): procura também pelo nome."""
    return ALIASES.get(norm(q)) if norm(q) != "jr" else None


def _match(tokens, *fields) -> int:
    """0 = não bate; maior = melhor (nome começa com a busca > palavra começa com ela > contém)."""
    hay = " ".join(norm(f) for f in fields if f)
    if not hay or not all(t in hay for t in tokens):
        return 0
    name = norm(fields[0] or "")
    q = " ".join(tokens)
    if name == q:
        return 100
    if name.startswith(q + " "):  # palavra inteira: "champions" -> Champions League antes de Championship
        return 90
    if name.startswith(q):
        return 80
    if all(any(w.startswith(t) for w in name.split()) for t in tokens):
        return 60
    return 30


# ---------------------------------------------------------------- índice de campeonatos e times
def _build_index():
    comps, teams, seen, espn_ids, names = [], [], set(), {}, {}
    try:
        st, body, _ = _route("/campeonatos", {})
        for c in json.loads(body) if st == 200 else []:
            comps.append({"tipo": "campeonato", "nome": c.get("nome_popular") or c.get("nome"), "extra": c.get("nome"),
                          "sub": c.get("pais") or "", "logo": c.get("logo"), "logo_escuro": c.get("logo_escuro"),
                          "to": f"/campeonato/{c['campeonato_id']}"})
    except Exception:  # noqa: BLE001
        pass

    EU = {"eng", "esp", "ita", "ger", "fra", "por", "ned", "uefa", "sco", "bel", "tur"}
    routes = set()

    CLUB = re.compile(r"\b(fc|cf|sc|afc|ac|cd|ud|club|clube|sad|esporte|futbol)\b")

    def add(t, sub, to, group, extra="", peso=0):
        """Mesmo clube em várias competições aparece uma vez; clubes de mesmo nome em lugares diferentes
        (Barcelona da Espanha e do Equador) ficam os dois."""
        key = (norm(t.get("nome_popular") or ""), group)
        if not key[0] or key in seen or to in routes or t.get("nome_popular") == "A definir":
            return
        seen.add(key)
        routes.add(to)
        for n in (t.get("nome_popular"), t.get("nome"), extra):
            if n:
                names.setdefault(norm(n), t.get("nome_popular"))
        teams.append({"tipo": "time", "nome": t.get("nome_popular"), "extra": f"{t.get('sigla') or ''} {extra}", "sub": sub,
                      "img": t.get("escudo"), "to": to, "esporte": "futebol",
                      "_full": " ".join(CLUB.sub(" ", norm(extra or t.get("nome") or "")).split()), "_peso": peso})

    # ligas europeias da football-data primeiro: a página do time delas é a mais completa
    for path, (_, data) in list(_footballdata._mem.items()):
        m = re.match(r"^/competitions/(\w+)/matches$", path)
        if m and isinstance(data, dict):
            comp = next((L["popular"] for L in _footballdata.LEAGUES.values() if L["code"] == m.group(1)), m.group(1))
            for x in data.get("matches", []):
                for side in ("homeTeam", "awayTeam"):
                    if (x.get(side) or {}).get("id"):
                        t = _footballdata.team(x[side])
                        add(t, comp, f"/time/{t['time_id']}", "eu", extra=x[side].get("name") or "", peso=15)
    for lid in _espn.LEAGUE_ORDER:  # times de todas as competições da ESPN (temporadas já em cache)
        try:
            L = _espn.LEAGUES[lid]
            prefix = L["slug"].split(".")[0]
            group = "eu" if prefix in EU else prefix
            for e in _espn._events(lid):
                for c in e["competitions"][0]["competitors"]:
                    t = _espn.team(c["team"])
                    espn_ids[str(c["team"].get("id"))] = t.get("nome_popular")
                    add(t, L["popular"], f"/time/{t['time_id']}", group, extra=c["team"].get("displayName") or "", peso=15 if lid in (10, 14) else 0)
        except Exception:  # noqa: BLE001
            continue
    try:  # NBA: os 30 times
        for conf in _sports.nba_standings():
            for r in conf.get("times") or conf.get("linhas") or []:
                tm = r.get("time") or r
                if tm.get("id"):
                    seen_key = "nba " + norm(tm.get("nome") or "")
                    if seen_key not in seen:
                        seen.add(seen_key)
                        teams.append({"tipo": "time", "nome": tm.get("nome"), "extra": f"{tm.get('sigla') or ''} {tm.get('curto') or ''}",
                                      "sub": "NBA", "img": tm.get("logo"), "to": f"/nba/time/{tm['id']}", "esporte": "nba"})
    except Exception:  # noqa: BLE001
        pass
    try:  # F1: equipes
        for c in _sports.f1_overview().get("construtores") or []:
            eq = c.get("equipe") or c
            if eq.get("id"):
                teams.append({"tipo": "time", "nome": eq.get("nome"), "extra": eq.get("id"), "sub": "Fórmula 1",
                              "img": eq.get("logo"), "to": f"/f1/equipe/{eq['id']}", "esporte": "f1"})
    except Exception:  # noqa: BLE001
        pass
    _index.update(at=time.time(), comps=comps, teams=teams, espn=espn_ids, names=names)


def _ensure_index(force=False):
    """Sem índice ainda: monta agora. A atualização periódica vem do agendador do servidor (warm)."""
    if force or not _index["teams"]:
        with _lock:
            if force or not _index["teams"]:
                _build_index()


# ---------------------------------------------------------------- jogadores (busca da ESPN)
def _f1_ids() -> dict:
    out = {}
    try:
        for d in _sports.f1_overview().get("pilotos") or []:
            p = d.get("piloto") or {}
            if p.get("id"):  # id da Jolpica e foto oficial
                out[norm(p.get("nome"))] = out[norm(p.get("sobrenome"))] = (p["id"], p.get("foto_oficial") or p.get("foto"))
    except Exception:  # noqa: BLE001
        pass
    return out


def _num(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _espn_players(q: str) -> list:
    url = f"{ESPN_SEARCH}?{urllib.parse.urlencode({'query': q, 'limit': 40, 'type': 'player'})}"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Vyra/1.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=12) as r:
        items = json.loads(r.read()).get("items") or []
    f1 = None
    out = []
    for it in items:
        sport, league = it.get("sport"), it.get("league") or it.get("defaultLeagueSlug") or ""
        if it.get("isRetired") or not it.get("id"):
            continue
        team = ((it.get("teamRelationships") or [{}])[0].get("core") or {})
        tname = team.get("displayName") or re.sub(r"\s*\(.*\)$", "", ((it.get("teamRelationships") or [{}])[0].get("displayName") or ""))
        pos = (it.get("position") or {}).get("displayName") if isinstance(it.get("position"), dict) else None
        pos = POS.get(norm(pos)) if pos else None
        pid = int(it["id"])
        if sport == "soccer":
            if YOUTH.search(league) or YOUTH.search(tname or ""):
                continue
            # clube de um campeonato do site (pelo id da ESPN ou, nas ligas europeias da football-data, pelo nome)
            known = _index["espn"].get(str(team.get("id"))) or _index["names"].get(norm(tname))
            out.append({"tipo": "jogador", "esporte": "futebol", "nome": it.get("displayName"), "sub": " · ".join(x for x in (known or tname, pos) if x),
                        "_known": bool(known),
                        "img": f"https://a.espncdn.com/i/headshots/soccer/players/full/{pid}.png", "to": f"/jogador/{_espn.OFFSET + pid}",
                        "time_logo": f"https://a.espncdn.com/i/teamlogos/soccer/500/{team['id']}.png" if team.get("id") else None,
                        "_rel": _num(it.get("relevance"))})
        elif sport == "basketball" and league == "nba":
            out.append({"tipo": "jogador", "esporte": "nba", "nome": it.get("displayName"), "sub": " · ".join(x for x in ("NBA", tname, pos) if x),
                        "img": f"https://a.espncdn.com/i/headshots/nba/players/full/{pid}.png", "to": f"/nba/jogador/{pid}", "_known": True, "_rel": (_num(it.get("relevance"))) + 1})
        elif sport == "racing" and league == "f1":
            f1 = f1 if f1 is not None else _f1_ids()
            did, foto = f1.get(norm(it.get("displayName"))) or f1.get(norm((it.get("displayName") or "").split(" ")[-1])) or (None, None)
            if did:
                out.append({"tipo": "jogador", "esporte": "f1", "nome": it.get("displayName"), "sub": "Fórmula 1 · piloto",
                            "img": foto, "to": f"/f1/piloto/{did}", "_known": True, "_rel": (_num(it.get("relevance"))) + 1})
    return out


def players(q: str) -> list:
    key = norm(q)
    hit = _cache.get(key)
    if hit and hit[0] > time.time():
        return hit[1]
    for tries in range(2):
        try:
            res = _espn_players(q)
            break
        except Exception:  # noqa: BLE001 — ESPN fora: busca segue com times e campeonatos
            if tries:
                return hit[1] if hit else []
    if len(_cache) > 500:
        _cache.clear()
    _cache[key] = (time.time() + 3600, res)
    return res


# ---------------------------------------------------------------- API
def search(q: str, limit: int = 20) -> dict:
    q = (q or "").strip()[:60]
    exp = _expand(q)
    tokens = exp.split()
    alias = _team_alias(q)
    if len(norm(q)) < 2 or not tokens:
        return {"q": q, "campeonatos": [], "times": [], "jogadores": []}
    _ensure_index()

    def score(it):
        fields = (it["nome"], it.get("extra"), it.get("sub") if it["tipo"] == "campeonato" else None)
        by_alias = _match(alias.split(), *fields) if alias else 0
        m = max(_match(tokens, *fields), by_alias + 5 if by_alias else 0)
        if m and it.get("_full") and it["_full"] in (exp, alias):  # nome completo exato ("barcelona" -> FC Barcelona / Barça)
            m = max(m, 98)
        # clubes das ligas principais (europeias da football-data, Brasileirão e Série B) passam na frente no empate
        return m + it.get("_peso", 0) if m else 0

    def rank(items):
        scored = [(s, it) for it in items if (s := score(it))]
        scored.sort(key=lambda x: (-x[0], len(x[1]["nome"] or "")))
        return [{k: v for k, v in it.items() if not k.startswith("_")} for _, it in scored]
    comps = rank(_index["comps"])[:8]
    teams = rank(_index["teams"])[:limit]
    pls = players(exp)
    # jogadores: primeiro quem joga num campeonato do site (NBA e F1 contam), depois quem bate melhor com o nome;
    # no empate fica a ordem da ESPN (relevância)
    star = lambda p: p.get("_rel", 0) >= 1e8  # os muito procurados na ESPN (Vini Jr., Neymar, LeBron) sempre no topo
    # só o meio de um nome ("real" em Grealish) é ruído; os muito procurados ficam (a ESPN já sabe que é ele)
    pls = [p for p in pls if star(p) or _match(tokens, p["nome"]) >= 60]
    pls = sorted(pls, key=lambda p: (not star(p), -p["_rel"] if star(p) else 0, not p.get("_known"), -_match(tokens, p["nome"]), -p.get("_rel", 0)))[:limit]
    return {"q": q, "campeonatos": comps, "times": teams, "jogadores": [{k: v for k, v in p.items() if not k.startswith("_")} for p in pls]}


def warm():
    """Monta o índice em segundo plano (o primeiro visitante não espera)."""
    try:
        _ensure_index(force=True)
    except Exception:  # noqa: BLE001
        pass
