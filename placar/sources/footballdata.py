"""Adaptador football-data.org (API v4) → formato da API Futebol.

Documentação: https://www.football-data.org/documentation/quickstart
Plano gratuito: 12 competições (Premier League, La Liga, Serie A, Bundesliga, Ligue 1, Champions,
Liga Portugal, Eredivisie, ...), 10 requisições por minuto, placar ao vivo sem minuto, sem escalações.

Para respeitar o limite de 10/min: cada resposta fica em cache (memória + disco, .cache/fd), uma
temporada inteira vem numa chamada só (/competitions/{c}/matches) e o controle de vazão abaixo nunca
passa de 9 chamadas por minuto — se faltar vaga, serve a cópia em cache, mesmo vencida.

IDs de times/partidas/atletas recebem OFFSET para não colidirem com a API Futebol e a ESPN.
"""

import hashlib
import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from collections import deque
from datetime import date, datetime, timedelta, timezone

from .. import config

OFFSET = 800_000_000
BASE = "https://api.football-data.org/v4"
TOKEN = os.environ.get("FOOTBALL_DATA_TOKEN", "")
CACHE_DIR = config.DATA_DIR / "fd"
BRT = timezone(timedelta(hours=-3))
PER_MINUTE = 9  # plano gratuito: 10/min; deixa 1 de folga

# campeonato_id local -> competição na football-data
LEAGUES = {
    106: {"code": "CL", "popular": "Champions League", "regiao": "europa"},
    101: {"code": "PL", "popular": "Premier League", "regiao": "europa"},
    102: {"code": "PD", "popular": "La Liga", "regiao": "europa"},
    103: {"code": "SA", "popular": "Serie A", "regiao": "europa"},
    104: {"code": "BL1", "popular": "Bundesliga", "regiao": "europa"},
    105: {"code": "FL1", "popular": "Ligue 1", "regiao": "europa"},
    107: {"code": "PPL", "popular": "Liga Portugal", "regiao": "europa"},
    108: {"code": "DED", "popular": "Eredivisie", "regiao": "europa"},
}
ORDER = [106, 101, 102, 103, 104, 105, 107, 108]
# versão do logo para fundo escuro (a football-data só tem a clara; vários somem no tema escuro)
ESPN_DARK = {"CL": 2, "PL": 23, "PD": 15, "SA": 12, "BL1": 10, "FL1": 9, "PPL": 14, "DED": 11}


def _dark_logo(code):
    n = ESPN_DARK.get(code)
    return f"https://a.espncdn.com/i/leaguelogos/soccer/500-dark/{n}.png" if n else None
CODE_TO_ID = {v["code"]: k for k, v in LEAGUES.items()}

# faixas da tabela (aproximação dos regulamentos)
ZONES = {
    "PL": [(1, 4, "champions"), (5, 5, "europa"), (6, 6, "conference"), (18, 20, "rebaixamento")],
    "PD": [(1, 4, "champions"), (5, 5, "europa"), (6, 6, "conference"), (18, 20, "rebaixamento")],
    "SA": [(1, 4, "champions"), (5, 5, "europa"), (6, 6, "conference"), (18, 20, "rebaixamento")],
    "BL1": [(1, 4, "champions"), (5, 5, "europa"), (6, 6, "conference"), (16, 16, "playoff-rebaixamento"), (17, 18, "rebaixamento")],
    "FL1": [(1, 3, "champions"), (4, 4, "pre-champions"), (5, 5, "europa"), (6, 6, "conference"), (16, 16, "playoff-rebaixamento"), (17, 18, "rebaixamento")],
    "PPL": [(1, 2, "champions"), (3, 3, "pre-champions"), (4, 4, "europa"), (5, 5, "conference"), (16, 16, "playoff-rebaixamento"), (17, 18, "rebaixamento")],
    "DED": [(1, 2, "champions"), (3, 3, "pre-champions"), (4, 4, "europa"), (5, 5, "conference"), (16, 16, "playoff-rebaixamento"), (17, 18, "rebaixamento")],
    "CL": [(1, 8, "oitavas"), (9, 24, "playoffs"), (25, 36, "eliminado")],
}

