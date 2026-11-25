"""Fórmula 1: calendário, resultados e classificação (Jolpica/Ergast), sessão ao vivo (ESPN), pilotos e equipes."""

import threading
import time
import urllib.error
from datetime import datetime, timedelta, timezone

from . import openf1
from .common import BRT, F1_ESPN, JOLPICA, NotFound, _cache, _dt, _get, _int, _iso, _lock


# ================================================================ Fórmula 1
TEAM_COLORS = {"mercedes": "#27F4D2", "red_bull": "#3671C6", "ferrari": "#E8002D", "mclaren": "#FF8000", "aston_martin": "#229971",
               "alpine": "#FF87BC", "williams": "#64C4FF", "rb": "#6692FF", "racing_bulls": "#6692FF", "sauber": "#52E252", "audi": "#00E701",
               "haas": "#B6BABD", "cadillac": "#C9B37E"}
NAT = {"Dutch": "nl", "British": "gb", "Monegasque": "mc", "Spanish": "es", "Mexican": "mx", "Australian": "au", "German": "de", "French": "fr",
       "Finnish": "fi", "Canadian": "ca", "Japanese": "jp", "Thai": "th", "Chinese": "cn", "Danish": "dk", "American": "us", "Italian": "it",
       "New Zealander": "nz", "Brazilian": "br", "Argentine": "ar", "Argentinian": "ar", "Swiss": "ch", "Austrian": "at", "Belgian": "be", "Polish": "pl",
       "Swedish": "se", "Russian": "ru", "Estonian": "ee", "Indian": "in", "Indonesian": "id", "Irish": "ie", "Colombian": "co", "Venezuelan": "ve"}
GP_PT = {"Australian": "Austrália", "Chinese": "China", "Japanese": "Japão", "Bahrain": "Bahrein", "Saudi Arabian": "Arábia Saudita", "Miami": "Miami",
         "Emilia Romagna": "Emília-Romanha", "Monaco": "Mônaco", "Spanish": "Espanha", "Barcelona-Catalunya": "Barcelona", "Canadian": "Canadá",
         "Austrian": "Áustria", "British": "Grã-Bretanha", "Belgian": "Bélgica", "Hungarian": "Hungria", "Dutch": "Holanda", "Italian": "Itália",
         "Azerbaijan": "Azerbaijão", "Singapore": "Singapura", "United States": "Estados Unidos", "Mexico City": "Cidade do México",
         "São Paulo": "São Paulo", "Brazilian": "Brasil", "Las Vegas": "Las Vegas", "Qatar": "Catar", "Abu Dhabi": "Abu Dhabi", "Madrid": "Madri"}
SESSIONS = [("FirstPractice", "Treino livre 1"), ("SecondPractice", "Treino livre 2"), ("ThirdPractice", "Treino livre 3"),
            ("SprintQualifying", "Classificação sprint"), ("SprintShootout", "Classificação sprint"), ("Sprint", "Corrida sprint"), ("Qualifying", "Classificação")]
STATUS_PT = {"Finished": "Completou", "Lapped": "Retardatário", "Retired": "Abandonou", "Disqualified": "Desclassificado", "Did not start": "Não largou",
             "Accident": "Acidente", "Collision": "Colisão", "Engine": "Motor", "Gearbox": "Câmbio", "Hydraulics": "Hidráulica", "Power Unit": "Unidade de potência"}


def _gp(race_name: str) -> str:
    base = race_name.replace(" Grand Prix", "")
    pt = GP_PT.get(base, base)
    fem = pt in ("Áustria", "Bélgica", "Hungria", "Holanda", "Itália", "China", "Espanha", "Arábia Saudita", "Grã-Bretanha", "Austrália", "Emília-Romanha", "Cidade do México")
    plain = pt in ("Miami", "Mônaco", "Singapura", "Las Vegas", "Abu Dhabi", "São Paulo", "Barcelona", "Madri", "Bahrein", "Catar")
    return f"GP {'de' if plain else 'da' if fem else 'do'} {pt}"


