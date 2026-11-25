"""Adaptador ESPN → formato da API Futebol.

Busca dados públicos (não oficiais) da ESPN e devolve JSON no mesmo formato que a
API Futebol usa, para o frontend não precisar saber de onde os dados vieram.

IDs de times, partidas e atletas da ESPN recebem o deslocamento OFFSET, para nunca
colidirem com IDs da API Futebol quando as duas fontes convivem.
"""

import json
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

OFFSET = 900_000_000
BRT = timezone(timedelta(hours=-3))
SITE = "https://site.api.espn.com/apis/site/v2/sports/soccer"
SITE_WEB = "https://site.web.api.espn.com/apis/site/v2/sports/soccer"
STANDINGS = "https://site.api.espn.com/apis/v2/sports/soccer"

# campeonato_id (mesmos IDs da API Futebol quando existem) -> liga na ESPN
LEAGUES = {
    10: {"slug": "bra.1", "nome": "Campeonato Brasileiro Série A", "popular": "Brasileirão", "tipo": "Pontos Corridos", "regiao": "nacional", "league": True},
    14: {"slug": "bra.2", "nome": "Campeonato Brasileiro Série B", "popular": "Série B", "tipo": "Pontos Corridos", "regiao": "nacional", "league": True},
    2: {"slug": "bra.copa_do_brazil", "nome": "Copa do Brasil", "popular": "Copa do Brasil", "tipo": "Mata-Mata", "regiao": "nacional", "league": False},
    7: {"slug": "conmebol.libertadores", "nome": "Copa Libertadores da América", "popular": "Libertadores", "tipo": "Misto", "regiao": "continental", "league": False},
    9: {"slug": "conmebol.sudamericana", "nome": "Copa Sul-Americana", "popular": "Sul-Americana", "tipo": "Misto", "regiao": "continental", "league": False},
}
CORE = [10, 14, 2, 7, 9]  # Brasil e Conmebol: base dos times reconhecidos nas notícias


def _L(slug, nome, popular, regiao, league, pais=None, tipo=None, rr=True, grupo_zona=None):
    """Campeonato extra da ESPN (grátis, sem chave). rr=False: times se enfrentam mais de uma vez com o mesmo
    mandante (MLS, Argentina); grupo_zona: quantos se classificam em cada grupo/conferência da tabela."""
    return {"slug": slug, "nome": nome, "popular": popular, "regiao": regiao, "league": league, "pais": pais,
            "tipo": tipo or ("Pontos Corridos" if league else "Mata-Mata"), "rr": rr, "grupo_zona": grupo_zona}


# IDs 201+ para não colidir com a API Futebol (1–99) nem com a football-data (101–108)
LEAGUES.update({
    # Brasil: estaduais
    201: _L("bra.camp.paulista", "Campeonato Paulista", "Paulistão", "estadual", False, "Brasil", "Misto"),
    202: _L("bra.camp.carioca", "Campeonato Carioca", "Carioca", "estadual", False, "Brasil", "Misto"),
    203: _L("bra.camp.mineiro", "Campeonato Mineiro", "Mineiro", "estadual", False, "Brasil", "Misto"),
    204: _L("bra.camp.gaucho", "Campeonato Gaúcho", "Gauchão", "estadual", False, "Brasil", "Misto"),
    # os outros estaduais não estão na ESPN (só nos planos pagos da API Futebol); regionais que ela tem:
    205: _L("bra.copa_do_nordeste", "Copa do Nordeste", "Copa do Nordeste", "estadual", False, "Brasil", "Misto"),
    # América do Sul: ligas nacionais
    211: _L("arg.1", "Liga Profissional Argentina", "Liga Argentina", "continental", True, "Argentina", rr=False, grupo_zona=8),
    213: _L("chi.1", "Campeonato Chileno", "Liga Chilena", "continental", True, "Chile"),
    214: _L("uru.1", "Campeonato Uruguaio", "Liga Uruguaia", "continental", True, "Uruguai", rr=False),
    # Europa: copas continentais, segundas divisões, outras ligas e copas nacionais
    231: _L("uefa.europa", "UEFA Europa League", "Europa League", "europa", False, "Europa", "Misto"),
    232: _L("uefa.europa.conf", "UEFA Conference League", "Conference League", "europa", False, "Europa", "Misto"),
    233: _L("eng.2", "EFL Championship", "Championship", "europa", True, "Inglaterra"),
    234: _L("esp.2", "LaLiga Hypermotion", "LaLiga 2", "europa", True, "Espanha"),
    235: _L("ita.2", "Serie B Italiana", "Serie B Italiana", "europa", True, "Itália"),
    236: _L("ger.2", "2. Bundesliga", "2. Bundesliga", "europa", True, "Alemanha"),
    237: _L("tur.1", "Süper Lig", "Süper Lig", "europa", True, "Turquia"),
    238: _L("bel.1", "Pro League Belga", "Liga Belga", "europa", True, "Bélgica"),
    239: _L("sco.1", "Scottish Premiership", "Liga Escocesa", "europa", True, "Escócia", rr=False),
    240: _L("eng.fa", "FA Cup", "Copa da Inglaterra", "europa", False, "Inglaterra"),
    241: _L("eng.league_cup", "Carabao Cup", "Copa da Liga Inglesa", "europa", False, "Inglaterra"),
    242: _L("esp.copa_del_rey", "Copa del Rey", "Copa do Rei", "europa", False, "Espanha"),
    243: _L("ita.coppa_italia", "Coppa Italia", "Copa da Itália", "europa", False, "Itália"),
    244: _L("ger.dfb_pokal", "DFB-Pokal", "Copa da Alemanha", "europa", False, "Alemanha"),
    245: _L("fra.coupe_de_france", "Coupe de France", "Copa da França", "europa", False, "França"),
    # América do Norte
    221: _L("usa.1", "Major League Soccer", "MLS", "americas", True, "Estados Unidos", rr=False, grupo_zona=9),
    222: _L("mex.1", "Liga MX", "Liga MX", "americas", True, "México"),
    # Ásia
    251: _L("ksa.1", "Saudi Pro League", "Liga Saudita", "mundo", True, "Arábia Saudita"),
    252: _L("jpn.1", "J1 League", "J-League", "mundo", True, "Japão"),
    # Seleções
    261: _L("uefa.nations", "UEFA Nations League", "Liga das Nações", "selecoes", False, "Europa", "Misto"),
})
LEAGUE_ORDER = CORE + [201, 202, 203, 204, 205, 211, 213, 214, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245,
                       221, 222, 251, 252, 261]

# Faixas da tabela por posição (aproximação do regulamento vigente)
ZONES = {
    10: [(1, 4, "libertadores"), (5, 6, "pre-libertadores"), (7, 12, "sul-americana"), (17, 20, "rebaixamento")],
    14: [(1, 4, "acesso"), (17, 20, "rebaixamento")],
    201: [(1, 8, "classificados"), (15, 16, "rebaixamento")],
    231: [(1, 8, "oitavas"), (9, 24, "playoffs"), (25, 36, "eliminado")],
    232: [(1, 8, "oitavas"), (9, 24, "playoffs"), (25, 36, "eliminado")],
    233: [(1, 2, "acesso"), (3, 6, "playoffs"), (22, 24, "rebaixamento")],
    234: [(1, 2, "acesso"), (3, 6, "playoffs"), (19, 22, "rebaixamento")],
    235: [(1, 2, "acesso"), (3, 8, "playoffs"), (16, 17, "playoff-rebaixamento"), (18, 20, "rebaixamento")],
    236: [(1, 2, "acesso"), (3, 3, "playoffs"), (16, 16, "playoff-rebaixamento"), (17, 18, "rebaixamento")],
    222: [(1, 6, "classificados"), (7, 10, "playoffs")],
}

TEAM_NAMES = {
    "Athletico Paranaense": "Athletico-PR", "Red Bull Bragantino": "Bragantino", "Vasco da Gama": "Vasco",
    "Atlético Mineiro": "Atlético-MG", "Atletico-MG": "Atlético-MG", "Atlético Goianiense": "Atlético-GO",
    "America-MG": "América-MG", "Sao Paulo": "São Paulo", "Gremio": "Grêmio", "Vitoria": "Vitória", "Ceara": "Ceará",
    "Goias": "Goiás", "Cuiaba": "Cuiabá", "Avai": "Avaí", "Criciuma": "Criciúma", "Parana": "Paraná",
}