STAGES = {
    "LEAGUE_STAGE": ("Fase de liga", "pontos-corridos"), "REGULAR_SEASON": ("Fase única", "pontos-corridos"),
    "GROUP_STAGE": ("Fase de grupos", "grupos"), "PLAYOFFS": ("Playoffs", "mata-mata"),
    "LAST_64": ("32 avos de final", "mata-mata"), "LAST_32": ("16 avos de final", "mata-mata"),
    "LAST_16": ("Oitavas de final", "mata-mata"), "QUARTER_FINALS": ("Quartas de final", "mata-mata"),
    "SEMI_FINALS": ("Semifinal", "mata-mata"), "THIRD_PLACE": ("Disputa de 3º lugar", "mata-mata"), "FINAL": ("Final", "mata-mata"),
    "QUALIFICATION": ("Qualificação", "mata-mata"), "PRELIMINARY_ROUND": ("Fase preliminar", "mata-mata"),
}
STAGE_ORDER = list(STAGES)
POS_PT = {"Goalkeeper": ("Goleiro", "GOL"), "Defence": ("Defensor", "DEF"), "Midfield": ("Meio-campista", "MEI"),
          "Offence": ("Atacante", "ATA"), "Defender": ("Defensor", "DEF"), "Midfielder": ("Meio-campista", "MEI"),
          "Attacker": ("Atacante", "ATA"), "Forward": ("Atacante", "ATA"),
          "Centre-Back": ("Zagueiro", "ZAG"), "Left-Back": ("Lateral-esquerdo", "LE"), "Right-Back": ("Lateral-direito", "LD"),
          "Defensive Midfield": ("Volante", "VOL"), "Central Midfield": ("Meio-campista", "MEI"), "Attacking Midfield": ("Meia-atacante", "MAT"),
          "Left Winger": ("Ponta-esquerda", "PE"), "Right Winger": ("Ponta-direita", "PD"), "Centre-Forward": ("Centroavante", "CA")}
COUNTRY_PT = {"England": "Inglaterra", "Spain": "Espanha", "Italy": "Itália", "Germany": "Alemanha", "France": "França",
              "Brazil": "Brasil", "Portugal": "Portugal", "Netherlands": "Holanda", "Belgium": "Bélgica", "Argentina": "Argentina",
              "Uruguay": "Uruguai", "Colombia": "Colômbia", "Norway": "Noruega", "Croatia": "Croácia", "Denmark": "Dinamarca",
              "Switzerland": "Suíça", "Poland": "Polônia", "Scotland": "Escócia", "Wales": "País de Gales", "Morocco": "Marrocos",
              "Senegal": "Senegal", "Nigeria": "Nigéria", "Ghana": "Gana", "Japan": "Japão", "Korea Republic": "Coreia do Sul",
              "Turkey": "Turquia", "Austria": "Áustria", "Sweden": "Suécia", "Serbia": "Sérvia", "Ukraine": "Ucrânia",
              "United States": "Estados Unidos", "Mexico": "México", "Ivory Coast": "Costa do Marfim", "Cameroon": "Camarões",
              "Ecuador": "Equador", "Paraguay": "Paraguai", "Chile": "Chile", "Czech Republic": "República Tcheca", "Greece": "Grécia",
              "Romania": "Romênia", "Hungary": "Hungria", "Slovenia": "Eslovênia", "Slovakia": "Eslováquia", "Russia": "Rússia",
              "Ireland": "Irlanda", "Northern Ireland": "Irlanda do Norte", "Finland": "Finlândia", "Iceland": "Islândia",
              "Bosnia-Herzegovina": "Bósnia", "Albania": "Albânia", "Georgia": "Geórgia", "Israel": "Israel", "Algeria": "Argélia",
              "Egypt": "Egito", "Tunisia": "Tunísia", "Mali": "Mali", "Guinea": "Guiné", "Canada": "Canadá", "Australia": "Austrália",
              "Venezuela": "Venezuela", "Peru": "Peru", "Bolivia": "Bolívia", "Kosovo": "Kosovo", "Montenegro": "Montenegro",
              "North Macedonia": "Macedônia do Norte", "Bulgaria": "Bulgária", "Cyprus": "Chipre", "Luxembourg": "Luxemburgo"}

stats = {"requests": 0, "throttled": 0, "errors": 0}
_calls: deque = deque()
_lock = threading.Lock()
_mem: dict[str, tuple[float, object]] = {}


class NotFound(Exception):
    pass


class Busy(Exception):
    """Sem vaga no limite de 10/min e sem cópia em cache: o pedido do visitante não espera."""


_tl = threading.local()  # _tl.can_wait = True só no agendador (pode esperar a próxima vaga)


# ---------------------------------------------------------------- HTTP com vazão e cache
def _cfile(path):
    return CACHE_DIR / (hashlib.sha1(path.encode()).hexdigest() + ".json")