def _driver(d: dict, team: dict | None = None) -> dict:
    nat = NAT.get(d.get("nationality"))
    return {"id": d.get("driverId"), "nome": f"{d.get('givenName', '')} {d.get('familyName', '')}".strip(), "sobrenome": d.get("familyName"),
            "sigla": d.get("code") or (d.get("familyName") or "")[:3].upper(), "numero": d.get("permanentNumber"),
            "bandeira": f"https://flagcdn.com/w40/{nat}.png" if nat else None, "pais": nat, "brasileiro": nat == "br",
            "equipe": _team(team) if team else None}


def _team(c: dict) -> dict:
    return {"id": c.get("constructorId"), "nome": c.get("name"), "cor": TEAM_COLORS.get(c.get("constructorId"), "#888888")}


def _race_dt(r: dict, key: str | None = None):
    x = r.get(key) if key else r
    if not x or not x.get("date"):
        return None
    return _dt(f"{x['date']}T{x.get('time') or '12:00:00Z'}")


def _schedule():
    return _jget(f"current.json", 6 * 3600)["MRData"]["RaceTable"]["Races"]


def _race_out(r: dict, winners: dict, now: datetime) -> dict:
    rd = _race_dt(r)
    sessions = [{"nome": pt, "data_iso": _iso(_race_dt(r, k))} for k, pt in SESSIONS if r.get(k)]
    sessions.append({"nome": "Corrida", "data_iso": _iso(rd)})
    sessions.sort(key=lambda x: x["data_iso"] or "")
    loc = (r.get("Circuit") or {}).get("Location") or {}
    return {"rodada": _int(r["round"]), "nome": _gp(r["raceName"]), "nome_original": r["raceName"], "circuito": (r.get("Circuit") or {}).get("circuitName"),
            "cidade": loc.get("locality"), "pais": loc.get("country"), "data_iso": _iso(rd),
            "status": "finalizada" if rd and now > rd + timedelta(hours=3) else ("andamento" if rd and rd <= now else "agendada"),
            "sprint": bool(r.get("Sprint")), "sessoes": sessions, "vencedor": winners.get(r["round"])}


def _espn_weekend():
    """Sessões do fim de semana atual na ESPN: estado ao vivo e ordem de cada sessão."""
    try:
        data = _get(F1_ESPN, 30)
    except Exception:  # noqa: BLE001
        return None
    ev = (data.get("events") or [None])[0]
    if not ev:
        return None
    TYPE = {"FP1": "Treino livre 1", "FP2": "Treino livre 2", "FP3": "Treino livre 3", "Qual": "Classificação", "Race": "Corrida",
            "SS": "Classificação sprint", "SQ": "Classificação sprint", "Sprint": "Corrida sprint", "SR": "Corrida sprint"}
    out = []
    live = False
    for c in ev.get("competitions") or []:
        st = (c.get("status") or {}).get("type") or {}
        ab = (c.get("type") or {}).get("abbreviation") or ""
        order = sorted(c.get("competitors") or [], key=lambda x: x.get("order") or 99)
        state = st.get("state")
        live = live or state == "in"
        out.append({"nome": TYPE.get(ab, ab), "estado": {"pre": "agendada", "in": "andamento", "post": "finalizada"}.get(state, state),
                    "data_iso": _iso(_dt(c.get("date"))), "volta": (c.get("status") or {}).get("period") if state == "in" else None,
                    "ordem": [{"pos": x.get("order"), "nome": (x.get("athlete") or {}).get("displayName"),
                               "bandeira": ((x.get("athlete") or {}).get("flag") or {}).get("href")} for x in order[:22]] if state != "pre" else []})
    if live:
        with _lock:  # sessão rolando: ordem atualizada a cada 15 s
            _cache[F1_ESPN] = (time.time() + 15, data)
    return {"nome": _gp(ev.get("name") or ""), "sessoes": out, "ao_vivo": next((s for s in out if s["estado"] == "andamento"), None)}


