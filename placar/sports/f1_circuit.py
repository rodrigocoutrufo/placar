"""F1: o circuito de cada etapa (/f1/corrida/{rodada}/circuito).

- Traçado com as curvas numeradas: MultiViewer (api.multiviewer.app, mesmos dados do app oficial de cronometragem),
  achado pelo circuit_key da OpenF1. Cache de 30 dias.
- Ficha: extensão oficial (tabela abaixo; circuito novo usa o próprio traçado), voltas e distância (última corrida ali),
  curvas, recorde da volta em corrida (Jolpica), tempo perdido num pit stop (MultiViewer).
- Previsão do tempo para cada sessão (Open-Meteo, grátis e sem chave), quando faltam até 15 dias.
- Última edição: pódio e pole da corrida anterior no circuito.
"""

import math
import urllib.parse
from datetime import datetime, timedelta, timezone

from .common import NotFound, _dt, _get, _int, _iso
from .f1 import SESSIONS, _driver, _jget, _race_dt, _schedule
from . import openf1

MULTIVIEWER = "https://api.multiviewer.app/api/v1/circuits"
OPEN_METEO = "https://api.open-meteo.com/v1/forecast"
# extensão oficial (km) dos circuitos do calendário
LENGTH_KM = {"albert_park": 5.278, "shanghai": 5.451, "suzuka": 5.807, "bahrain": 5.412, "jeddah": 6.174, "miami": 5.412,
             "imola": 4.909, "monaco": 3.337, "catalunya": 4.657, "villeneuve": 4.361, "red_bull_ring": 4.318, "silverstone": 5.891,
             "spa": 7.004, "hungaroring": 4.381, "zandvoort": 4.259, "monza": 5.793, "baku": 6.003, "marina_bay": 4.940,
             "americas": 5.513, "rodriguez": 4.304, "interlagos": 4.309, "vegas": 6.201, "losail": 5.419, "yas_marina": 5.281,
             "sepang": 5.543, "madring": 5.474, "ricard": 5.842, "portimao": 4.653, "istanbul": 5.338, "mugello": 5.245, "nurburgring": 5.148}
# código de tempo da Open-Meteo (WMO) -> texto
WMO = {0: "Céu limpo", 1: "Poucas nuvens", 2: "Parcialmente nublado", 3: "Nublado", 45: "Neblina", 48: "Neblina",
       51: "Garoa fraca", 53: "Garoa", 55: "Garoa forte", 61: "Chuva fraca", 63: "Chuva", 65: "Chuva forte", 66: "Chuva congelante",
       67: "Chuva congelante", 71: "Neve fraca", 73: "Neve", 75: "Neve forte", 80: "Pancadas fracas", 81: "Pancadas de chuva",
       82: "Pancadas fortes", 95: "Trovoadas", 96: "Trovoadas com granizo", 99: "Trovoadas com granizo"}


def _secs(t: str | None) -> float | None:
    """'1:22.384' -> 82.384"""
    if not t:
        return None
    try:
        m, s = t.split(":") if ":" in t else ("0", t)
        return int(m) * 60 + float(s)
    except ValueError:
        return None


def _circuit_key(when: datetime | None, year: int) -> int | None:
    """circuit_key da OpenF1 para a etapa (o fim de semana começa até 4 dias antes da corrida)."""
    if not when:
        return None
    for m in openf1._q(f"meetings?year={year}", 24 * 3600):
        d = _dt(m.get("date_start"))
        if d and timedelta(0) <= when - d <= timedelta(days=4):
            return m.get("circuit_key")
    return None


def _rotate(x, y, cx, cy, deg):
    a = math.radians(deg)
    dx, dy = x - cx, y - cy
    return cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)


def _from_openf1(key: int, year: int) -> dict | None:
    """Circuito novo, ainda sem dados na MultiViewer: o traçado sai da posição de um carro numa volta da corrida
    (OpenF1). Sem números de curva."""
    from urllib.parse import quote
    for y in (year, year - 1):
        sess = openf1._q(f"sessions?year={y}&session_name=Race&circuit_key={key}", 7 * 86400)
        sess = [x for x in sess if not x.get("is_cancelled") and (_dt(x.get("date_start")) or datetime.max.replace(tzinfo=timezone.utc)) < datetime.now(timezone.utc)]
        if not sess:
            continue
        sk = sess[-1]["session_key"]
        for lap in (5, 10, 20):
            laps = [x for x in openf1._q(f"laps?session_key={sk}&lap_number={lap}", 30 * 86400) if x.get("lap_duration") and x.get("date_start")]
            if not laps:
                continue
            x = laps[0]
            t0 = _dt(x["date_start"])
            t1 = t0 + timedelta(seconds=float(x["lap_duration"]))
            q = quote(f"session_key={sk}&driver_number={x['driver_number']}&date>{t0.isoformat()}&date<{t1.isoformat()}", safe="=&><")
            pts = openf1._q(f"location?{q}", 30 * 86400)
            pts = [p for p in pts if p.get("x") or p.get("y")]
            if len(pts) > 100:
                return {"x": [p["x"] for p in pts], "y": [p["y"] for p in pts], "rotation": 0, "corners": []}
    return None