def _get(path: str, ttl: float):
    now = time.time()
    hit = _mem.get(path)
    if not hit and _cfile(path).exists():
        try:
            d = json.loads(_cfile(path).read_text(encoding="utf-8"))
            hit = (d["exp"], d["data"])
            _mem[path] = hit
        except (OSError, ValueError, KeyError):
            hit = None
    if hit and hit[0] > now:
        return hit[1]
    if not TOKEN:
        if hit:
            return hit[1]
        raise NotFound("sem token")
    # controle de vazão: no máximo PER_MINUTE chamadas em 60 s
    with _lock:
        while _calls and now - _calls[0] > 60:
            _calls.popleft()
        if len(_calls) >= PER_MINUTE:
            stats["throttled"] += 1
            if hit:
                return hit[1]  # vencido, mas evita estourar o limite
            if not getattr(_tl, "can_wait", False):
                raise Busy(path)
            wait = 60 - (now - _calls[0]) + 0.2
        else:
            wait = 0
    if wait:
        time.sleep(min(wait, 12))
    with _lock:
        _calls.append(time.time())
    req = urllib.request.Request(BASE + path, headers={"X-Auth-Token": TOKEN, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        stats["requests"] += 1
    except urllib.error.HTTPError as e:
        stats["errors"] += 1
        if e.code == 404:
            raise NotFound(path) from e
        if hit:
            return hit[1]
        raise
    except (urllib.error.URLError, TimeoutError):
        stats["errors"] += 1
        if hit:
            return hit[1]
        raise
    exp = time.time() + ttl
    _mem[path] = (exp, data)
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    _cfile(path).write_text(json.dumps({"path": path, "exp": exp, "data": data}), encoding="utf-8")
    return data


# ---------------------------------------------------------------- conversões
def _dt(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def team(t: dict) -> dict:
    if not t or t.get("id") is None:
        return {"time_id": OFFSET, "nome_popular": "A definir", "sigla": "–", "escudo": None, "cor": None, "cor_secundaria": None}
    return {"time_id": OFFSET + int(t["id"]), "nome_popular": t.get("shortName") or t.get("name") or "",
            "sigla": t.get("tla") or (t.get("shortName") or "")[:3].upper(), "escudo": t.get("crest"), "cor": None, "cor_secundaria": None}


def _camp_ref(lid):
    L = LEAGUES[lid]
    return {"campeonato_id": lid, "nome": L["popular"], "slug": L["code"].lower(), "nome_popular": L["popular"]}


def _status(m):
    s = m.get("status")
    if s in ("SCHEDULED", "TIMED"):
        return "agendado", None
    if s == "PAUSED":
        return "andamento", "intervalo"
    if s in ("IN_PLAY", "LIVE"):
        dur = (m.get("score") or {}).get("duration")
        if dur == "PENALTY_SHOOTOUT":
            return "andamento", "disputa-penalti"
        if dur == "EXTRA_TIME":
            return "andamento", "primeiro-tempo-prorrogacao"
        half = (m.get("score") or {}).get("halfTime") or {}
        return "andamento", "segundo-tempo" if half.get("home") is not None else "primeiro-tempo"
    if s in ("FINISHED", "AWARDED"):
        return "finalizado", "fim-de-jogo"
    return {"POSTPONED": "adiado", "SUSPENDED": "suspensa", "CANCELLED": "cancelado"}.get(s, "agendado"), None


def match(m: dict, lid: int) -> dict:
    status, periodo = _status(m)
    sc = m.get("score") or {}
    ft = sc.get("fullTime") or {}
    started = status in ("andamento", "finalizado")
    H, A = team(m.get("homeTeam")), team(m.get("awayTeam"))
    pen = sc.get("penalties") or {}
    dt = _dt(m.get("utcDate"))
    local = dt.astimezone(BRT) if dt else None
    stage = m.get("stage")
    out = {
        "partida_id": OFFSET + int(m["id"]),
        "campeonato": _camp_ref(lid),
        "placar": f"{H['nome_popular']} {ft.get('home') or 0}x{ft.get('away') or 0} {A['nome_popular']}" if started else f"{H['nome_popular']} x {A['nome_popular']}",
        "time_mandante": H, "time_visitante": A,
        "placar_mandante": (ft.get("home") or 0) if started else None,
        "placar_visitante": (ft.get("away") or 0) if started else None,
        "disputa_penalti": {"placar_penalti_mandante": pen["home"], "placar_penalti_visitante": pen["away"], "cobrancas": []} if pen.get("home") is not None else False,
        "status": status, "periodo": periodo,
        "data_realizacao": local.strftime("%d/%m/%Y") if local else None,
        "hora_realizacao": local.strftime("%H:%M") if local else None,
        "data_realizacao_iso": local.strftime("%Y-%m-%dT%H:%M:%S%z") if local else None,
        "estadio": {"nome_popular": m["venue"]} if m.get("venue") else None,
        "_link": f"/v1/partidas/{OFFSET + int(m['id'])}",
        "fase": {"nome": STAGES.get(stage, (stage or "", ""))[0], "tipo": STAGES.get(stage, ("", "mata-mata"))[1]} if stage else None,
    }
    if m.get("matchday") and STAGES.get(stage, ("", ""))[1] == "pontos-corridos":
        out["rodada"] = f"{m['matchday']}ª Rodada"
        out["rodada_numero"] = m["matchday"]
    if m.get("group"):
        out["grupo"] = m["group"].replace("GROUP_", "Grupo ")
    if status == "andamento":
        out["cronometro"] = m.get("minute")
        out["cronometro_label"] = f"{m['minute']}'" if m.get("minute") else ("Intervalo" if periodo == "intervalo" else "Ao vivo")
    return out


# ---------------------------------------------------------------- temporada e campeonatos
def _lid(code_or_id):
    return int(code_or_id)


def _comp(lid):
    return _get(f"/competitions/{LEAGUES[lid]['code']}", 6 * 3600)


def season_matches(lid) -> list[dict]:
    """Todas as partidas da temporada (1 chamada), com o placar ao vivo de hoje por cima."""
    near = _live_window()
    data = _get(f"/competitions/{LEAGUES[lid]['code']}/matches", 120 if near else 900)
    ms = data.get("matches", [])
    live = {m["id"]: m for m in _today().get("matches", []) if m["competition"]["code"] == LEAGUES[lid]["code"]}
    return [live.get(m["id"], m) for m in ms]


def _today():
    return _get("/matches", 60)


def _live_window():
    try:
        return any(m["status"] in ("IN_PLAY", "PAUSED", "LIVE", "TIMED", "SCHEDULED") for m in _today().get("matches", []))
    except Exception:
        return False


def _is_league(ms):
    return any(m.get("stage") in ("REGULAR_SEASON", "LEAGUE_STAGE") for m in ms)


def _round_status(ms):
    st = [m["status"] for m in ms]
    if any(s == "andamento" for s in st):
        return "andamento"
    if all(s in ("finalizado", "cancelado") for s in st):
        return "encerrada"
    return "andamento" if any(s == "finalizado" for s in st) else "agendada"


def _phases(raw):
    stages = []
    for m in raw:
        s = m.get("stage")
        if s and s not in stages:
            stages.append(s)
    stages.sort(key=lambda s: STAGE_ORDER.index(s) if s in STAGE_ORDER else 99)
    return stages


def campeonato(lid, detail=False):
    L = LEAGUES[lid]
    c = _comp(lid)
    raw = _get(f"/competitions/{L['code']}/matches", 900).get("matches", [])
    ms = [match(m, lid) for m in raw]
    cs = c.get("currentSeason") or {}
    start = (cs.get("startDate") or "")[:4]
    end = (cs.get("endDate") or "")[:4]
    temporada = f"{start}/{end[2:]}" if start and end and start != end else start
    stages = _phases(raw)
    cur_stage = next((s for s in stages if any(m.get("stage") == s and m["status"] not in ("FINISHED", "AWARDED") for m in raw)), stages[-1] if stages else None)
    done = sum(1 for m in ms if m["status"] == "finalizado")
    out = {
        "campeonato_id": lid, "nome": c.get("name") or L["popular"], "slug": L["code"].lower(), "nome_popular": L["popular"],
        "edicao_atual": {"edicao_id": cs.get("id"), "temporada": temporada, "nome": f"{L['popular']} {temporada}", "nome_popular": f"{L['popular']} {temporada}"},
        "fase_atual": _phase_ref(lid, cur_stage) if cur_stage else None,
        "rodada_atual": None,
        "status": "finalizado" if ms and done == len(ms) else "andamento",
        "tipo": "Pontos Corridos" if stages == ["REGULAR_SEASON"] else "Misto",
        "logo": c.get("emblem"), "logo_escuro": _dark_logo(L["code"]), "regiao": L["regiao"], "fonte": "football-data",
        "jogos_disputados": done, "jogos_total": len(ms), "progresso": round(done / len(ms) * 100) if ms else 0,
        "pais": (c.get("area") or {}).get("name"), "bandeira_pais": (c.get("area") or {}).get("flag"),
    }
    if _is_league(raw) and cs.get("currentMatchday"):
        md = cs["currentMatchday"]
        r = [m for m in ms if m.get("rodada_numero") == md]
        out["rodada_atual"] = {"nome": f"{md}ª Rodada", "slug": f"{md}a-rodada", "rodada": md, "status": _round_status(r) if r else "agendada"}
    if detail:
        out["fases"] = [{**_phase_ref(lid, s), "status": _round_status([match(m, lid) for m in raw if m.get("stage") == s])} for s in stages]
    return out


def _phase_ref(lid, stage):
    nome, tipo = STAGES.get(stage, (stage.replace("_", " ").title(), "mata-mata"))
    fid = lid * 1000 + (STAGE_ORDER.index(stage) + 1 if stage in STAGE_ORDER else 99)
    return {"fase_id": fid, "nome": nome, "slug": stage.lower(), "tipo": tipo, "_link": f"/v1/campeonatos/{lid}/fases/{fid}"}


def campeonatos():
    """Lista com UMA chamada (/competitions); o detalhe de cada liga é buscado só quando aberto."""
    comps = {c["code"]: c for c in _get("/competitions", 6 * 3600).get("competitions", [])}
    out = []
    for lid in ORDER:
        L = LEAGUES[lid]
        c = comps.get(L["code"])
        if not c:
            continue  # fora do plano da conta
        cached = _mem.get(f"/competitions/{L['code']}/matches")
        if cached:  # já temos a temporada em cache: devolve o detalhe completo sem custo
            try:
                out.append(campeonato(lid))
                continue
            except Exception:
                pass
        cs = c.get("currentSeason") or {}
        start, end = (cs.get("startDate") or "")[:4], (cs.get("endDate") or "")[:4]
        temporada = f"{start}/{end[2:]}" if start and end and start != end else start
        md = cs.get("currentMatchday")
        league_like = L["code"] != "CL"
        out.append({"campeonato_id": lid, "nome": c.get("name"), "slug": L["code"].lower(), "nome_popular": L["popular"],
                    "edicao_atual": {"edicao_id": cs.get("id"), "temporada": temporada, "nome": f"{L['popular']} {temporada}", "nome_popular": f"{L['popular']} {temporada}"},
                    "fase_atual": None, "rodada_atual": {"nome": f"{md}ª Rodada", "slug": f"{md}a-rodada", "rodada": md, "status": "andamento"} if md and league_like else None,
                    "status": "andamento", "tipo": "Pontos Corridos" if league_like else "Misto", "logo": c.get("emblem"), "logo_escuro": _dark_logo(L["code"]),
                    "regiao": L["regiao"], "fonte": "football-data", "pais": (c.get("area") or {}).get("name")})
    return out


def rodadas(lid):
    ms = [match(m, lid) for m in season_matches(lid)]
    by = {}
    for m in ms:
        if m.get("rodada_numero"):
            by.setdefault(m["rodada_numero"], []).append(m)
    if not by:
        raise NotFound("rodadas")
    return [{"nome": f"{r}ª Rodada", "slug": f"{r}a-rodada", "rodada": r, "status": _round_status(by[r]),
             "_link": f"/v1/campeonatos/{lid}/rodadas/{r}"} for r in sorted(by)]


def rodada(lid, n):
    ms = [match(m, lid) for m in season_matches(lid)]
    r = [m for m in ms if m.get("rodada_numero") == n]
    if not r:
        raise NotFound("rodada")
    total = max(m.get("rodada_numero") or 0 for m in ms)
    ref = lambda k: {"nome": f"{k}ª Rodada", "slug": f"{k}a-rodada", "rodada": k} if 1 <= k <= total else None
    return {"nome": f"{n}ª Rodada", "slug": f"{n}a-rodada", "rodada": n, "status": _round_status(r),
            "proxima_rodada": ref(n + 1), "rodada_anterior": ref(n - 1), "partidas": r}


def fase(lid, fid):
    raw = season_matches(lid)
    stage = next((s for s in _phases(raw) if _phase_ref(lid, s)["fase_id"] == fid), None)
    if not stage:
        raise NotFound("fase")
    ms = [match(m, lid) for m in raw if m.get("stage") == stage]
    out = {**_phase_ref(lid, stage), "campeonato": _camp_ref(lid), "chaves": [], "grupos": {}, "partidas": []}
    if out["tipo"] == "mata-mata":
        ties = {}
        for m in ms:
            ties.setdefault(frozenset((m["time_mandante"]["time_id"], m["time_visitante"]["time_id"])), []).append(m)
        for i, legs in enumerate(ties.values(), 1):
            legs.sort(key=lambda m: m["data_realizacao_iso"] or "")
            out["chaves"].append({"nome": f"Chave {i}", "slug": f"chave-{i}", "partida_ida": legs[0], "partida_volta": legs[1] if len(legs) > 1 else None})
    else:
        out["partidas"] = ms
    return out


def fases_lista(lid):
    c = campeonato(lid, detail=True)
    ph = c["fases"]
    ref = lambda p: {k: p[k] for k in ("fase_id", "nome", "slug", "tipo", "_link")} if p else None
    return [{**ref(p), "edicao": c["edicao_atual"], "status": p["status"], "eliminatorio": p["tipo"] == "mata-mata",
             "proxima_fase": ref(ph[i + 1]) if i + 1 < len(ph) else None, "fase_anterior": ref(ph[i - 1]) if i else None,
             "grupos": [], "chaves": [], "rodadas": []} for i, p in enumerate(ph)]


def _form_from(ms):
    res = {}
    for m in sorted((m for m in ms if m["status"] == "finalizado"), key=lambda m: m["data_realizacao_iso"] or ""):
        h, a = m["time_mandante"]["time_id"], m["time_visitante"]["time_id"]
        gh, ga = m["placar_mandante"], m["placar_visitante"]
        res.setdefault(h, []).append("v" if gh > ga else "d" if gh < ga else "e")
        res.setdefault(a, []).append("v" if ga > gh else "d" if ga < gh else "e")
    return {k: v[-5:] for k, v in res.items()}


def tabela(lid):
    code = LEAGUES[lid]["code"]
    d = _get(f"/competitions/{code}/standings", 300 if _live_window() else 1800)
    tables = [s for s in d.get("standings", []) if s.get("type") == "TOTAL"]
    form = _form_from([match(m, lid) for m in season_matches(lid)])

    def rows(table, group_mode):
        out = []
        for r in table:
            t = team(r["team"])
            j, p = r.get("playedGames") or 0, r.get("points") or 0
            pos = r["position"]
            zone = None if group_mode else next((z for lo, hi, z in ZONES.get(code, []) if lo <= pos <= hi), None)
            f = [{"W": "v", "D": "e", "L": "d"}[x] for x in (r.get("form") or "").split(",") if x in "WDL" and x] or form.get(t["time_id"], [])
            out.append({"posicao": pos, "pontos": p, "time": t, "jogos": j, "vitorias": r.get("won"), "empates": r.get("draw"),
                        "derrotas": r.get("lost"), "gols_pro": r.get("goalsFor"), "gols_contra": r.get("goalsAgainst"),
                        "saldo_gols": r.get("goalDifference"), "aproveitamento": round(p / (3 * j) * 100) if j else 0,
                        "variacao_posicao": 0, "ultimos_jogos": f[-5:], "faixa_classificacao": zone})
        return out

    if len(tables) <= 1:
        return rows(tables[0]["table"], False) if tables else []
    return {"fase-de-grupos": {(s.get("group") or "grupo").lower().replace("_", "-"): rows(s["table"], True) for s in tables}}


def artilharia(lid, kind="gols"):
    d = _get(f"/competitions/{LEAGUES[lid]['code']}/scorers?limit=50", 1800)
    out = []
    for s in d.get("scorers", []):
        p = s.get("player") or {}
        pos = POS_PT.get(p.get("position") or p.get("section") or "", (p.get("position") or "", ""))
        item = {"atleta": {"atleta_id": OFFSET + int(p["id"]), "nome_popular": p.get("name"), "posicao": {"nome": pos[0], "sigla": pos[1]} if pos[0] else []},
                "time": team(s.get("team")), "jogos": s.get("playedMatches"), "gols": s.get("goals") or 0, "assistencias": s.get("assists") or 0}
        out.append(item)
    if kind == "assistencias":
        out = sorted((x for x in out if x["assistencias"]), key=lambda x: -x["assistencias"])
    return out


def craques(lid):
    """Artilheiros com atributos para o minijogo (idade, nacionalidade, posição, camisa)."""
    d = _get(f"/competitions/{LEAGUES[lid]['code']}/scorers?limit=50", 1800)
    out = []
    for s in d.get("scorers", []):
        p = s.get("player") or {}
        if (s.get("goals") or 0) < 3:
            continue
        out.append({"id": OFFSET + int(p["id"]), "nome": p.get("name"), "time": team(s.get("team")), "liga": LEAGUES[lid]["popular"],
                    "posicao": {"Goalkeeper": "Goleiro", "Defence": "Defensor", "Midfield": "Meio-campista", "Offence": "Atacante"}.get(p.get("section"))
                    or POS_PT.get(p.get("position") or "", ("",))[0] or None,
                    "idade": _age(p.get("dateOfBirth")), "nacionalidade": COUNTRY_PT.get(p.get("nationality"), p.get("nationality")),
                    "camisa": p.get("shirtNumber"), "gols": s.get("goals")})
    for x in out:  # posições específicas -> grupo
        x["posicao"] = {"Zagueiro": "Defensor", "Lateral-esquerdo": "Defensor", "Lateral-direito": "Defensor", "Volante": "Meio-campista",
                        "Meia-atacante": "Meio-campista", "Ponta-esquerda": "Atacante", "Ponta-direita": "Atacante", "Centroavante": "Atacante"}.get(x["posicao"], x["posicao"])
    return out


# ---------------------------------------------------------------- partidas, times, atletas
def ao_vivo():
    out = []
    for m in _today().get("matches", []):
        lid = CODE_TO_ID.get(m["competition"]["code"])
        if lid and m["status"] in ("IN_PLAY", "PAUSED", "LIVE"):
            out.append(match(m, lid))
    return out


def partida(pid):
    mid = pid - OFFSET
    m = _get(f"/matches/{mid}", 60)
    lid = CODE_TO_ID.get(m["competition"]["code"])
    if not lid:
        raise NotFound("partida")
    out = match(m, lid)
    out["arbitragem"] = [{"nome": r.get("name"), "funcao": {"REFEREE": "Árbitro", "ASSISTANT_REFEREE_N1": "Assistente 1",
                          "ASSISTANT_REFEREE_N2": "Assistente 2", "FOURTH_OFFICIAL": "Quarto árbitro", "VIDEO_ASSISTANT_REFEREE_N1": "VAR"}.get(r.get("type"), r.get("type")),
                          "nacionalidade": COUNTRY_PT.get(r.get("nationality"), r.get("nationality"))} for r in m.get("referees", [])]
    ht = (m.get("score") or {}).get("halfTime") or {}
    if ht.get("home") is not None:
        out["placar_intervalo"] = f"{ht['home']} x {ht['away']}"
    try:  # confronto direto (cache longo: muda só quando os dois se enfrentam)
        h2h = _get(f"/matches/{mid}/head2head?limit=10", 24 * 3600)
        # o resumo é calculado dos próprios jogos (os "aggregates" da API vêm parciais no plano gratuito)
        hid, aid = (m.get("homeTeam") or {}).get("id"), (m.get("awayTeam") or {}).get("id")
        past = [x for x in h2h.get("matches", []) if x["id"] != mid and x.get("status") == "FINISHED"]
        wins = {hid: 0, aid: 0}
        draws = goals = 0
        for x in past:
            ft = (x.get("score") or {}).get("fullTime") or {}
            gh, ga = ft.get("home") or 0, ft.get("away") or 0
            goals += gh + ga
            w = (x.get("score") or {}).get("winner")
            if w == "DRAW":
                draws += 1
            elif w in ("HOME_TEAM", "AWAY_TEAM"):
                winner = (x["homeTeam"] if w == "HOME_TEAM" else x["awayTeam"]).get("id")
                if winner in wins:
                    wins[winner] += 1
        out["confronto"] = {
            "jogos": len(past), "gols": goals, "vitorias_mandante": wins[hid], "vitorias_visitante": wins[aid], "empates": draws,
            "partidas": [match(x, CODE_TO_ID.get(x["competition"]["code"], lid)) for x in past][:8],
        }
    except Exception:
        out["confronto"] = None
    out["estatisticas"] = None
    out["escalacoes"] = None
    out["fonte"] = "football-data"
    return out


def _age(dob):
    if not dob:
        return None
    b = date.fromisoformat(dob[:10])
    t = date.today()
    return t.year - b.year - ((t.month, t.day) < (b.month, b.day))


def time_info(tid):
    t = _get(f"/teams/{tid - OFFSET}", 24 * 3600)
    out = team(t)
    coach = t.get("coach") or {}
    out.update({"nome": t.get("name"), "apelido": None, "estadio": t.get("venue"), "fundacao": t.get("founded"),
                "cores": t.get("clubColors"), "site": t.get("website"), "endereco": t.get("address"),
                "tecnico": {"nome": coach.get("name"), "nacionalidade": COUNTRY_PT.get(coach.get("nationality"), coach.get("nationality")),
                            "contrato_ate": (coach.get("contract") or {}).get("until")} if coach.get("name") else None,
                "pais": (t.get("area") or {}).get("name")})
    return out


def time_campeonatos(tid):
    raw = _get(f"/teams/{tid - OFFSET}", 24 * 3600)
    t = team(raw)
    running = [CODE_TO_ID[c["code"]] for c in raw.get("runningCompetitions", []) if c.get("code") in CODE_TO_ID]
    return {"time": t, "campeonatos": [{"campeonato_id": str(lid), "nome": LEAGUES[lid]["popular"], "edicao": "", "status": "andamento"} for lid in running]}


def elenco(tid):
    t = _get(f"/teams/{tid - OFFSET}", 24 * 3600)
    out = []
    for p in t.get("squad", []):
        pos = POS_PT.get(p.get("position") or "", (p.get("position") or "", ""))
        out.append({"atleta": {"atleta_id": OFFSET + int(p["id"]), "nome_popular": p.get("name"), "nome": p.get("name")},
                    "camisa": p.get("shirtNumber") or "", "posicao": {"nome": pos[0], "sigla": pos[1]},
                    "idade": _age(p.get("dateOfBirth")), "nacionalidade": COUNTRY_PT.get(p.get("nationality"), p.get("nationality")), "bandeira": None})
    return out


def time_partidas(tid, kind):
    """GET /v4/teams/{id}/matches (1 chamada, todas as competições do plano), agrupado por campeonato."""
    t_fd = tid - OFFSET
    if kind == "ao-vivo":
        return [match(m, CODE_TO_ID[m["competition"]["code"]]) for m in _today().get("matches", [])
                if m["status"] in ("IN_PLAY", "PAUSED", "LIVE") and m["competition"]["code"] in CODE_TO_ID
                and t_fd in ((m.get("homeTeam") or {}).get("id"), (m.get("awayTeam") or {}).get("id"))]
    today = date.today()
    if kind == "proximas":
        path = f"/teams/{t_fd}/matches?dateFrom={today}&dateTo={today + timedelta(days=90)}"
    else:
        path = f"/teams/{t_fd}/matches?status=FINISHED&dateFrom={today - timedelta(days=150)}&dateTo={today}"
    raw = _get(path, 1800 if kind == "proximas" else 3600).get("matches", [])
    sel = [match(m, CODE_TO_ID[m["competition"]["code"]]) for m in raw if m["competition"]["code"] in CODE_TO_ID]
    if kind == "proximas":
        sel = sorted((m for m in sel if m["status"] in ("agendado", "andamento", "adiado")), key=lambda m: m["data_realizacao_iso"] or "9")
    else:
        sel = sorted((m for m in sel if m["status"] == "finalizado"), key=lambda m: m["data_realizacao_iso"] or "", reverse=True)
    out = {}
    for m in sel:
        out.setdefault(LEAGUES[m["campeonato"]["campeonato_id"]]["code"].lower(), []).append(m)
    return out


def atleta(aid):
    p = _get(f"/persons/{aid - OFFSET}", 7 * 24 * 3600)
    pos = POS_PT.get(p.get("position") or p.get("section") or "", (p.get("position") or "", ""))
    ct = p.get("currentTeam") or {}
    return {"atleta_id": aid, "nome_popular": p.get("name"), "nome": " ".join(x for x in (p.get("firstName"), p.get("lastName")) if x) or p.get("name"),
            "posicao": {"nome": pos[0], "sigla": pos[1]}, "camisa": p.get("shirtNumber"), "idade": _age(p.get("dateOfBirth")),
            "nascimento": p.get("dateOfBirth"), "nacionalidade": COUNTRY_PT.get(p.get("nationality"), p.get("nationality")),
            "time": team(ct) if ct.get("id") else None}


# ---------------------------------------------------------------- roteamento
def _l(m):
    lid = int(m.group(1))
    if lid not in LEAGUES:
        raise NotFound("campeonato")
    return lid


ROUTES = [
    (re.compile(r"^/campeonatos$"), lambda m: campeonatos()),
    (re.compile(r"^/campeonatos/(\d+)$"), lambda m: campeonato(_l(m), detail=True)),
    (re.compile(r"^/campeonatos/(\d+)/tabela$"), lambda m: tabela(_l(m))),
    (re.compile(r"^/campeonatos/(\d+)/rodadas$"), lambda m: rodadas(_l(m))),
    (re.compile(r"^/campeonatos/(\d+)/rodadas/(\d+)$"), lambda m: rodada(_l(m), int(m.group(2)))),
    (re.compile(r"^/campeonatos/(\d+)/fases$"), lambda m: fases_lista(_l(m))),
    (re.compile(r"^/campeonatos/(\d+)/fases/(\d+)$"), lambda m: fase(_l(m), int(m.group(2)))),
    (re.compile(r"^/campeonatos/(\d+)/artilharia$"), lambda m: artilharia(_l(m))),
    (re.compile(r"^/campeonatos/(\d+)/assistencias$"), lambda m: artilharia(_l(m), "assistencias")),
    (re.compile(r"^/ao-vivo$"), lambda m: ao_vivo()),
    (re.compile(r"^/partidas/(\d+)$"), lambda m: partida(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)$"), lambda m: time_info(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)/campeonatos$"), lambda m: time_campeonatos(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)/elenco$"), lambda m: elenco(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)/partidas/(proximas|anteriores|ao-vivo)$"), lambda m: time_partidas(int(m.group(1)), m.group(2))),
    (re.compile(r"^/atletas/(\d+)$"), lambda m: atleta(int(m.group(1)))),
]


def owns(path: str) -> bool:
    """Este adaptador responde por este caminho? (campeonato europeu ou ID da football-data)"""
    m = re.match(r"^/campeonatos/(\d+)", path)
    if m:
        return int(m.group(1)) in LEAGUES
    m = re.match(r"^/(partidas|times|atletas)/(\d+)", path)
    return bool(m) and OFFSET <= int(m.group(2)) < OFFSET + 100_000_000


def handle(path: str) -> tuple[int, bytes]:
    for rx, fn in ROUTES:
        m = rx.match(path)
        if not m:
            continue
        try:
            return 200, json.dumps(fn(m), ensure_ascii=False).encode()
        except NotFound:
            return 404, b'{"message":"N\\u00e3o encontrado"}'
        except Busy:
            return 503, b'{"message":"Carregando dados da football-data.org (limite de 10 requisi\\u00e7\\u00f5es/min). Tente em instantes."}'
        except Exception as e:  # noqa: BLE001
            return 502, json.dumps({"message": f"Falha ao obter dados da football-data.org: {e}"}).encode()
    return 404, b'{"message":"Rota n\\u00e3o suportada"}'