def f1_overview() -> dict:
    now = datetime.now(timezone.utc)
    races = _schedule()
    winners = {}
    try:
        for r in _jget(f"current/results/1.json?limit=100", 1800)["MRData"]["RaceTable"]["Races"]:
            w = r["Results"][0]
            winners[r["round"]] = _driver(w["Driver"], w.get("Constructor"))
    except Exception:  # noqa: BLE001
        pass
    cal = [_race_out(r, winners, now) for r in races]
    nxt = next((r for r in cal if r["status"] != "finalizada"), None)
    drivers, teams = [], []
    try:
        lst = _jget(f"current/driverStandings.json", 1800)["MRData"]["StandingsTable"]["StandingsLists"]
        for d in (lst[0]["DriverStandings"] if lst else []):
            drivers.append({"posicao": _int(d.get("position") or d.get("positionText")), "pontos": float(d["points"]), "vitorias": _int(d.get("wins"), 0),
                            "piloto": _driver(d["Driver"], (d.get("Constructors") or [None])[-1])})
        lst = _jget(f"current/constructorStandings.json", 1800)["MRData"]["StandingsTable"]["StandingsLists"]
        for c in (lst[0]["ConstructorStandings"] if lst else []):
            teams.append({"posicao": _int(c.get("position") or c.get("positionText")), "pontos": float(c["points"]), "vitorias": _int(c.get("wins"), 0),
                          "equipe": _team(c["Constructor"])})
    except Exception:  # noqa: BLE001
        pass
    _add_headshots([d["piloto"] for d in drivers], now.year)
    done = sum(1 for r in cal if r["status"] == "finalizada")
    left = len(cal) - done
    # matemática do título: quantos pontos ainda há em jogo (25 + sprint 8 por etapa)
    remaining = sum(25 + (8 if r["sprint"] else 0) for r in cal if r["status"] != "finalizada")
    if len(drivers) >= 2:
        gap = drivers[0]["pontos"] - drivers[1]["pontos"]
        title = {"lider": drivers[0]["piloto"]["nome"], "vantagem": gap, "pontos_em_jogo": remaining,
                 "decidido": gap > remaining, "pode_decidir_no_proximo": nxt is not None and gap > remaining - (25 + (8 if nxt["sprint"] else 0))}
    else:
        title = None
    return {"temporada": _int(races[0]["season"]) if races else now.year, "etapas": len(cal), "disputadas": done, "restantes": left,
            "proxima": nxt, "fim_de_semana": _espn_weekend(), "calendario": cal, "pilotos": drivers, "construtores": teams, "titulo": title}


def _fold(s: str | None) -> str:
    import unicodedata
    return " ".join(unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower().replace("-", " ").split())


def identify(order: list) -> list:
    """Liga a ordem de uma sessão da ESPN (só o nome) aos pilotos da Jolpica: id, sigla e equipe de cada um.
    Serve para avisar quem segue um piloto ou uma equipe."""
    try:
        drivers = [d["piloto"] for d in f1_overview().get("pilotos") or []]
    except Exception:  # noqa: BLE001
        drivers = []
    full = {_fold(p["nome"]): p for p in drivers}
    last = {}
    for p in drivers:
        last.setdefault(_fold(p["sobrenome"]), []).append(p)
    out = []
    for x in order:
        n = _fold(x.get("nome"))
        p = full.get(n) or next((v[0] for k, v in last.items() if len(v) == 1 and (n.endswith(" " + k) or n == k)), None)
        out.append({"pos": x.get("pos"), "nome": x.get("nome"), "id": p and p["id"], "sigla": p and p["sigla"],
                    "equipe": p and (p.get("equipe") or {}).get("id")})
    return out


def f1_live():
    w = _espn_weekend()
    return w["ao_vivo"] if w else None