def _layout(key: int, year: int) -> dict | None:
    """Traçado já girado e normalizado numa caixa de até 1000 x 1000 (o SVG só desenha)."""
    data = None
    for y in (year, year - 1):  # circuito do ano; se ainda não existir, o do ano anterior
        try:
            data = _get(f"{MULTIVIEWER}/{key}/{y}", 30 * 86400)
            break
        except Exception:  # noqa: BLE001
            continue
    if not data or not data.get("x"):
        data = _from_openf1(key, year)
    if not data or not data.get("x"):
        return None
    xs, ys = data["x"], data["y"]
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    rot = float(data.get("rotation") or 0)
    # coordenadas da F1 têm o y para cima; no SVG é para baixo: inverte depois de girar
    pts = [_rotate(x, y, cx, cy, rot) for x, y in zip(xs, ys)]
    corners = []
    for c in data.get("corners") or []:
        tp = c.get("trackPosition") or {}
        a = math.radians(float(c.get("angle") or 0))
        # número da curva um pouco para fora da pista, na direção indicada pela MultiViewer
        lx, ly = tp.get("x", 0) + 750 * math.cos(a), tp.get("y", 0) + 750 * math.sin(a)
        corners.append({"n": c.get("number"), "letra": c.get("letter") or "", "p": _rotate(tp.get("x", 0), tp.get("y", 0), cx, cy, rot),
                        "l": _rotate(lx, ly, cx, cy, rot)})
    allx = [p[0] for p in pts] + [c["l"][0] for c in corners]
    ally = [p[1] for p in pts] + [c["l"][1] for c in corners]
    minx, maxx, miny, maxy = min(allx), max(allx), min(ally), max(ally)
    span = max(maxx - minx, maxy - miny) or 1
    sx = lambda v: round((v - minx) / span * 1000, 1)  # noqa: E731
    sy = lambda v: round((maxy - v) / span * 1000, 1)  # noqa: E731 — y invertido
    perim = sum(math.dist((xs[i], ys[i]), (xs[i + 1], ys[i + 1])) for i in range(len(xs) - 1))
    # largada/chegada: o 1º ponto da MultiViewer nem sempre é a reta (em Mônaco cai na curva 13). Usa o meio do caminho
    # entre a última curva e a curva 1; sem curvas (traçado da OpenF1), o 1º ponto já é a linha de chegada.
    start = pts[0]
    if len(corners) >= 2:
        near = lambda q: min(range(len(pts)), key=lambda i: math.dist(pts[i], q))  # noqa: E731
        first = min(corners, key=lambda c: (c["n"] or 0, c["letra"]))
        last = max(corners, key=lambda c: (c["n"] or 0, c["letra"]))
        i1, iN = near(first["p"]), near(last["p"])
        gap = (i1 - iN) % len(pts)
        start = pts[(iN + gap // 2) % len(pts)]
    return {"pontos": [[sx(x), sy(y)] for x, y in pts], "largura": round((maxx - minx) / span * 1000, 1), "altura": round((maxy - miny) / span * 1000, 1),
            "curvas": [{"n": c["n"], "letra": c["letra"], "x": sx(c["p"][0]), "y": sy(c["p"][1]), "lx": sx(c["l"][0]), "ly": sy(c["l"][1])} for c in corners],
            "largada": [sx(start[0]), sy(start[1])], "pit": (data.get("pitLoss") or {}).get("normal"), "extensao_tracado": round(perim / 10000, 3)}  # unidades da F1: decímetros


def _record(cid: str) -> dict | None:
    """Recorde da volta em corrida: a mais rápida entre as voltas mais rápidas de cada GP no circuito."""
    try:
        races = _jget(f"circuits/{cid}/fastest/1/results.json?limit=100", 86400)["MRData"]["RaceTable"]["Races"]
    except Exception:  # noqa: BLE001
        return None
    best = None
    for r in races:
        x = (r.get("Results") or [None])[0]
        t = ((x or {}).get("FastestLap") or {}).get("Time", {}).get("time")
        s = _secs(t)
        if s and (best is None or s < best[0]):
            best = (s, {"tempo": t, "ano": _int(r["season"]), "piloto": _driver(x["Driver"], x.get("Constructor"))})
    return best[1] if best else None


def _last_edition(cid: str, before: int) -> dict | None:
    """Pódio, pole e voltas da corrida mais recente no circuito antes desta temporada."""
    try:
        wins = _jget(f"circuits/{cid}/results/1.json?limit=100", 86400)["MRData"]["RaceTable"]["Races"]
    except Exception:  # noqa: BLE001
        return None
    years = sorted({_int(r["season"]) for r in wins if _int(r["season"]) < before})
    if not years:
        return None
    y = years[-1]
    try:
        r = (_jget(f"{y}/circuits/{cid}/results.json?limit=3", 7 * 86400)["MRData"]["RaceTable"]["Races"] or [None])[0]
        q = (_jget(f"{y}/circuits/{cid}/qualifying.json?limit=1", 7 * 86400)["MRData"]["RaceTable"]["Races"] or [None])[0]
    except Exception:  # noqa: BLE001
        return None
    if not r:
        return None
    pole = ((q or {}).get("QualifyingResults") or [None])[0]
    return {"ano": y, "voltas": _int(r["Results"][0].get("laps")),
            "podio": [{"pos": _int(x.get("position")), "piloto": _driver(x["Driver"], x.get("Constructor")),
                       "tempo": (x.get("Time") or {}).get("time")} for x in r["Results"]],
            "pole": {"piloto": _driver(pole["Driver"], pole.get("Constructor")), "tempo": pole.get("Q3") or pole.get("Q2") or pole.get("Q1")} if pole else None}


def _weather(lat: float, lon: float, sessions: list) -> list:
    """Previsão na hora de cada sessão (só dentro dos 15 dias que a Open-Meteo prevê)."""
    now = datetime.now(timezone.utc)
    when = [(s, _dt(s["data_iso"])) for s in sessions if s.get("data_iso")]
    when = [(s, d) for s, d in when if d and now - timedelta(hours=3) <= d <= now + timedelta(days=15)]
    if not when:
        return []
    q = {"latitude": lat, "longitude": lon, "timezone": "UTC", "hourly": "temperature_2m,precipitation_probability,wind_speed_10m,weather_code",
         "start_date": min(d for _, d in when).strftime("%Y-%m-%d"), "end_date": max(d for _, d in when).strftime("%Y-%m-%d")}
    try:
        h = _get(f"{OPEN_METEO}?{urllib.parse.urlencode(q)}", 3 * 3600)["hourly"]
    except Exception:  # noqa: BLE001
        return []
    idx = {t: i for i, t in enumerate(h.get("time") or [])}
    out = []
    for s, d in when:
        i = idx.get(d.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00"))
        if i is None:
            continue
        code = (h.get("weather_code") or [None] * (i + 1))[i]
        out.append({"sessao": s["nome"], "data_iso": s["data_iso"], "temperatura": h["temperature_2m"][i],
                    "chuva": (h.get("precipitation_probability") or [None] * (i + 1))[i], "vento": h["wind_speed_10m"][i],
                    "codigo": code, "tempo": WMO.get(code, "")})
    return out


def circuit_info(rnd: int) -> dict:
    r = next((x for x in _schedule() if _int(x["round"]) == rnd), None)
    if not r:
        raise NotFound("etapa")
    circ = r.get("Circuit") or {}
    cid = circ.get("circuitId")
    year = _int(r["season"])
    when = _race_dt(r)
    out = {"id": cid, "nome": circ.get("circuitName"), "cidade": (circ.get("Location") or {}).get("locality"),
           "pais": (circ.get("Location") or {}).get("country")}
    try:
        key = _circuit_key(when, year)
        out["tracado"] = _layout(key, year) if key else None
    except Exception:  # noqa: BLE001
        out["tracado"] = None
    last = _last_edition(cid, year)
    km = LENGTH_KM.get(cid) or (out["tracado"] or {}).get("extensao_tracado")
    laps = (last or {}).get("voltas") or (math.ceil(305 / km) if km else None)  # regra: a menor volta que passa de 305 km
    out["ficha"] = {"extensao_km": km, "voltas": laps, "distancia_km": round(km * laps, 3) if km and laps else None,
                    "curvas": len((out["tracado"] or {}).get("curvas") or []) or None, "pit_perda": (out["tracado"] or {}).get("pit"),
                    "recorde": _record(cid)}
    out["ultima"] = last
    loc = circ.get("Location") or {}
    sessions = [{"nome": pt, "data_iso": _iso(_race_dt(r, k))} for k, pt in SESSIONS if r.get(k)] + [{"nome": "Corrida", "data_iso": _iso(when)}]
    sessions.sort(key=lambda s: s["data_iso"] or "")
    try:
        out["clima"] = _weather(float(loc["lat"]), float(loc["long"]), sessions)
    except (KeyError, TypeError, ValueError):
        out["clima"] = []
    return out