PHASES = {
    "first round": "Primeira Fase", "second round": "Segunda Fase", "third round": "Terceira Fase", "fourth round": "Quarta Fase",
    "fifth round": "Quinta Fase", "first stage": "Primeira Fase", "second stage": "Segunda Fase", "third stage": "Terceira Fase",
    "group": "Fase de Grupos", "group stage": "Fase de Grupos", "league stage": "Fase de Liga",
    "knockout round playoffs": "Playoffs", "knockout playoffs": "Playoffs", "playoffs": "Playoffs", "playoff round": "Playoffs",
    "round of 32": "16 avos de Final", "rd of 32": "16 avos de Final", "round of 16": "Oitavas de Final", "rd of 16": "Oitavas de Final",
    "quarterfinals": "Quartas de Final", "quarterfinal": "Quartas de Final", "quarter-finals": "Quartas de Final",
    "semifinals": "Semifinal", "semifinal": "Semifinal", "semi-finals": "Semifinal", "final": "Final", "finals": "Final",
    "league phase": "Fase de Liga", "first phase": "Primeira Fase", "second phase": "Segunda Fase", "group phase": "Fase de Grupos",
    "quarterfinal round": "Quartas de Final", "third place": "Disputa do 3º lugar", "3rd-place match": "Disputa do 3º lugar",
    "relegation playoffs": "Playoff de rebaixamento", "promotion playoffs": "Playoff de acesso", "regular season": "Temporada regular",
    "seventh round": "Sétima Fase", "sixth round": "Sexta Fase", "eighth round": "Oitava Fase", "ninth round": "Nona Fase",
    "round of 64": "32 avos de Final", "preliminary round": "Fase Preliminar", "qualifying round": "Qualificatória",
    "relegation stage": "Fase de rebaixamento", "taca guanabara": "Taça Guanabara", "taca rio": "Taça Rio", "farroupilha": "Taça Farroupilha", "playoffs": "Playoffs",
    "torneo apertura": "Apertura", "torneo clausura": "Clausura", "torneo intermedio": "Intermédio", "apertura": "Apertura", "clausura": "Clausura",
}
# etapas de mata-mata (pelo slug da etapa na ESPN): ficam fora das rodadas de uma liga
KO_RX = re.compile(r"final|semi|quarter|round-of|rd-of|playoff|play-off|wild-card|liguilla|promotion|relegation|placement|"
                   r"championship|knockout|repechaje|reclasific|3rd|third", re.I)

COUNTRY_PT = {
    "Brazil": "Brasil", "Uruguay": "Uruguai", "Colombia": "Colômbia", "Paraguay": "Paraguai", "Ecuador": "Equador",
    "Bolivia": "Bolívia", "Spain": "Espanha", "Italy": "Itália", "France": "França", "Germany": "Alemanha",
    "Netherlands": "Holanda", "England": "Inglaterra", "United States": "Estados Unidos", "USA": "Estados Unidos",
    "Mexico": "México", "Belgium": "Bélgica", "Switzerland": "Suíça", "Japan": "Japão", "Angola": "Angola",
    "Cameroon": "Camarões", "Nigeria": "Nigéria", "Ghana": "Gana", "Ivory Coast": "Costa do Marfim", "Croatia": "Croácia",
    "Serbia": "Sérvia", "Poland": "Polônia", "Greece": "Grécia", "Russia": "Rússia", "Ukraine": "Ucrânia",
}


def _country(c):
    return COUNTRY_PT.get(c, c) if c else None


def _height(a):
    inches = a.get("height")
    return f"{inches * 2.54 / 100:.2f} m".replace(".", ",") if isinstance(inches, (int, float)) and inches > 0 else None


POS_PT = {"Goalkeeper": "Goleiro", "Defender": "Defensor", "Midfielder": "Meio-campista", "Forward": "Atacante"}
# abreviação ESPN -> (profundidade no campo, nome PT, sigla PT)
POS_ABBR = {
    "G": (0, "Goleiro", "GOL"), "GK": (0, "Goleiro", "GOL"),
    "RB": (1, "Lateral-direito", "LD"), "LB": (1, "Lateral-esquerdo", "LE"), "RWB": (1.5, "Ala direito", "AD"), "LWB": (1.5, "Ala esquerdo", "AE"),
    "CD": (1, "Zagueiro", "ZAG"), "CD-L": (1, "Zagueiro", "ZAG"), "CD-R": (1, "Zagueiro", "ZAG"), "CB": (1, "Zagueiro", "ZAG"), "D": (1, "Defensor", "DEF"),
    "DM": (2, "Volante", "VOL"), "DM-L": (2, "Volante", "VOL"), "DM-R": (2, "Volante", "VOL"),
    "CM": (3, "Meio-campista", "MEI"), "CM-L": (3, "Meio-campista", "MEI"), "CM-R": (3, "Meio-campista", "MEI"), "M": (3, "Meio-campista", "MEI"),
    "LM": (3, "Meia-esquerda", "ME"), "RM": (3, "Meia-direita", "MD"),
    "AM": (4, "Meia-atacante", "MAT"), "AM-L": (4, "Ponta-esquerda", "PE"), "AM-R": (4, "Ponta-direita", "PD"),
    "LW": (4.5, "Ponta-esquerda", "PE"), "RW": (4.5, "Ponta-direita", "PD"),
    "F": (5, "Atacante", "ATA"), "CF": (5, "Centroavante", "CA"), "CF-L": (5, "Atacante", "ATA"), "CF-R": (5, "Atacante", "ATA"), "ST": (5, "Centroavante", "CA"),
}

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()
_event_league: dict[int, int] = {}  # id ESPN do evento -> campeonato_id
_event_stage: dict[int, int] = {}  # id ESPN do evento -> etapa (tipo da temporada na ESPN: Apertura, quartas...)
_season_memo: dict[int, tuple] = {}
_flights: dict[str, threading.Lock] = {}  # um download por vez para cada temporada
_team_colors: dict[str, tuple] = {}  # id ESPN do time -> (cor, cor secundária)
stats = {"requests": 0, "errors": 0}


class NotFound(Exception):
    pass


# ---------------------------------------------------------------- HTTP / cache
def _get(url: str, ttl: float):
    now = time.time()
    with _lock:
        hit = _cache.get(url)
        if hit and hit[0] > now:
            return hit[1]
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 PlacarAoVivo/3.0", "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        stats["requests"] += 1
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        stats["errors"] += 1
        if hit:  # sem rede: último valor, mesmo vencido
            return hit[1]
        if isinstance(e, urllib.error.HTTPError) and e.code in (400, 404):
            raise NotFound(url) from e
        raise
    with _lock:
        _cache[url] = (now + ttl, data)
    return data


