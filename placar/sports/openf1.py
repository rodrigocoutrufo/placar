"""Análise da corrida pela OpenF1 (https://openf1.org): dados oficiais de cronometragem da F1, grátis e sem chave
para sessões encerradas (dados ao vivo são pagos; o ao vivo da Vyra continua vindo da ESPN).

O que entra:
  pilotos com foto oficial e cor da equipe, estratégia de pneus (stints), pit stops, posição volta a volta,
  volta mais rápida, ultrapassagens, mensagens da direção de prova (safety car, bandeiras, punições),
  clima e rádio das equipes.

Tudo é cacheado: uma corrida encerrada não muda, então os dados ficam 12 h em memória.
"""

from bisect import bisect_right
from datetime import datetime, timedelta, timezone

from .common import NotFound, _dt, _get, _iso

OPENF1 = "https://api.openf1.org/v1"
DONE_TTL = 12 * 3600

COMPOUND_PT = {"SOFT": "Macio", "MEDIUM": "Médio", "HARD": "Duro", "INTERMEDIATE": "Intermediário", "WET": "Chuva"}


def _q(path: str, ttl: float = DONE_TTL):
    try:
        return _get(f"{OPENF1}/{path}", ttl) or []
    except NotFound:
        return []


def race_session(when: datetime | None, year: int):
    """Sessão de corrida da OpenF1 mais próxima da data da etapa (até 2 dias de diferença)."""
    if not when:
        return None
    best = None
    for s in _q(f"sessions?year={year}&session_name=Race", 6 * 3600):
        d = _dt(s.get("date_start"))
        if not d or s.get("is_cancelled"):
            continue
        diff = abs((d - when).total_seconds())
        if diff < 2 * 86400 and (best is None or diff < best[0]):
            best = (diff, s)
    return best[1] if best else None


def _drivers(key: int) -> dict[int, dict]:
    out = {}
    for d in _q(f"drivers?session_key={key}"):
        n = d.get("driver_number")
        if n is None:
            continue
        out[n] = {"numero": n, "sigla": d.get("name_acronym"), "nome": (d.get("full_name") or "").title(), "sobrenome": (d.get("last_name") or "").title(),
                  "equipe": d.get("team_name"), "cor": f"#{d['team_colour']}" if d.get("team_colour") else "#888888",
                  "foto": d.get("headshot_url")}
    return out


def _rc_kind(msg: str, flag: str | None) -> str | None:
    m = msg.upper()
    if "VIRTUAL SAFETY CAR" in m and "DEPLOYED" in m:
        return "vsc"
    if "SAFETY CAR" in m and ("DEPLOYED" in m or "IN THIS LAP" in m):
        return "sc"
    if flag == "RED" or "RED FLAG" in m:
        return "vermelha"
    if "PENALTY" in m and "NO FURTHER" not in m:
        return "punicao"
    if "INVESTIGAT" in m:
        return "investigacao"
    if "NO FURTHER ACTION" in m:
        return "sem_punicao"
    if flag == "CHEQUERED" or "CHEQUERED" in m:
        return "bandeirada"
    if "DRS ENABLED" in m or "OVERTAKE ENABLED" in m:
        return "drs"
    return None