def f1_race(rnd: int) -> dict:
    races = _schedule()
    r = next((x for x in races if _int(x["round"]) == rnd), None)
    if not r:
        raise NotFound("etapa")
    out = _race_out(r, {}, datetime.now(timezone.utc))

    def results(kind):
        try:
            rr = _jget(f"current/{rnd}/{kind}.json?limit=40", 1800)["MRData"]["RaceTable"]["Races"]
        except Exception:  # noqa: BLE001
            return []
        return rr[0].get({"results": "Results", "qualifying": "QualifyingResults", "sprint": "SprintResults"}[kind]) or [] if rr else []

    race = results("results")
    out["resultado"] = [{"posicao": _int(x.get("position")), "piloto": _driver(x["Driver"], x.get("Constructor")), "largada": _int(x.get("grid")),
                         "voltas": _int(x.get("laps")), "tempo": (x.get("Time") or {}).get("time") or STATUS_PT.get(x.get("status"), x.get("status")),
                         "pontos": float(x.get("points") or 0), "volta_rapida": (x.get("FastestLap") or {}).get("rank") == "1",
                         "melhor_volta": ((x.get("FastestLap") or {}).get("Time") or {}).get("time")} for x in race]
    out["classificacao"] = [{"posicao": _int(x.get("position")), "piloto": _driver(x["Driver"], x.get("Constructor")),
                             "q1": x.get("Q1"), "q2": x.get("Q2"), "q3": x.get("Q3")} for x in results("qualifying")]
    if out["sprint"]:
        out["sprint_resultado"] = [{"posicao": _int(x.get("position")), "piloto": _driver(x["Driver"], x.get("Constructor")),
                                    "tempo": (x.get("Time") or {}).get("time") or STATUS_PT.get(x.get("status"), x.get("status")),
                                    "pontos": float(x.get("points") or 0)} for x in results("sprint")]
    try:  # quem já venceu neste circuito
        from .f1_season import circuit_history
        out["historico"] = circuit_history(rnd)
    except Exception:  # noqa: BLE001
        pass
    return out


def _add_headshots(pilots: list, year: int):
    """Foto oficial da F1 (OpenF1) pela sigla do piloto; sem conexão com a OpenF1, segue sem foto."""
    try:
        shots = openf1.headshots(year)
    except Exception:  # noqa: BLE001
        return
    for p in pilots:
        h = shots.get(p.get("sigla"))
        if h and h.get("foto"):
            p["foto_oficial"] = h["foto"]


def f1_race_analysis(rnd: int) -> dict:
    """Análise da corrida (OpenF1): estratégia de pneus, pit stops, posição volta a volta, direção de prova, clima e rádio."""
    r = next((x for x in _schedule() if _int(x["round"]) == rnd), None)
    if not r:
        raise NotFound("etapa")
    out = openf1.race_analysis(_race_dt(r), _int(r["season"]))
    # liga os pilotos da OpenF1 (número) aos da Jolpica (id da página do piloto)
    try:
        rr = _jget(f"current/{rnd}/results.json?limit=40", 1800)["MRData"]["RaceTable"]["Races"]
        by_code = {x["Driver"].get("code"): x["Driver"]["driverId"] for x in (rr[0]["Results"] if rr else [])}
        by_num = {_int(x["Driver"].get("permanentNumber")): x["Driver"]["driverId"] for x in (rr[0]["Results"] if rr else [])}
        for d in out["pilotos"]:
            d["id"] = by_code.get(d["sigla"]) or by_num.get(d["numero"])
    except Exception:  # noqa: BLE001
        pass
    return out


# ---------------------------------------------------------------- piloto e equipe
# Títulos mundiais (a Jolpica não informa por piloto): grid atual, até 2025. O título da temporada em curso
# é somado quando a matemática já decidiu (ver f1_overview).
DRIVER_TITLES = {"hamilton": 7, "max_verstappen": 4, "alonso": 2, "norris": 1}
TEAM_TITLES = {"ferrari": 16, "mclaren": 10, "williams": 9, "mercedes": 8, "red_bull": 6}
_jolt = threading.Lock()
_jlast = [0.0]
_jpause = [0.0]


def _jget(path: str, ttl: float):
    """Jolpica tem limite (4/s, 500/h): espaça as chamadas que não estão em cache. Toda chamada à Jolpica passa
    por aqui (o servidor aquece várias telas da F1 ao mesmo tempo; chamadas diretas estouravam o limite por segundo)."""
    url = f"{JOLPICA}/{path}"
    with _lock:
        hit = _cache.get(url)
    if hit and hit[0] > time.time():
        return hit[1]
    if time.time() < _jpause[0]:  # a Jolpica pediu para esperar (429): nem tenta; usa a última cópia se houver
        if hit:
            return hit[1]
        raise TimeoutError("Jolpica: limite de pedidos, tente em instantes")
    with _jolt:
        wait = 0.35 - (time.time() - _jlast[0])
        if wait > 0:
            time.sleep(wait)
        _jlast[0] = time.time()
    try:
        return _get(url, ttl)
    except urllib.error.HTTPError as e:
        if e.code == 429:  # passou do limite por hora: pausa 2 min em vez de insistir (cada tentativa conta)
            _jpause[0] = time.time() + 120
        raise