# ---------------------------------------------------------------- helpers
def _slug(s: str) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def _int(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


def _parse_dt(s):
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def _mdt(m):
    return datetime.strptime(m["data_realizacao_iso"], "%Y-%m-%dT%H:%M:%S%z")


def _color(c):
    return "#" + c if c and re.fullmatch(r"[0-9a-fA-F]{6}", c) else None


# Times cujo logo "500-dark" da ESPN ainda é o escudo antigo (ex.: Athletico-PR, 3458, mostra o redondo de antes de 2018)
DARK_LOGO_OUTDATED = {"3458"}


def team(t: dict) -> dict:
    logo = t.get("logo") or next((l.get("href") for l in t.get("logos", []) if "default" in l.get("rel", [])), None) \
        or (t.get("logos") or [{}])[0].get("href")
    # versão para fundo escuro (mesmo padrão de URL da ESPN)
    logo_dark = next((l.get("href") for l in t.get("logos", []) if "dark" in l.get("rel", [])), None) \
        or (logo.replace("/500/", "/500-dark/") if logo and "/teamlogos/soccer/500/" in logo else None)
    name = (t.get("shortDisplayName") or t.get("displayName") or t.get("name") or "").strip()  # a ESPN às vezes manda "Boca "
    tid = str(t["id"])
    if tid in DARK_LOGO_OUTDATED:  # versão escura da ESPN com escudo antigo: usa a normal
        logo_dark = logo
    if "TBD" in name:  # vaga ainda não definida (ex.: final de copa)
        return {"time_id": OFFSET + int(tid), "nome_popular": "A definir", "sigla": "–", "escudo": None, "cor": None, "cor_secundaria": None}
    c1, c2 = _color(t.get("color")), _color(t.get("alternateColor"))
    if c1:
        _team_colors[tid] = (c1, c2)
    else:  # algumas respostas (ex.: classificação) vêm sem cor: usa a última vista
        c1, c2 = _team_colors.get(tid, (None, None))
    return {
        "time_id": OFFSET + int(tid),
        "nome_popular": TEAM_NAMES.get(name, name),
        "sigla": t.get("abbreviation") or name[:3].upper(),
        "escudo": logo.replace("http://", "https://", 1) if logo else None,  # a CSP só aceita imagens https
        "escudo_escuro": logo_dark.replace("http://", "https://", 1) if logo_dark else None,
        "cor": c1,
        "cor_secundaria": c2,
    }


def _status(st: dict):
    t = st.get("type", {})
    name, state = t.get("name", ""), t.get("state")
    if name == "STATUS_POSTPONED":
        return "adiado", None
    if name in ("STATUS_CANCELED", "STATUS_CANCELLED"):
        return "cancelado", None
    if name in ("STATUS_SUSPENDED", "STATUS_ABANDONED", "STATUS_DELAYED"):
        return "suspensa", None
    if state == "pre":
        return "agendado", None
    if state == "post":
        return "finalizado", "fim-de-jogo"
    period = st.get("period") or 1
    if name == "STATUS_HALFTIME":
        return "andamento", "intervalo"
    if name in ("STATUS_SHOOTOUT",) or period >= 5:
        return "andamento", "disputa-penalti"
    if name in ("STATUS_END_OF_REGULATION", "STATUS_END_OF_EXTRATIME", "STATUS_HALFTIME_ET"):
        return "andamento", "intervalo" if period <= 2 else "intervalo-prorrogacao"
    return "andamento", {1: "primeiro-tempo", 2: "segundo-tempo", 3: "primeiro-tempo-prorrogacao", 4: "segundo-tempo-prorrogacao"}.get(period, "segundo-tempo")


def _clock_label(display: str) -> str:
    # "45'+2'" -> "45+2'"
    d = (display or "").replace("'", "")
    return d + "'" if d else ""


PERIOD_SLUG = {1: "primeiro-tempo", 2: "segundo-tempo", 3: "primeiro-tempo-prorrogacao", 4: "segundo-tempo-prorrogacao", 5: "disputa-penalti"}
PERIOD_NAME = {1: "1º tempo", 2: "2º tempo", 3: "1º tempo prorr.", 4: "2º tempo prorr.", 5: "Pênaltis"}


def _camp_ref(lid: int) -> dict:
    L = LEAGUES[lid]
    return {"campeonato_id": lid, "nome": L["nome"], "slug": _slug(L["nome"]), "nome_popular": L["popular"]}


def match(ev: dict, lid: int, rounds: dict | None = None) -> dict:
    comp = ev["competitions"][0]
    home = next(c for c in comp["competitors"] if c.get("homeAway") == "home")
    away = next(c for c in comp["competitors"] if c.get("homeAway") == "away")
    st = comp.get("status") or ev.get("status") or {}
    status, periodo = _status(st)
    started = status in ("andamento", "finalizado")
    dt = _parse_dt(comp.get("date") or ev.get("date"))
    local = dt.astimezone(BRT) if dt else None
    H, A = team(home["team"]), team(away["team"])
    sh, sa = (_int(home.get("score"), 0), _int(away.get("score"), 0)) if started else (None, None)
    pen = None
    if home.get("shootoutScore") is not None and away.get("shootoutScore") is not None:
        pen = {"placar_penalti_mandante": _int(home["shootoutScore"], 0), "placar_penalti_visitante": _int(away["shootoutScore"], 0), "cobrancas": []}
    eid = int(ev["id"])
    _event_league[eid] = lid
    venue = (comp.get("venue") or ev.get("venue") or {})
    out = {
        "partida_id": OFFSET + eid,
        "campeonato": _camp_ref(lid),
        "placar": f"{H['nome_popular']} {sh}x{sa} {A['nome_popular']}" if started else f"{H['nome_popular']} x {A['nome_popular']}",
        "time_mandante": H, "time_visitante": A,
        "placar_mandante": sh, "placar_visitante": sa,
        "disputa_penalti": pen or False,
        "status": status,
        "periodo": periodo,
        "slug": f"{_slug(H['nome_popular'])}-{_slug(A['nome_popular'])}-{eid}",
        "data_realizacao": local.strftime("%d/%m/%Y") if local else None,
        "hora_realizacao": local.strftime("%H:%M") if local and comp.get("timeValid", ev.get("timeValid", True)) else None,
        "data_realizacao_iso": local.strftime("%Y-%m-%dT%H:%M:%S%z") if local else None,
        "estadio": {"nome_popular": venue.get("displayName") or venue.get("fullName")} if (venue.get("displayName") or venue.get("fullName")) else None,
        "_link": f"/v1/partidas/{OFFSET + eid}",
    }
    if status == "andamento":
        disp = st.get("displayClock", "")
        out["cronometro"] = _int(re.match(r"\d+", disp).group()) if re.match(r"\d+", disp) else None
        out["cronometro_label"] = _clock_label(disp)
    if rounds and eid in rounds:
        out["rodada_numero"] = rounds[eid]  # rodada reconstruída (a ESPN não informa)
    return out


# ---------------------------------------------------------------- temporada
def _year() -> int:
    return datetime.now(BRT).year


def _year_events(slug: str, y: int) -> dict:
    """Todos os jogos de um ano civil (a ESPN não aceita intervalo de datas). TTL curto se houver jogo perto de agora."""
    url = f"{SITE}/{slug}/scoreboard?dates={y}&limit=1000"
    with _lock:
        hit = _cache.get(url)
        flight = _flights.setdefault(url, threading.Lock())
    if hit and hit[0] > time.time():
        return hit[1]
    with flight:  # servidor frio com várias visitas: um download por temporada; as outras esperam e reaproveitam
        with _lock:
            hit = _cache.get(url)
        if hit and hit[0] > time.time():
            return hit[1]
        return _store_year(url)


def _store_year(url):
    data = _get(url, 60)
    now = datetime.now(timezone.utc)
    near = any(abs((_parse_dt(e["date"]) - now).total_seconds()) < 4 * 3600 for e in data.get("events", []) if e.get("date"))
    with _lock:
        _cache[url] = (time.time() + (60 if near else 300), data)
    return data


def season(lid: int) -> dict:
    """Jogos da temporada atual. Ligas de agosto a maio (Europa, Arábia, México) atravessam dois anos civis:
    busca os dois e fica só com a temporada atual (cada jogo traz o ano da sua temporada)."""
    slug, y = LEAGUES[lid]["slug"], _year()
    base = _year_events(slug, y)
    s = ((base.get("leagues") or [{}])[0].get("season") or {})
    sy = _int(s.get("year"), y)
    short = re.match(r"\d{4}(?:-\d{2,4})?", str(s.get("displayName") or ""))  # "2026" ou "2026-27"
    short = short.group() if short else str(sy)
    years = [sy, sy + 1] if "-" in short else [sy]
    parts = [base if yy == y else _year_events(slug, yy) for yy in years]
    key = tuple(id(p) for p in parts)
    memo = _season_memo.get(lid)
    if memo and memo[0] == key:  # mesmas respostas em cache: mesma temporada já montada
        return memo[1]
    evs, seen = [], set()
    for p in parts:
        for e in p.get("events", []):
            eid = int(e["id"])
            _event_league[eid] = lid  # todo jogo conhecido abre a página da partida, mesmo de outra temporada
            se = e.get("season") or {}
            if _int(se.get("year"), sy) != sy or eid in seen:
                continue
            seen.add(eid)
            _event_stage[eid] = _int(se.get("type"))
            evs.append(e)
    out = {"leagues": base.get("leagues") or [], "events": evs, "season_year": sy, "season_name": short}
    _season_memo[lid] = (key, out)
    return out


def _stages(lid) -> list[dict]:
    """Etapas da temporada na ordem (Apertura, Clausura, fase de liga, quartas...): a ESPN marca cada jogo com uma."""
    st: dict[int, dict] = {}
    for e in season(lid)["events"]:
        se = e.get("season") or {}
        k, d = _int(se.get("type")), _parse_dt(e.get("date"))
        s = st.setdefault(k, {"type": k, "slug": se.get("slug") or "", "start": d, "end": d, "n": 0})
        s["n"] += 1
        if d:
            s["start"], s["end"] = min(s["start"] or d, d), max(s["end"] or d, d)
    far = datetime.max.replace(tzinfo=timezone.utc)
    return sorted(st.values(), key=lambda s: s["start"] or far)


def _table_stages(lid):
    return [s for s in _stages(lid) if not KO_RX.search(s["slug"])]


def _table_stage(lid):
    """Etapa de pontos corridos em vigor: a última que já começou (ex.: Clausura na Argentina)."""
    tbl = _table_stages(lid)
    soon = datetime.now(timezone.utc) + timedelta(days=21)
    started = [s for s in tbl if s["start"] and s["start"] <= soon]
    return started[-1] if started else (tbl[0] if tbl else None)


def _stage_label(slug):
    """'apertura---round-of-16' -> 'Apertura · Oitavas de Final'; 'league-phase' -> 'Fase de Liga'."""
    parts = []
    for p in (slug or "").split("---"):
        w = re.sub(r"^\d{4}\s+", "", p.replace("-", " ").strip())
        parts.append(PHASES.get(w.lower()) or (w[:1].upper() + w[1:]))
    return " · ".join(x for x in parts if x) or "Fase"


def _is_placeholder(e):
    return any("TBD" in (c["team"].get("displayName") or "") for c in e["competitions"][0]["competitors"])


def _events(lid):
    evs = [e for e in season(lid).get("events", []) if e.get("competitions")]
    if LEAGUES[lid]["league"]:
        # liga com mais de um torneio no ano (Apertura/Clausura) ou com playoffs: só a etapa de pontos em vigor
        stg = _table_stage(lid)
        if stg and len(_stages(lid)) > 1:
            evs = [e for e in evs if _event_stage.get(int(e["id"])) == stg["type"]]
        off = lambda e: (e.get("status") or {}).get("type", {}).get("name") in ("STATUS_POSTPONED", "STATUS_CANCELED")
        key = lambda e: tuple(c["team"]["id"] for c in sorted(e["competitions"][0]["competitors"], key=lambda c: c.get("homeAway") != "home"))
        evs = [e for e in evs if not _is_placeholder(e)]
        if LEAGUES[lid].get("rr", True):
            # Em pontos corridos cada mandante x visitante acontece uma vez. Um jogo adiado às vezes
            # fica duplicado (evento antigo "adiado" + evento remarcado): mantém só o válido.
            best: dict[tuple, dict] = {}
            rank = lambda e: (0 if off(e) else 1, e.get("date", ""))
            for e in evs:
                if key(e) not in best or rank(e) > rank(best[key(e)]):
                    best[key(e)] = e
            evs = list(best.values())
        else:
            # MLS, Argentina...: o mesmo mandante pode receber o mesmo rival duas vezes. Só tira o evento
            # adiado/cancelado quando o mesmo confronto tem um evento válido (o remarcado).
            valid = {key(e) for e in evs if not off(e)}
            evs = [e for e in evs if not (off(e) and key(e) in valid)]
    return sorted(evs, key=lambda e: e.get("date", ""))


def _team_ids(e):
    return [c["team"]["id"] for c in e["competitions"][0]["competitors"]]


def _monday(dt):
    d = dt.astimezone(BRT).date()
    return d - timedelta(days=d.weekday())


def rounds_map(lid) -> dict[int, int]:
    """Rodada de cada jogo (1 a 38 no Brasileirão). A ESPN não informa a rodada, então ela vem da campanha:
    o n-ésimo jogo de cada time é a rodada n (no jogo, vale o maior n dos dois times). Fica sempre entre 1 e o
    número de jogos de cada time, segue o calendário e bate com a coluna J da tabela; um jogo adiado aparece
    na rodada em que ele de fato acontece."""
    seq: dict[str, int] = {}
    out: dict[int, int] = {}
    for e in _events(lid):
        a, b = _team_ids(e)
        seq[a] = seq.get(a, 0) + 1
        seq[b] = seq.get(b, 0) + 1
        out[int(e["id"])] = max(seq[a], seq[b])
    return out

MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"]


def _week_name(lid, n):
    """Nome da rodada (mantido o nome da função por compatibilidade)."""
    return f"{n}ª Rodada"

def _round_status(ms):
    st = [m["status"] for m in ms]
    if any(s == "andamento" for s in st):
        return "andamento"
    if all(s in ("finalizado", "cancelado") for s in st):
        return "encerrada"
    if any(s == "finalizado" for s in st) and any(s == "agendado" for s in st):
        return "andamento"
    return "agendada"


def _current_round(lid, rmap, matches):
    by_round: dict[int, list] = {}
    for m in matches:
        by_round.setdefault(rmap.get(m["partida_id"] - OFFSET, 0), []).append(m)
    # rodada atual: a primeira cuja data típica (mediana dos jogos) não passou há mais de 2 dias.
    # A mediana ignora jogos adiados: um jogo atrasado não prende a rodada antiga como "atual".
    when = {int(e["id"]): _parse_dt(e.get("date")) for e in _events(lid)}
    limit = datetime.now(timezone.utc) - timedelta(days=2)
    rounds = sorted(r for r in by_round if r)

    def median(r):
        ds = sorted(d for d in (when.get(m["partida_id"] - OFFSET) for m in by_round[r]) if d)
        return ds[len(ds) // 2] if ds else None
    cur = next((r for r in rounds if (median(r) or limit) >= limit), rounds[-1] if rounds else 1)
    return cur, by_round


def _calendar(lid):
    cal = (season(lid).get("leagues") or [{}])[0].get("calendar") or []
    if cal and isinstance(cal[0], dict):
        return cal[0].get("entries", [])
    return []


def _phase_name(label):
    return PHASES.get((label or "").strip().lower(), label)


def phases(lid) -> list[dict]:
    if LEAGUES[lid]["league"]:
        return [{"fase_id": lid * 1000 + 1, "nome": "Fase única", "tipo": "pontos-corridos", "start": None, "end": None}]
    out = []
    for e in _calendar(lid):
        label = e.get("label", "")
        tipo = "grupos" if "group" in label.lower() or "league" in label.lower() else "mata-mata"
        out.append({"fase_id": lid * 1000 + (_int(e.get("value"), len(out) + 1)), "nome": _phase_name(label), "tipo": tipo,
                    "start": _parse_dt(e.get("startDate")), "end": _parse_dt(e.get("endDate"))})
    if out:
        return out
    # sem calendário (estaduais): as fases vêm das etapas que a ESPN marca em cada jogo
    for i, s in enumerate(_stages(lid), 1):
        out.append({"fase_id": lid * 1000 + i, "nome": _stage_label(s["slug"]), "stype": s["type"],
                    "tipo": "mata-mata" if KO_RX.search(s["slug"]) else "grupos",
                    "start": s["start"], "end": s["end"] + timedelta(hours=6) if s["end"] else None})
    return out


def _phase_of_match(ph_list, m):
    """Fase de uma partida: pela etapa da ESPN quando a fase veio dela; senão, pela data."""
    st = _event_stage.get(m["partida_id"] - OFFSET)
    p = next((p for p in ph_list if p.get("stype") is not None and p["stype"] == st), None)
    return p or (_phase_of(ph_list, _mdt(m)) if m["data_realizacao_iso"] else None)


def _phase_of(ph_list, dt):
    for p in ph_list:
        if p["start"] and p["end"] and p["start"] <= dt < p["end"]:
            return p
    return None


_matches_memo: dict[int, tuple[int, list, dict | None]] = {}


def _all_matches(lid):
    data = season(lid)
    memo = _matches_memo.get(lid)
    if memo and memo[0] == id(data):  # mesma resposta em cache: reaproveita a conversão
        return memo[1], memo[2]
    rmap = rounds_map(lid) if LEAGUES[lid]["league"] else None
    ms = [match(e, lid, rmap) for e in _events(lid)]
    _matches_memo[lid] = (id(data), ms, rmap)
    return ms, rmap


def _phase_ref(p, lid):
    return {"fase_id": p["fase_id"], "nome": p["nome"], "slug": _slug(p["nome"]), "tipo": p["tipo"],
            "_link": f"/v1/campeonatos/{lid}/fases/{p['fase_id']}"}


def campeonato(lid: int, detail=False) -> dict:
    L = LEAGUES[lid]
    sb = season(lid)
    lg = (sb.get("leagues") or [{}])[0]
    logo = next((l["href"] for l in lg.get("logos", []) if "default" in l.get("rel", [])), None) or (lg.get("logos") or [{}])[0].get("href")
    logo_dark = next((l["href"] for l in lg.get("logos", []) if "dark" in l.get("rel", [])), None)
    https = lambda u: u.replace("http://", "https://", 1) if u else u  # alguns logos vêm em http e a CSP só aceita https
    logo, logo_dark = https(logo), https(logo_dark)
    matches, rmap = _all_matches(lid)
    year = sb.get("season_year") or _year()
    tname = sb.get("season_name") or str(year)  # "2026" ou "2026-27"
    if L["league"] and len(_table_stages(lid)) > 1 and _table_stage(lid):  # Apertura/Clausura: diz qual está valendo
        tname = f"{tname} · {_stage_label(_table_stage(lid)['slug'])}"
    now = datetime.now(timezone.utc)
    statuses = [m["status"] for m in matches]
    status = "finalizado" if statuses and all(s in ("finalizado", "cancelado") for s in statuses) else "andamento"
    ph = phases(lid)
    current = ph[0] if L["league"] else (_phase_of(ph, now) or next((p for p in reversed(ph) if p["start"] and p["start"] <= now), ph[0] if ph else None))
    out = {
        "campeonato_id": lid, "nome": L["nome"], "slug": _slug(L["nome"]), "nome_popular": L["popular"],
        "edicao_atual": {"edicao_id": lid * 10000 + year, "temporada": tname, "nome": f"{L['nome']} {tname}", "nome_popular": f"{L['popular']} {tname}", "slug": _slug(f"{L['nome']} {tname}")},
        "fase_atual": _phase_ref(current, lid) if current else None,
        "rodada_atual": None,
        "status": status, "tipo": L["tipo"], "logo": logo, "logo_escuro": logo_dark, "regiao": L["regiao"], "pais": L.get("pais"),
        "fonte": "espn",
    }
    if L["league"] and matches:
        cur, by_round = _current_round(lid, rmap, matches)
        out["rodada_atual"] = {"nome": _week_name(lid, cur), "slug": f"rodada-{cur}", "rodada": cur, "status": _round_status(by_round.get(cur, []))}
    if matches:
        done = sum(1 for m in matches if m["status"] == "finalizado")
        out["progresso"] = round(done / len(matches) * 100)
        out["jogos_disputados"], out["jogos_total"] = done, len(matches)
    if detail:
        out["fases"] = [{**_phase_ref(p, lid), "status": "finalizado" if p["end"] and p["end"] < now else "andamento" if p["start"] and p["start"] <= now else "agendado"} for p in ph]
    return out


def _safe(fn, *a):
    try:
        return fn(*a)
    except Exception:  # noqa: BLE001 — liga indisponível agora: segue com as outras
        return None


def warm(lids=None):
    """Carrega as temporadas em paralelo (cada uma pesa ~0,4 MB e leva ~1 s na ESPN)."""
    lids = list(lids or LEAGUE_ORDER)
    with ThreadPoolExecutor(8) as ex:
        list(ex.map(lambda l: _safe(season, l), lids))


def campeonatos() -> list[dict]:
    warm()
    with ThreadPoolExecutor(8) as ex:
        return [c for c in ex.map(lambda l: _safe(campeonato, l), LEAGUE_ORDER) if c]


def rodadas(lid) -> list[dict]:
    if not LEAGUES[lid]["league"]:
        raise NotFound("rodadas")
    matches, rmap = _all_matches(lid)
    by_round: dict[int, list] = {}
    for m in matches:
        by_round.setdefault(m.get("rodada_numero", 0), []).append(m)
    out = []
    for r in sorted(k for k in by_round if k):
        out.append({"nome": _week_name(lid, r), "slug": f"rodada-{r}", "rodada": r, "status": _round_status(by_round[r]),
                    "_link": f"/v1/campeonatos/{lid}/rodadas/{r}"})
    return out


def rodada(lid, n) -> dict:
    """Jogos de uma rodada do campeonato (ver rounds_map)."""
    matches, _ = _all_matches(lid)
    ms = [m for m in matches if m.get("rodada_numero") == n]
    if not ms:
        raise NotFound("rodada")
    weeks = sorted({m.get("rodada_numero") for m in matches if m.get("rodada_numero")})
    i = weeks.index(n)
    ref = lambda r: {"nome": _week_name(lid, r), "slug": f"rodada-{r}", "rodada": r} if r else None
    return {"nome": _week_name(lid, n), "slug": f"rodada-{n}", "rodada": n, "status": _round_status(ms),
            "proxima_rodada": ref(weeks[i + 1] if i + 1 < len(weeks) else None),
            "rodada_anterior": ref(weeks[i - 1] if i > 0 else None), "partidas": ms}


def fase(lid, fid) -> dict:
    ph = next((p for p in phases(lid) if p["fase_id"] == fid), None)
    if not ph:
        raise NotFound("fase")
    matches, _ = _all_matches(lid)
    if ph.get("stype") is not None:  # fase montada pelas etapas da ESPN: os jogos daquela etapa
        ms = [m for m in matches if _event_stage.get(m["partida_id"] - OFFSET) == ph["stype"]]
    elif ph["start"]:
        ms = [m for m in matches if m["data_realizacao_iso"] and ph["start"] <= _mdt(m) < ph["end"]]
    else:
        ms = matches
    out = {**_phase_ref(ph, lid), "campeonato": _camp_ref(lid), "chaves": [], "grupos": {}, "partidas": []}
    if ph["tipo"] == "mata-mata":
        ties: dict[frozenset, list] = {}
        for m in ms:
            ties.setdefault(frozenset((m["time_mandante"]["time_id"], m["time_visitante"]["time_id"])), []).append(m)
        for i, legs in enumerate(ties.values(), 1):
            legs.sort(key=lambda m: m["data_realizacao_iso"] or "")
            out["chaves"].append({"nome": f"Chave {i}", "slug": f"chave-{i}", "partida_ida": legs[0], "partida_volta": legs[1] if len(legs) > 1 else None})
    else:
        out["partidas"] = ms
    return out


# ---------------------------------------------------------------- tabela
def _form(lid) -> dict[int, list[str]]:
    res: dict[int, list[str]] = {}
    for m in _all_matches(lid)[0]:
        if m["status"] != "finalizado":
            continue
        h, a = m["time_mandante"]["time_id"], m["time_visitante"]["time_id"]
        gh, ga = m["placar_mandante"], m["placar_visitante"]
        res.setdefault(h, []).append("v" if gh > ga else "d" if gh < ga else "e")
        res.setdefault(a, []).append("v" if ga > gh else "d" if ga < gh else "e")
    return {k: v[-5:] for k, v in res.items()}


def _zone(lid, pos, group_mode):
    if group_mode:
        n = LEAGUES[lid].get("grupo_zona")  # conferências da MLS, zonas da Argentina
        if n:
            return "classificados" if pos <= n else None
        return "classificados" if pos <= 2 else "sul-americana" if pos == 3 and lid == 7 else None
    for lo, hi, z in ZONES.get(lid, []):
        if lo <= pos <= hi:
            return z
    return None


def tabela(lid):
    data = _get(f"{STANDINGS}/{LEAGUES[lid]['slug']}/standings?season={season(lid)['season_year']}", 120)
    groups = data.get("children") or []
    form = _form(lid)

    def rows(entries, group_mode):
        out = []
        for e in entries:
            s = {x["name"]: x for x in e.get("stats", [])}
            v = lambda k: _int((s.get(k) or {}).get("value"), 0)
            t = team(e["team"])
            j, p = v("gamesPlayed"), v("points")
            out.append({
                "posicao": v("rank"), "pontos": p, "time": t, "jogos": j, "vitorias": v("wins"), "empates": v("ties"),
                "derrotas": v("losses"), "gols_pro": v("pointsFor"), "gols_contra": v("pointsAgainst"),
                "saldo_gols": v("pointDifferential"), "aproveitamento": round(p / (3 * j) * 100) if j else 0,
                "variacao_posicao": v("rankChange"), "ultimos_jogos": form.get(t["time_id"], []),
            })
        out.sort(key=lambda r: r["posicao"] or 99)
        for i, r in enumerate(out, 1):
            r["posicao"] = r["posicao"] or i
            r["faixa_classificacao"] = _zone(lid, r["posicao"], group_mode)
        return out

    if len(groups) <= 1:
        return rows(groups[0]["standings"]["entries"], False) if groups else []
    res = {}
    for g in groups:
        name = g.get("name") or g.get("abbreviation") or "Grupo"
        letter = re.search(r"Group\s+([A-Z])", name)
        key = f"grupo-{letter.group(1).lower()}" if letter else _slug(name)
        res[key] = rows(g["standings"]["entries"], True)
    return {"fase-de-grupos": res}


def _leaders(lid, kind):
    data = _get(f"{SITE_WEB}/{LEAGUES[lid]['slug']}/statistics", 300)
    cat = next((s for s in data.get("stats", []) if s.get("name") == kind), None)
    out = []
    for l in (cat or {}).get("leaders", []):
        a = l.get("athlete", {})
        if not a.get("id"):
            continue
        m = re.search(r"Matches:\s*(\d+)", l.get("displayValue", ""))
        item = {"atleta": {"atleta_id": OFFSET + int(a["id"]), "nome_popular": a.get("displayName", ""), "posicao": []},
                "time": team(a["team"]) if a.get("team") else None, "jogos": int(m.group(1)) if m else None}
        item["gols" if kind == "goalsLeaders" else "assistencias"] = _int(l.get("value"), 0)
        out.append(item)
    return out


def artilharia(lid):
    return _leaders(lid, "goalsLeaders")


def assistencias(lid):
    return _leaders(lid, "assistsLeaders")


# ---------------------------------------------------------------- ao vivo / partida
# Ao vivo rápido: a liga com jogo rolando (ou começando em até 20 min) é consultada a cada 4 s; as paradas, a cada
# 90 s. Assim um gol chega em poucos segundos sem consultar as ~30 ligas o tempo todo.
LIVE_TTL, IDLE_TTL, SOON = 4, 90, 20 * 60
_hot: dict[int, bool] = {}


def _is_hot(sb) -> bool:
    now = time.time()
    for e in sb.get("events", []):
        st = (e.get("status") or {}).get("type", {}).get("state")
        if st == "in":
            return True
        if st == "pre":
            try:
                t = datetime.fromisoformat(e["date"].replace("Z", "+00:00")).timestamp()
            except (KeyError, ValueError):
                continue
            if t - now < SOON:
                return True
    return False


def live_soon() -> bool:
    """Algum jogo rolando ou para começar logo (o ciclo do ao vivo fica mais rápido)."""
    return any(_hot.values())


def _live_of(lid):
    sb = _safe(_get, f"{SITE}/{LEAGUES[lid]['slug']}/scoreboard", LIVE_TTL if _hot.get(lid, True) else IDLE_TTL) or {}
    _hot[lid] = _is_hot(sb)
    out = []
    for e in sb.get("events", []):
        if (e.get("status") or {}).get("type", {}).get("state") == "in":
            rmap = _safe(rounds_map, lid) if LEAGUES[lid]["league"] else None
            out.append(match(e, lid, rmap))
    return out


def ao_vivo(exclude: set[int] = frozenset()):
    """Jogos rolando agora em todas as ligas (uma consulta pequena por liga, em paralelo)."""
    lids = [l for l in LEAGUE_ORDER if l not in exclude]
    with ThreadPoolExecutor(8) as ex:
        return [m for ms in ex.map(_live_of, lids) for m in ms]


def _league_for_event(eid):
    if eid not in _event_league:
        warm()
        for lid in LEAGUE_ORDER:
            try:
                season(lid)
            except Exception:
                continue
            if eid in _event_league:
                break
    if eid not in _event_league:
        raise NotFound("partida")
    return _event_league[eid]


def _kind(text):
    t = (text or "").lower()
    if "own goal" in t:
        return "gol_contra"
    if t.startswith("goal") or t == "penalty - scored":
        return "gol"
    if "red card" in t or "second yellow" in t or "yellow red" in t:
        return "vermelho"
    if "yellow card" in t:
        return "amarelo"
    if t == "substitution":
        return "sub"
    return None


def _pos(entry):
    p = entry.get("position") or {}
    ab = p.get("abbreviation") or ""
    if ab in POS_ABBR:
        return POS_ABBR[ab]
    name = p.get("name") or p.get("displayName") or ""
    return (3, POS_PT.get(name, name), ab or "")


def _side_rank(ab):
    ab = ab or ""
    if ab.endswith("-R") or (ab[:1] == "R" and ab not in ("",)):
        return 0
    if ab.endswith("-L") or ab[:1] == "L":
        return 2
    return 1


def _lineup(r):
    starters = [x for x in r.get("roster", []) if x.get("starter")]
    bench = [x for x in r.get("roster", []) if not x.get("starter")]
    formation = r.get("formation") or ""
    shape = [int(n) for n in re.findall(r"\d", formation)] if formation else []
    # ordena por profundidade (goleiro → ataque) e, na linha, da direita para a esquerda
    starters.sort(key=lambda x: (_pos(x)[0], _side_rank((x.get("position") or {}).get("abbreviation")), x.get("formationPlace") or 0))
    if shape and sum(shape) + 1 == len(starters):
        ordered, i = [starters[0]], 1
        for n in shape:
            line = sorted(starters[i:i + n], key=lambda x: (_side_rank((x.get("position") or {}).get("abbreviation")), x.get("formationPlace") or 0))
            ordered += line
            i += n
        starters = ordered

    def player(x, i):
        depth, nome, sigla = _pos(x)
        if sigla == "SUB":  # a ESPN não informa a posição de quem está no banco
            nome, sigla = "", ""
        a = x["athlete"]
        return {"atleta": {"atleta_id": OFFSET + int(a["id"]), "nome_popular": a.get("displayName") or a.get("shortName")},
                "camisa": x.get("jersey") or "", "ordem": i, "posicao": {"nome": nome, "sigla": sigla}}

    return {
        "esquema_tatico": "-".join(str(n) for n in shape) if shape else formation,
        "tecnico": None,
        "titulares": [player(x, i) for i, x in enumerate(starters)],
        "reservas": [player(x, i) for i, x in enumerate(bench)],
    }


def _stats(box_team):
    s = {x["name"]: x.get("displayValue") for x in box_team.get("statistics", [])}
    n = lambda k: _int(s.get(k))
    pct = lambda k: f"{round(float(s[k]) * (100 if float(s[k]) <= 1 else 1))}%" if s.get(k) not in (None, "") else None
    total, on, blocked = n("totalShots"), n("shotsOnTarget"), n("blockedShots")
    tp, ap = n("totalPasses"), n("accuratePasses")
    return {
        "posse_de_bola": f"{round(float(s['possessionPct']))}%" if s.get("possessionPct") else None,
        "escanteios": n("wonCorners"), "impedimentos": n("offsides"), "faltas": n("foulsCommitted"),
        "passes": {"total": tp, "completos": ap, "errados": (tp - ap) if tp is not None and ap is not None else None, "precisao": pct("passPct")},
        "finalizacao": {"total": total, "no_gol": on, "bloqueado": blocked,
                        "pra_fora": max(0, total - on - (blocked or 0)) if total is not None and on is not None else None,
                        "na_trave": None, "precisao": f"{round(on / total * 100)}%" if total and on is not None else None},
        "defensivo": {"defesas": n("saves")},
        "desarmes": n("effectiveTackles") if n("effectiveTackles") is not None else n("totalTackles"),
        "interceptacoes": n("interceptions"), "cortes": n("effectiveClearance"),
        "cruzamentos": {"total": n("totalCrosses"), "certos": n("accurateCrosses")},
        "lancamentos": {"total": n("totalLongBalls"), "certos": n("accurateLongBalls")},
        "cartoes_amarelos": n("yellowCards"), "cartoes_vermelhos": n("redCards"),
    }


def partida(pid: int) -> dict:
    eid = pid - OFFSET
    lid = _league_for_event(eid)
    s = _get(f"{SITE_WEB}/{LEAGUES[lid]['slug']}/summary?event={eid}", 15)
    comp = s["header"]["competitions"][0]
    ev = {"id": str(eid), "date": comp.get("date"), "competitions": [comp], "status": comp.get("status"),
          "venue": (s.get("gameInfo") or {}).get("venue") or {}}
    if ev["venue"] and "displayName" not in ev["venue"]:
        ev["venue"] = {"displayName": ev["venue"].get("fullName")}
    comp.setdefault("venue", ev["venue"])
    rmap = rounds_map(lid) if LEAGUES[lid]["league"] else None
    m = match(ev, lid, rmap)

    # fase (copas)
    if not LEAGUES[lid]["league"] and m["data_realizacao_iso"]:
        p = _phase_of(phases(lid), _mdt(m))
        if p:
            m["fase"] = _phase_ref(p, lid)
    elif LEAGUES[lid]["league"]:
        m["fase"] = _phase_ref(phases(lid)[0], lid)
    _fill_details(m, s)
    m["fonte"] = "espn"
    return m


def _fill_details(m: dict, s: dict):
    """Escalações (titulares e reservas), estatísticas e lances a partir do resumo da ESPN."""
    comp = s["header"]["competitions"][0]
    home_id = next(c["team"]["id"] for c in comp["competitors"] if c.get("homeAway") == "home")
    side_of_team = lambda tid: "mandante" if str(tid) == str(home_id) else "visitante"  # noqa: E731

    # escalações
    player_side = {}
    esc = {}
    for r in s.get("rosters", []):
        side = "mandante" if r.get("homeAway") == "home" else "visitante"
        if r.get("roster"):
            esc[side] = _lineup(r)
            for x in r["roster"]:
                player_side[x["athlete"]["id"]] = side
    m["escalacoes"] = esc or None

    # estatísticas
    box = {side_of_team(t["team"]["id"]): _stats(t) for t in (s.get("boxscore") or {}).get("teams", []) if t.get("statistics")}
    m["estatisticas"] = box if len(box) == 2 else None

    # lances
    gols = {"mandante": [], "visitante": []}
    cart = {"amarelo": {"mandante": [], "visitante": []}, "vermelho": {"mandante": [], "visitante": []}}
    subs = {"mandante": [], "visitante": []}
    cobr = []
    for k in s.get("keyEvents", []):
        kind = _kind((k.get("type") or {}).get("text"))
        parts = [p.get("athlete", {}) for p in k.get("participants", [])]
        ath = lambda a: {"atleta_id": OFFSET + int(a["id"]), "nome_popular": a.get("displayName", "")} if a.get("id") else None
        per = (k.get("period") or {}).get("number") or 1
        base = {"minuto_label": _clock_label((k.get("clock") or {}).get("displayValue")), "ordem_seg": (k.get("clock") or {}).get("value") or 0,
                "periodo": PERIOD_NAME.get(per, ""), "periodo_slug": PERIOD_SLUG.get(per, "segundo-tempo")}
        tid = (k.get("team") or {}).get("id")
        if k.get("shootout"):
            if kind in ("gol", None) and parts:
                cobr.append({"atleta": ath(parts[0]), "time": {"time_id": OFFSET + int(tid)} if tid else None,
                             "status": "converteu" if k.get("scoringPlay") else "perdeu"})
            continue
        if not kind or not tid:
            continue
        side = side_of_team(tid)
        if kind in ("gol", "gol_contra"):
            if kind == "gol_contra" and parts and parts[0].get("id") in player_side:
                side = "visitante" if player_side[parts[0]["id"]] == "mandante" else "mandante"
            gols[side].append({**base, "atleta": ath(parts[0]) if parts else None,
                               "penalti": "penalty" in k["type"]["text"].lower(), "gol_contra": kind == "gol_contra"})
        elif kind in ("amarelo", "vermelho"):
            cart[kind][side].append({**base, "atleta": ath(parts[0]) if parts else None})
        elif kind == "sub" and len(parts) >= 2:
            subs[side].append({**base, "entrou": ath(parts[0]), "saiu": ath(parts[1])})
    m["gols"], m["cartoes"], m["substituicoes"] = gols, cart, subs
    if cobr and m["disputa_penalti"]:
        m["disputa_penalti"]["cobrancas"] = cobr
    return m


# ---------------------------------------------------------------- ponte para jogos de outras fontes
# A football-data (ligas europeias) não traz minuto, escalações nem lances no plano gratuito. A ESPN traz:
# acha o mesmo jogo lá (data/hora + nomes dos times) e completa a partida.
BRIDGE = {"CL": "uefa.champions", "PL": "eng.1", "PD": "esp.1", "SA": "ita.1", "BL1": "ger.1", "FL1": "fra.1",
          "PPL": "por.1", "DED": "ned.1"}
_STOPW = {"fc", "cf", "afc", "ac", "sc", "sv", "as", "ss", "ssc", "pae", "rc", "rcd", "ud", "cd", "ca", "sl", "fk", "bk", "if",
          "club", "de", "del", "la", "le", "1", "04", "05", "1899", "1909", "1846", "calcio", "vfb", "vfl", "tsg", "bsc", "ogc", "losc", "us", "aj"}


def _toks(name):
    return {t for t in _slug(name).split("-") if t and t not in _STOPW}


def _sim(a, b):
    ta, tb = _toks(a), _toks(b)
    if not ta or not tb:
        return 0.0
    exact = len(ta & tb)
    pref = sum(1 for x in ta for y in tb if x != y and len(x) >= 4 and len(y) >= 4 and (x.startswith(y) or y.startswith(x)))
    return exact + 0.6 * pref


def find_event(code: str, iso: str | None, home: str, away: str, ttl: float = 20):
    slug = BRIDGE.get(code)
    if not slug or not iso:
        return None
    dt = datetime.strptime(iso, "%Y-%m-%dT%H:%M:%S%z")
    best, score = None, 0.0
    try:
        sb = _get(f"{SITE}/{slug}/scoreboard?dates={dt.astimezone(timezone.utc):%Y%m%d}", ttl)
    except Exception:  # noqa: BLE001
        return None
    for e in sb.get("events", []):
        comp = e["competitions"][0]
        edt = _parse_dt(comp.get("date") or e.get("date"))
        if edt and abs((edt - dt).total_seconds()) > 3 * 3600:
            continue
        sides = {c.get("homeAway"): c["team"] for c in comp["competitors"]}
        names = lambda t: [t.get("displayName", ""), t.get("shortDisplayName", ""), t.get("name", ""), t.get("location", "")]  # noqa: E731
        sh = max(_sim(home, n) for n in names(sides.get("home", {})))
        sa = max(_sim(away, n) for n in names(sides.get("away", {})))
        sc = sh + sa + (1 if sh and sa else 0)
        if sc > score:
            best, score = e, sc
    return best if score >= 1 else None


def bridge(m: dict, code: str, detail: bool = True, ttl: float = 20) -> dict:
    """Completa uma partida de outra fonte com o minuto, o placar ao vivo e (detail) escalações e lances da ESPN."""
    try:
        e = find_event(code, m.get("data_realizacao_iso"), m["time_mandante"]["nome_popular"], m["time_visitante"]["nome_popular"], ttl)
        if not e:
            return m
        comp = e["competitions"][0]
        st = comp.get("status") or e.get("status") or {}
        status, periodo = _status(st)
        if status in ("andamento", "finalizado") and m.get("status") in ("agendado", "andamento"):
            sides = {c.get("homeAway"): c for c in comp["competitors"]}
            m["status"], m["periodo"] = status, periodo
            m["placar_mandante"] = _int(sides["home"].get("score"), m.get("placar_mandante") or 0)
            m["placar_visitante"] = _int(sides["away"].get("score"), m.get("placar_visitante") or 0)
            m["placar"] = f"{m['time_mandante']['nome_popular']} {m['placar_mandante']}x{m['placar_visitante']} {m['time_visitante']['nome_popular']}"
            if status == "andamento":
                disp = st.get("displayClock", "")
                mm = re.match(r"\d+", disp or "")
                m["cronometro"] = int(mm.group()) if mm else None
                m["cronometro_label"] = "Intervalo" if periodo == "intervalo" else (_clock_label(disp) or "Ao vivo")
        m["espn_evento"] = str(e["id"])
        if detail:
            s = _get(f"{SITE_WEB}/{BRIDGE[code]}/summary?event={e['id']}", 15)
            _fill_details(m, s)
            if m.get("escalacoes") or m.get("estatisticas") or any((m.get("gols") or {}).values()):
                m["fonte"] = "football-data+espn"
    except Exception:  # noqa: BLE001 — sem a ponte, a partida segue com o que a fonte original tem
        pass
    return m


# ---------------------------------------------------------------- times / atletas
def _team_league(tid_espn: str) -> int:
    best = None
    warm()
    for lid in LEAGUE_ORDER:
        try:
            for e in _events(lid):
                if tid_espn in _team_ids(e):
                    if LEAGUES[lid]["league"]:
                        return lid
                    best = best or lid
                    break
        except Exception:
            continue
    if best is None:
        raise NotFound("time")
    return best


def time_info(tid: int) -> dict:
    t_espn = str(tid - OFFSET)
    lid = _team_league(t_espn)
    d = _get(f"{SITE}/{LEAGUES[lid]['slug']}/teams/{t_espn}", 3600)["team"]
    out = team(d)
    out["nome"] = d.get("displayName")
    out["apelido"] = None
    out["estadio"] = (d.get("venue") or {}).get("fullName")
    out["resumo"] = d.get("standingSummary")
    return out


def time_campeonatos(tid: int) -> dict:
    t_espn = str(tid - OFFSET)
    info = None
    camps = []
    warm()
    for lid in LEAGUE_ORDER:
        try:
            evs = _events(lid)
        except Exception:
            continue
        mine = [e for e in evs if t_espn in _team_ids(e)]
        if not mine:
            continue
        if info is None:
            c = next(c for c in mine[0]["competitions"][0]["competitors"] if c["team"]["id"] == t_espn)
            info = team(c["team"])
        done = all((e.get("status") or {}).get("type", {}).get("completed") for e in mine)
        camps.append({"campeonato_id": str(lid), "nome": LEAGUES[lid]["nome"], "edicao": str(_year()),
                      "status": "finalizado" if done else "andamento"})
    if info is None:
        raise NotFound("time")
    return {"time": info, "campeonatos": camps}


def elenco(tid: int) -> list[dict]:
    t_espn = str(tid - OFFSET)
    lid = _team_league(t_espn)
    d = _get(f"{SITE}/{LEAGUES[lid]['slug']}/teams/{t_espn}/roster", 3600)
    out = []
    for a in d.get("athletes", []):
        p = a.get("position") or {}
        ab = p.get("abbreviation") or ""
        nome = POS_PT.get(p.get("name") or "", p.get("displayName") or p.get("name") or "")
        out.append({"atleta": {"atleta_id": OFFSET + int(a["id"]), "nome_popular": a.get("displayName"), "nome": a.get("fullName")},
                    "camisa": a.get("jersey") or "", "posicao": {"nome": nome, "sigla": {"G": "GOL", "D": "DEF", "M": "MEI", "F": "ATA"}.get(ab, ab)},
                    "idade": a.get("age"), "nacionalidade": _country(a.get("citizenship")), "bandeira": (a.get("flag") or {}).get("href")})
    return out


def atleta(aid: int) -> dict:
    a_espn = aid - OFFSET
    d = _get(f"https://site.web.api.espn.com/apis/common/v3/sports/soccer/athletes/{a_espn}", 3600)
    a = d.get("athlete") or d
    p = a.get("position") or {}
    t = a.get("team")
    return {"atleta_id": aid, "nome_popular": a.get("displayName"), "nome": a.get("fullName"),
            "posicao": {"nome": POS_PT.get(p.get("name") or "", p.get("displayName") or ""),
                        "sigla": {"G": "GOL", "D": "DEF", "M": "MEI", "F": "ATA"}.get(p.get("abbreviation"), p.get("abbreviation"))},
            "camisa": a.get("jersey"), "idade": a.get("age"), "nacionalidade": _country(a.get("citizenship")),
            "bandeira": (a.get("flag") or {}).get("href"), "foto": (a.get("headshot") or {}).get("href"),
            "altura": _height(a), "time": team(t) if isinstance(t, dict) and t.get("id") else None}


# ---------------------------------------------------------------- endpoints da documentação da API Futebol
def fases_lista(lid) -> list[dict]:
    """GET /campeonatos/{id}/fases — todas as fases da edição atual, com anterior/próxima."""
    c = campeonato(lid, detail=True)
    ph = c.get("fases") or []
    ed = c["edicao_atual"]
    out = []
    for i, p in enumerate(ph):
        ref = lambda q: {k: q[k] for k in ("fase_id", "nome", "slug", "tipo", "_link")} if q else None
        out.append({**ref(p), "edicao": ed, "status": p.get("status"), "decisivo": i == len(ph) - 1 and p["tipo"] == "mata-mata",
                    "eliminatorio": p["tipo"] == "mata-mata", "ida_e_volta": None, "grupos": [], "chaves": [], "rodadas": [],
                    "proxima_fase": ref(ph[i + 1]) if i + 1 < len(ph) else None, "fase_anterior": ref(ph[i - 1]) if i > 0 else None})
    return out


def partidas_campeonato(lid) -> dict:
    """GET /campeonatos/{id}/partidas — todas as partidas, agrupadas por fase e rodada."""
    matches, rmap = _all_matches(lid)
    out: dict[str, dict[str, list]] = {}
    if LEAGUES[lid]["league"]:
        for m in matches:
            n = m.get("rodada_numero")
            out.setdefault("fase-unica", {}).setdefault(f"rodada-{n}", []).append(m)
    else:
        ph = phases(lid)
        for m in matches:
            p = _phase_of_match(ph, m)
            out.setdefault(_slug(p["nome"]) if p else "outras", {}).setdefault("jogos", []).append(m)
    return {"campeonato": _camp_ref(lid), "partidas": out}


def _team_matches(tid: int):
    t_espn = str(tid - OFFSET)
    found = []
    warm()
    for lid in LEAGUE_ORDER:
        try:
            evs = _events(lid)
        except Exception:
            continue
        if any(t_espn in _team_ids(e) for e in evs):
            ms, _ = _all_matches(lid)
            found += [m for m in ms if tid in (m["time_mandante"]["time_id"], m["time_visitante"]["time_id"])]
    return found


def team_name(tid: int) -> str | None:
    """Nome de um time da ESPN pelo ID (usado para casar com notícias da API Futebol)."""
    t_espn = str(tid - OFFSET)
    for lid in LEAGUE_ORDER:
        try:
            for e in _events(lid):
                for c in e["competitions"][0]["competitors"]:
                    if c["team"]["id"] == t_espn:
                        return team(c["team"])["nome_popular"]
        except Exception:
            continue
    return None


def time_partidas(tid: int, kind: str):
    """GET /times/{id}/partidas/proximas | anteriores (agrupadas pelo slug do campeonato) | ao-vivo (lista)."""
    ms = _team_matches(tid)
    if kind == "ao-vivo":
        return [m for m in ao_vivo() if tid in (m["time_mandante"]["time_id"], m["time_visitante"]["time_id"])]
    if kind == "proximas":
        sel = sorted((m for m in ms if m["status"] in ("agendado", "adiado", "andamento")), key=lambda m: m["data_realizacao_iso"] or "9")
    else:
        sel = sorted((m for m in ms if m["status"] == "finalizado"), key=lambda m: m["data_realizacao_iso"] or "", reverse=True)
    out: dict[str, list] = {}
    for m in sel:
        out.setdefault(m["campeonato"]["slug"], []).append(m)
    return out


def noticias(q: dict) -> dict:
    """GET /noticias — notícias em português da ESPN Brasil, no formato da API Futebol."""
    lid = _int(q.get("campeonato_id"), 10)
    lid = lid if lid in LEAGUES else 10
    per = max(1, min(_int(q.get("por_pagina"), 30), 50))
    page = max(1, _int(q.get("pagina"), 1))
    params = f"lang=pt&region=br&limit={per * page}"
    tid = _int(str(q.get("time_id") or "").split(",")[0])
    if tid and tid >= OFFSET:
        params += f"&team={tid - OFFSET}"
    data = _get(f"{SITE}/{LEAGUES[lid]['slug']}/news?{params}", 600)
    known = {}
    for l in CORE:  # escudos/nomes dos times citados
        try:
            for e in _events(l):
                for c in e["competitions"][0]["competitors"]:
                    known.setdefault(c["team"]["id"], c["team"])
        except Exception:
            continue
    items = []
    for a in data.get("articles", []):
        if not a.get("headline"):
            continue
        link = ((a.get("links") or {}).get("web") or {}).get("href")
        pub = _parse_dt(a.get("published"))
        team_ids = [str(c.get("teamId")) for c in a.get("categories", []) if c.get("type") == "team"]
        times = [team(known[t]) for t in dict.fromkeys(team_ids) if t in known]
        items.append({
            "noticia_id": OFFSET + _int(a.get("id"), 0),
            "titulo": a["headline"], "resumo": a.get("description") or None,
            "imagem": ((a.get("images") or [{}])[0]).get("url"),
            "link": link, "publicado_em": pub.astimezone(BRT).strftime("%Y-%m-%dT%H:%M:%S%z") if pub else None,
            "provedor": {"slug": "espn", "nome": "ESPN Brasil", "logo": None},
            "relevancia": None,
            "classificacao": {"tipo": "ao_vivo" if a.get("type") == "Media" else "noticia", "assuntos": [], "competicoes": []},
            "times": times,
        })
    total = len(items)
    page_items = items[(page - 1) * per: page * per]
    return {"noticias": page_items, "paginacao": {"pagina": page, "por_pagina": per, "total": total, "total_paginas": max(1, -(-total // per))}}


# ---------------------------------------------------------------- roteamento
ROUTES = [
    (re.compile(r"^/campeonatos/(\d+)/fases$"), lambda m, q: fases_lista(_lid(m))),
    (re.compile(r"^/campeonatos/(\d+)/partidas$"), lambda m, q: partidas_campeonato(_lid(m))),
    (re.compile(r"^/times/(\d+)/partidas/(proximas|anteriores|ao-vivo)$"), lambda m, q: time_partidas(int(m.group(1)), m.group(2))),
    (re.compile(r"^/noticias$"), lambda m, q: noticias(q)),
    (re.compile(r"^/campeonatos$"), lambda m, q: campeonatos()),
    (re.compile(r"^/campeonatos/(\d+)$"), lambda m, q: campeonato(_lid(m), detail=True)),
    (re.compile(r"^/campeonatos/(\d+)/tabela$"), lambda m, q: tabela(_lid(m))),
    (re.compile(r"^/campeonatos/(\d+)/rodadas$"), lambda m, q: rodadas(_lid(m))),
    (re.compile(r"^/campeonatos/(\d+)/rodadas/(\d+)$"), lambda m, q: rodada(_lid(m), int(m.group(2)))),
    (re.compile(r"^/campeonatos/(\d+)/fases/(\d+)$"), lambda m, q: fase(_lid(m), int(m.group(2)))),
    (re.compile(r"^/campeonatos/(\d+)/artilharia$"), lambda m, q: artilharia(_lid(m))),
    (re.compile(r"^/campeonatos/(\d+)/assistencias$"), lambda m, q: assistencias(_lid(m))),
    (re.compile(r"^/ao-vivo$"), lambda m, q: ao_vivo()),
    (re.compile(r"^/partidas/(\d+)$"), lambda m, q: partida(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)$"), lambda m, q: time_info(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)/campeonatos$"), lambda m, q: time_campeonatos(int(m.group(1)))),
    (re.compile(r"^/times/(\d+)/elenco$"), lambda m, q: elenco(int(m.group(1)))),
    (re.compile(r"^/atletas/(\d+)$"), lambda m, q: atleta(int(m.group(1)))),
]


def _lid(m):
    lid = int(m.group(1))
    if lid not in LEAGUES:
        raise NotFound("campeonato")
    return lid


def handle(path: str, query: dict | None = None) -> tuple[int, bytes]:
    for rx, fn in ROUTES:
        m = rx.match(path)
        if not m:
            continue
        try:
            return 200, json.dumps(fn(m, query or {}), ensure_ascii=False).encode()
        except NotFound:
            return 404, b'{"message":"N\\u00e3o encontrado"}'
        except Exception as e:  # noqa: BLE001 — erro da fonte não pode derrubar o servidor
            return 502, json.dumps({"message": f"Falha ao obter dados da ESPN: {e}"}).encode()
    return 404, b'{"message":"Rota n\\u00e3o suportada"}'