def race_analysis(when: datetime | None, year: int) -> dict:
    """Análise completa da corrida encerrada. Levanta NotFound se a OpenF1 ainda não tem a sessão."""
    s = race_session(when, year)
    if not s:
        raise NotFound("openf1")
    end = _dt(s.get("date_end"))
    if end and end > datetime.now(timezone.utc) - timedelta(minutes=30):
        raise NotFound("openf1: corrida ainda não terminou")
    key = s["session_key"]
    drv = _drivers(key)
    result = sorted(_q(f"session_result?session_key={key}"), key=lambda r: (r.get("position") or 99))
    order = [r["driver_number"] for r in result if r.get("driver_number") in drv] or sorted(drv)
    total = max((r.get("number_of_laps") or 0 for r in result), default=0)

    # estratégia de pneus
    stints: dict[int, list] = {}
    for st in sorted(_q(f"stints?session_key={key}"), key=lambda x: (x.get("driver_number") or 0, x.get("stint_number") or 0)):
        n = st.get("driver_number")
        if n not in drv or st.get("lap_start") is None:
            continue
        stints.setdefault(n, []).append({"composto": st.get("compound"), "nome": COMPOUND_PT.get(st.get("compound"), st.get("compound")),
                                         "de": st.get("lap_start"), "ate": st.get("lap_end") or total, "idade": st.get("tyre_age_at_start") or 0})

    # pit stops
    pits = []
    for p in _q(f"pit?session_key={key}"):
        if p.get("driver_number") in drv:
            pits.append({"numero": p["driver_number"], "volta": p.get("lap_number"), "parado": p.get("stop_duration"),
                         "pit_lane": p.get("pit_duration") or p.get("lane_duration")})
    pits.sort(key=lambda p: (p["volta"] or 0))
    fastest_stops = sorted((p for p in pits if p["parado"]), key=lambda p: p["parado"])[:5]

    # voltas: posição ao fim de cada volta e volta mais rápida
    laps = [x for x in _q(f"laps?session_key={key}") if x.get("driver_number") in drv]
    positions: dict[int, tuple[list, list]] = {}
    for p in sorted(_q(f"position?session_key={key}"), key=lambda x: x.get("date") or ""):
        n = p.get("driver_number")
        d = _dt(p.get("date"))
        if n in drv and d:
            positions.setdefault(n, ([], []))
            positions[n][0].append(d)
            positions[n][1].append(p.get("position"))

    def pos_at(n, d):
        ds, ps = positions.get(n, ([], []))
        i = bisect_right(ds, d) - 1
        return ps[i] if i >= 0 else None

    starts: dict[int, dict[int, datetime]] = {}
    best = None
    for x in laps:
        n, ln = x["driver_number"], x.get("lap_number")
        d = _dt(x.get("date_start"))
        if d and ln:
            starts.setdefault(n, {})[ln] = d
        dur = x.get("lap_duration")
        if dur and not x.get("is_pit_out_lap") and (best is None or dur < best["tempo"]):
            best = {"numero": n, "volta": ln, "tempo": dur}
    final_pos = {r["driver_number"]: r.get("position") for r in result}
    chart = []
    for n in order:
        st = starts.get(n, {})
        done = max(st) if st else 0
        row = []
        for ln in range(1, done + 1):
            nxt = st.get(ln + 1)
            row.append(pos_at(n, nxt) if nxt else final_pos.get(n) if ln == done else None)
        grid = pos_at(n, st[1]) if 1 in st else None
        chart.append({"numero": n, "largada": grid, "posicoes": row})

    # ultrapassagens
    ovt: dict[int, int] = {}
    for o in _q(f"overtakes?session_key={key}"):
        n = o.get("overtaking_driver_number")
        if n in drv:
            ovt[n] = ovt.get(n, 0) + 1

    # direção de prova: só o que importa (safety car, bandeira vermelha, punições, investigações)
    rc = []
    yellow = 0
    for m in _q(f"race_control?session_key={key}"):
        msg = m.get("message") or ""
        if (m.get("flag") or "").endswith("YELLOW"):
            yellow += 1
        k = _rc_kind(msg, m.get("flag"))
        if k and k != "drs":
            rc.append({"volta": m.get("lap_number"), "tipo": k, "mensagem": msg, "numero": m.get("driver_number"), "quando": _iso(_dt(m.get("date")))})

    # clima
    w = _q(f"weather?session_key={key}")
    clima = None
    if w:
        avg = lambda f: round(sum(x.get(f) or 0 for x in w) / len(w), 1)
        clima = {"ar": avg("air_temperature"), "pista_max": max(x.get("track_temperature") or 0 for x in w),
                 "pista_min": min(x.get("track_temperature") or 99 for x in w), "umidade": avg("humidity"),
                 "chuva": any(x.get("rainfall") for x in w), "vento": avg("wind_speed")}

    # rádio das equipes (a F1 libera só uma seleção)
    radio = [{"numero": r["driver_number"], "quando": _iso(_dt(r.get("date"))), "audio": r.get("recording_url")}
             for r in _q(f"team_radio?session_key={key}") if r.get("driver_number") in drv and r.get("recording_url")]

    return {
        "sessao": {"chave": key, "local": s.get("location"), "pais": s.get("country_name"), "circuito": s.get("circuit_short_name")},
        "voltas_total": total, "pilotos": [drv[n] for n in order],
        "resultado": [{"numero": r["driver_number"], "posicao": r.get("position"), "voltas": r.get("number_of_laps"), "pontos": r.get("points"),
                       "diferenca": r.get("gap_to_leader"), "abandono": r.get("dnf"), "nao_largou": r.get("dns"), "desclassificado": r.get("dsq")}
                      for r in result if r.get("driver_number") in drv],
        "estrategia": [{"numero": n, "stints": stints.get(n, [])} for n in order],
        "pit_stops": pits, "pit_mais_rapidos": fastest_stops,
        "posicoes": chart, "volta_rapida": best,
        "ultrapassagens": sorted(({"numero": n, "total": c} for n, c in ovt.items()), key=lambda x: -x["total"]),
        "ultrapassagens_total": sum(ovt.values()),
        "direcao_de_prova": rc, "bandeiras_amarelas": yellow, "clima": clima, "radio": radio[-16:],
        "fonte": "OpenF1",
    }


def headshots(year: int) -> dict[str, dict]:
    """Foto oficial e cor da equipe de cada piloto (pela sigla), da última corrida disputada no ano."""
    sessions = [s for s in _q(f"sessions?year={year}&session_name=Race", 6 * 3600) if _dt(s.get("date_end")) and _dt(s["date_end"]) < datetime.now(timezone.utc)]
    if not sessions:
        return {}
    last = max(sessions, key=lambda s: s["date_start"])
    return {d["sigla"]: d for d in _drivers(last["session_key"]).values() if d.get("sigla")}