def _total(path: str) -> int:
    try:
        return _int(_jget(path, 86400)["MRData"]["total"], 0)
    except Exception:  # noqa: BLE001
        return 0


def _wiki(url: str | None) -> dict:
    """Foto e resumo da Wikipédia (resumo em português quando existe a página em pt)."""
    if not url or "wikipedia.org/wiki/" not in url:
        return {}
    title = url.rsplit("/wiki/", 1)[1]
    out = {}
    for lang in ("pt", "en"):
        try:
            w = _get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{title}", 7 * 86400)
        except Exception:  # noqa: BLE001
            continue
        if w.get("type") == "disambiguation":
            continue
        out.setdefault("foto", (w.get("originalimage") or w.get("thumbnail") or {}).get("source"))
        if lang == "pt" and w.get("extract"):
            out["resumo"] = w["extract"]
        if out.get("foto"):
            break
    return out


def _sprint_points(path: str, per_driver: bool = False) -> dict:
    """{rodada: pontos} (ou {rodada: {piloto: pontos}}) das corridas sprint."""
    try:
        races = _jget(path, 1800)["MRData"]["RaceTable"]["Races"]
    except Exception:  # noqa: BLE001
        return {}
    out = {}
    for r in races:
        res = r.get("SprintResults") or []
        if per_driver:
            out[r["round"]] = {x["Driver"]["driverId"]: float(x.get("points") or 0) for x in res}
        else:
            out[r["round"]] = sum(float(x.get("points") or 0) for x in res)
    return out


def _season_champion():
    try:
        o = f1_overview()
        t = o.get("titulo") or {}
        if t.get("decidido") and o.get("pilotos") and o.get("construtores"):
            return o["pilotos"][0]["piloto"]["id"], o["construtores"][0]["equipe"]["id"]
    except Exception:  # noqa: BLE001
        pass
    return None, None


def f1_driver(did: str) -> dict:
    info = (_jget(f"drivers/{did}.json", 7 * 86400)["MRData"]["DriverTable"]["Drivers"] or [None])[0]
    if not info:
        raise NotFound("piloto")
    races = _jget(f"current/drivers/{did}/results.json?limit=40", 1800)["MRData"]["RaceTable"]["Races"]
    team = races[-1]["Results"][0].get("Constructor") if races else None
    out = _driver(info, team)
    dob = info.get("dateOfBirth")
    if dob:
        b = datetime.fromisoformat(dob)
        today = datetime.now(BRT)
        out["idade"] = today.year - b.year - ((today.month, today.day) < (b.month, b.day))
        out["nascimento"] = b.strftime("%d/%m/%Y")
    out.update(_wiki(info.get("url")))
    _add_headshots([out], datetime.now(timezone.utc).year)
    champ, _ = _season_champion()
    wins, p2, p3 = _total(f"drivers/{did}/results/1.json?limit=1"), _total(f"drivers/{did}/results/2.json?limit=1"), _total(f"drivers/{did}/results/3.json?limit=1")
    out["carreira"] = {"corridas": _total(f"drivers/{did}/results.json?limit=1"), "vitorias": wins, "podios": wins + p2 + p3,
                       "poles": _total(f"drivers/{did}/qualifying/1.json?limit=1"), "titulos": DRIVER_TITLES.get(did, 0) + (1 if champ == did else 0)}
    # temporada: resultado de cada etapa e pontos acumulados (corrida + sprint)
    sprint = _sprint_points(f"current/drivers/{did}/sprint.json?limit=40")
    acc, rows = 0.0, []
    for r in races:
        x = r["Results"][0]
        sp = sprint.get(r["round"], 0.0)
        acc += float(x.get("points") or 0) + sp
        rows.append({"rodada": _int(r["round"]), "gp": _gp(r["raceName"]), "largada": _int(x.get("grid")), "posicao": _int(x.get("position")),
                     "classificado": (x.get("positionText") or "").isdigit(), "status": STATUS_PT.get(x.get("status"), x.get("status")),
                     "pontos": float(x.get("points") or 0), "sprint": sp, "acumulado": acc, "volta_rapida": (x.get("FastestLap") or {}).get("rank") == "1"})
    out["temporada"] = rows
    try:
        lst = _jget(f"current/driverStandings.json", 1800)["MRData"]["StandingsTable"]["StandingsLists"]
        me = next((d for d in lst[0]["DriverStandings"] if d["Driver"]["driverId"] == did), None) if lst else None
        if me:
            out["campeonato"] = {"posicao": _int(me.get("position")), "pontos": float(me["points"]), "vitorias": _int(me.get("wins"), 0)}
    except Exception:  # noqa: BLE001
        pass
    # duelo com o companheiro com quem mais correu na temporada (f1_season.py)
    try:
        from .f1_season import teammate_duel
        out["companheiro"] = teammate_duel(did)
    except Exception:  # noqa: BLE001
        pass
    return out


def f1_team(cid: str) -> dict:
    info = (_jget(f"constructors/{cid}.json", 7 * 86400)["MRData"]["ConstructorTable"]["Constructors"] or [None])[0]
    if not info:
        raise NotFound("equipe")
    out = _team(info)
    out["pais"] = {"Italian": "Itália", "German": "Alemanha", "Austrian": "Áustria", "British": "Reino Unido", "French": "França", "American": "Estados Unidos",
                   "Swiss": "Suíça", "Japanese": "Japão", "Dutch": "Holanda"}.get(info.get("nationality"), info.get("nationality"))
    out.update(_wiki(info.get("url")))
    _add_headshots([out], datetime.now(timezone.utc).year)
    _, champ = _season_champion()
    out["carreira"] = {"corridas": 0, "vitorias": _total(f"constructors/{cid}/results/1.json?limit=1"),
                       "poles": _total(f"constructors/{cid}/qualifying/1.json?limit=1"), "titulos": TEAM_TITLES.get(cid, 0) + (1 if champ == cid else 0)}
    races = _jget(f"current/constructors/{cid}/results.json?limit=100", 1800)["MRData"]["RaceTable"]["Races"]
    sprint = _sprint_points(f"current/constructors/{cid}/sprint.json?limit=100", per_driver=True)
    drivers, acc, rows = {}, 0.0, []
    for r in races:
        pts = sum(sprint.get(r["round"], {}).values())  # sprint da etapa (cada piloto recebe a sua parte abaixo)
        res = []
        for x in r["Results"]:
            d = x["Driver"]
            drivers.setdefault(d["driverId"], {"piloto": _driver(d, info), "pontos": 0.0, "melhor": 99, "vitorias": 0, "podios": 0})
            e = drivers[d["driverId"]]
            p = float(x.get("points") or 0)
            pos = _int(x.get("position"), 99)
            e["pontos"] += p + sprint.get(r["round"], {}).get(d["driverId"], 0.0)
            e["melhor"] = min(e["melhor"], pos)
            e["vitorias"] += pos == 1
            e["podios"] += pos <= 3
            pts += p
            res.append({"piloto": d.get("code") or d.get("familyName"), "posicao": pos if (x.get("positionText") or "").isdigit() else None,
                        "status": STATUS_PT.get(x.get("status"), x.get("status"))})
        acc += pts
        rows.append({"rodada": _int(r["round"]), "gp": _gp(r["raceName"]), "pontos": pts, "acumulado": acc, "resultados": res})
    out["temporada"] = rows
    out["pilotos"] = sorted(drivers.values(), key=lambda e: -e["pontos"])
    try:
        lst = _jget(f"current/constructorStandings.json", 1800)["MRData"]["StandingsTable"]["StandingsLists"]
        me = next((c for c in lst[0]["ConstructorStandings"] if c["Constructor"]["constructorId"] == cid), None) if lst else None
        if me:
            out["campeonato"] = {"posicao": _int(me.get("position")), "pontos": float(me["points"]), "vitorias": _int(me.get("wins"), 0)}
    except Exception:  # noqa: BLE001
        pass
    return out


