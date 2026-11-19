"""NBA pela ESPN: placar do dia, jogo (box score, chance de vitória, lances), times, jogadores e classificação."""

import re
import time

from .common import BRT, NBA, NBA_STANDINGS, NotFound, _cache, _dt, _get, _int, _iso, _lock


# ================================================================ NBA
def _nba_status(st: dict):
    t = st.get("type") or {}
    state, name = t.get("state"), t.get("name", "")
    p = st.get("period") or 0
    q = f"{p}º quarto" if p <= 4 else (f"Prorrogação {p - 4}" if p > 5 else "Prorrogação")
    if name in ("STATUS_POSTPONED",):
        return "adiado", "Adiado"
    if name in ("STATUS_CANCELED", "STATUS_CANCELLED"):
        return "cancelado", "Cancelado"
    if state == "pre":
        return "agendado", None
    if state == "post":
        return "finalizado", "Final" if p <= 4 else "Final (prorr.)"
    if name == "STATUS_HALFTIME":
        return "andamento", "Intervalo"
    if name == "STATUS_END_PERIOD":
        return "andamento", f"Fim do {q}" if p <= 4 else "Fim da prorrogação"
    return "andamento", f"{q} · {st.get('displayClock') or ''}".strip(" ·")


def _nba_team(c: dict) -> dict:
    t = c.get("team") or {}
    rec = next((r.get("summary") for r in c.get("records") or [] if r.get("type") == "total" or r.get("name") == "overall"), None)
    return {"id": _int(t.get("id")), "nome": t.get("displayName") or t.get("name"), "curto": t.get("shortDisplayName") or t.get("name"),
            "sigla": t.get("abbreviation"), "logo": t.get("logo") or ((t.get("logos") or [{}])[0].get("href")),
            "cor": "#" + t["color"] if re.fullmatch(r"[0-9a-fA-F]{6}", t.get("color") or "") else None,
            "placar": _int(c.get("score")), "recorde": rec, "vencedor": bool(c.get("winner")),
            "parciais": [_int(x.get("value", x.get("displayValue")), 0) for x in c.get("linescores") or []]}  # o resumo do jogo só manda displayValue


def _nba_game(e: dict) -> dict:
    comp = e["competitions"][0]
    st = comp.get("status") or e.get("status") or {}
    status, label = _nba_status(st)
    sides = {c.get("homeAway"): c for c in comp["competitors"]}
    casa, fora = _nba_team(sides["home"]), _nba_team(sides["away"])
    if status == "agendado":
        casa["placar"] = fora["placar"] = None
    leaders = []
    for side, c in (("casa", sides["home"]), ("fora", sides["away"])):
        for cat in c.get("leaders") or []:
            if cat.get("name") in ("points", "rebounds", "assists") and cat.get("leaders"):
                ld = cat["leaders"][0]
                leaders.append({"lado": side, "categoria": {"points": "PTS", "rebounds": "REB", "assists": "AST"}[cat["name"]],
                                "nome": (ld.get("athlete") or {}).get("shortName") or (ld.get("athlete") or {}).get("displayName"),
                                "valor": ld.get("displayValue")})
    d = _dt(comp.get("date") or e.get("date"))
    return {"id": _int(e["id"]), "esporte": "nba", "status": status, "periodo": label, "data_iso": _iso(d),
            "hora": d.astimezone(BRT).strftime("%H:%M") if d else None, "casa": casa, "fora": fora,
            "titulo": comp.get("notes", [{}])[0].get("headline") if comp.get("notes") else None,
            "local": ((comp.get("venue") or {}).get("fullName")), "lideres": leaders}


def nba_scoreboard(date: str | None = None) -> dict:
    if date and not re.fullmatch(r"\d{8}", date):
        raise NotFound("data")
    url = f"{NBA}/scoreboard" + (f"?dates={date}" if date else "")
    data = _get(url, 60)
    games = [_nba_game(e) for e in data.get("events", []) if e.get("competitions")]
    if any(g["status"] == "andamento" for g in games):
        with _lock:  # dia com jogo rolando: placar a cada 15 s
            _cache[url] = (time.time() + 15, data)
    day = (data.get("day") or {}).get("date") or (date and f"{date[:4]}-{date[4:6]}-{date[6:]}")
    games.sort(key=lambda g: ({"andamento": 0, "agendado": 1}.get(g["status"], 2) if not date else 0, g["data_iso"] or ""))
    return {"data": day, "jogos": games}


def nba_live() -> list[dict]:
    try:
        return [g for g in nba_scoreboard()["jogos"] if g["status"] == "andamento"]
    except Exception:  # noqa: BLE001
        return []


PLAY_PT = [(r"\bmakes\b", "converte"), (r"\bmisses\b", "erra"), (r"three point", "de 3"), (r"\bjumper\b", "arremesso"),
           (r"\bpullup\b", "parando"), (r"\bstep back\b", "step-back"), (r"\bdriving\b", "infiltrando"), (r"\blayup\b", "bandeja"),
           (r"\bdunk\b", "enterrada"), (r"\bhook shot\b", "gancho"), (r"\bfloating\b", "flutuante"), (r"\bfree throw (\d) of (\d)", r"lance livre \1 de \2"),
           (r"(\d+)-foot", r"de \1 pés"), (r"\(([^)]+) assists\)", r"(assistência de \1)"), (r"\btip shot\b", "tapinha"), (r"\bfadeaway\b", "fadeaway"),
           (r"\balley oop\b", "ponte aérea"), (r"\bcutting\b", "em corte"), (r"\bturnaround\b", "girando"), (r"\btechnical\b", "técnica")]


def _pt(text: str) -> str:
    for a, b in PLAY_PT:
        text = re.sub(a, b, text, flags=re.I)
    return text


def nba_game(gid: int) -> dict:
    s = _get(f"{NBA}/summary?event={gid}", 15)
    hdr = s["header"]["competitions"][0]
    ev = {"id": str(gid), "date": hdr.get("date"), "competitions": [hdr], "status": hdr.get("status")}
    g = _nba_game(ev)
    if g["status"] != "andamento":
        with _lock:
            _cache[f"{NBA}/summary?event={gid}"] = (time.time() + (3600 if g["status"] == "finalizado" else 300), s)
    g["local"] = ((s.get("gameInfo") or {}).get("venue") or {}).get("fullName")
    side_of = {str(c["team"]["id"]): ("casa" if c.get("homeAway") == "home" else "fora") for c in hdr["competitors"]}

    # box score: titulares e reservas com as estatísticas de cada um
    box = {}
    for t in (s.get("boxscore") or {}).get("players") or []:
        st = (t.get("statistics") or [{}])[0]
        labels = st.get("labels") or st.get("names") or []
        rows = []
        for a in st.get("athletes") or []:
            ath = a.get("athlete") or {}
            vals = dict(zip(labels, a.get("stats") or []))
            rows.append({"id": _int(ath.get("id")), "nome": ath.get("displayName"), "curto": ath.get("shortName"), "camisa": ath.get("jersey"),
                         "posicao": (ath.get("position") or {}).get("abbreviation"), "foto": (ath.get("headshot") or {}).get("href"),
                         "titular": bool(a.get("starter")), "nao_jogou": a.get("reason") if a.get("didNotPlay") else None, "stats": vals})
        totals = dict(zip(labels, st.get("totals") or []))
        box[side_of.get(str(t["team"]["id"]), "casa")] = {"colunas": labels, "titulares": [r for r in rows if r["titular"]],
                                                           "reservas": [r for r in rows if not r["titular"]], "totais": totals}
    g["box"] = box or None

    # estatísticas dos times
    LBL = {"FG": "Arremessos", "Field Goal %": "Arremessos (%)", "3PT": "Bolas de 3", "Three Point %": "Bolas de 3 (%)", "FT": "Lances livres",
           "Free Throw %": "Lances livres (%)", "Rebounds": "Rebotes", "Offensive Rebounds": "Rebotes ofensivos", "Assists": "Assistências",
           "Steals": "Roubos de bola", "Blocks": "Tocos", "Turnovers": "Erros (turnovers)", "Fast Break Points": "Pontos de contra-ataque",
           "Points in Paint": "Pontos no garrafão", "Fouls": "Faltas", "Largest Lead": "Maior vantagem"}
    teams = {}
    for t in (s.get("boxscore") or {}).get("teams") or []:
        teams[side_of.get(str(t["team"]["id"]), "casa")] = {x.get("label"): x.get("displayValue") for x in t.get("statistics") or []}
    if len(teams) == 2:
        g["estatisticas"] = [{"nome": pt, "casa": teams["casa"].get(en), "fora": teams["fora"].get(en)} for en, pt in LBL.items()
                             if teams["casa"].get(en) is not None]

    # chance de vitória ao longo do jogo (até 160 pontos)
    wp = s.get("winprobability") or []
    if wp:
        step = max(1, len(wp) // 160)
        g["chance_vitoria"] = [round(x.get("homeWinPercentage", 0.5) * 100, 1) for x in wp[::step]] + [round(wp[-1].get("homeWinPercentage", 0.5) * 100, 1)]

    # lances (os 60 mais recentes) e cestas
    plays = s.get("plays") or []
    g["lances"] = [{"periodo": (p.get("period") or {}).get("number"), "relogio": (p.get("clock") or {}).get("displayValue"),
                    "texto": _pt(p.get("text") or ""), "cesta": bool(p.get("scoringPlay")), "valor": p.get("scoreValue"),
                    "lado": side_of.get(str((p.get("team") or {}).get("id")), None), "placar": f"{p.get('awayScore')}-{p.get('homeScore')}"}
                   for p in plays[-60:]][::-1]
    # mapa de arremessos: posição de cada arremesso de quadra (lances livres ficam de fora: a ESPN não dá posição)
    names = {r["id"]: r for side in box.values() for r in side["titulares"] + side["reservas"]}
    shots = []
    for p in plays:
        c = p.get("coordinate") or {}
        x, y = c.get("x"), c.get("y")
        if not p.get("shootingPlay") or not isinstance(x, (int, float)) or not isinstance(y, (int, float)) or not (0 <= x <= 50 and -5 <= y <= 47):
            continue
        # a ESPN mede o y a partir da linha do aro (enterradas caem em y ≈ 1); na quadra o aro fica a 5,25 pés do fundo
        y = min(47, max(0, y + 4.25))
        aid = _int(((p.get("participants") or [{}])[0].get("athlete") or {}).get("id"))
        who = names.get(aid) or {}
        dist = ((x - 25) ** 2 + (y - 5.25) ** 2) ** 0.5 * 0.3048  # distância até o aro, em metros
        shots.append({"x": x, "y": y, "ok": bool(p.get("scoringPlay")), "pts": _int(p.get("pointsAttempted")) or (3 if dist > 6.9 else 2),
                      "tipo": _shot_type((p.get("type") or {}).get("text") or ""), "jogador": aid, "nome": who.get("curto") or who.get("nome"),
                      "lado": side_of.get(str((p.get("team") or {}).get("id"))), "periodo": (p.get("period") or {}).get("number"),
                      "relogio": (p.get("clock") or {}).get("displayValue"), "dist": round(dist, 1)})
    g["arremessos"] = shots
    g["series"] = [x.get("summary") for x in s.get("seasonseries") or [] if x.get("summary")][:1]
    g["lesoes"] = [{"time": side_of.get(str((t.get("team") or {}).get("id")), None),
                    "jogadores": [{"nome": (i.get("athlete") or {}).get("displayName"), "status": {"Out": "Fora", "Day-To-Day": "Dúvida"}.get(i.get("status"), i.get("status"))}
                                  for i in t.get("injuries") or []]} for t in s.get("injuries") or []]
    return g


SHOT_PT = [("dunk", "Enterrada"), ("alley oop", "Ponte aérea"), ("layup", "Bandeja"), ("hook", "Gancho"), ("tip", "Tapinha"),
           ("floating", "Flutuante"), ("fadeaway", "Fadeaway"), ("step back", "Step-back"), ("pullup", "Arremesso parando"),
           ("turnaround", "Arremesso girando"), ("jump shot", "Arremesso"), ("shot", "Arremesso")]


def _shot_type(t: str) -> str:
    t = t.lower()
    return next((pt for en, pt in SHOT_PT if en in t), "Arremesso")


def _meters(h):
    m = re.match(r"(\d+)'\s*(\d+)", h or "")
    return f"{(int(m.group(1)) * 12 + int(m.group(2))) * 0.0254:.2f} m".replace(".", ",") if m else None


def _kg(w):
    m = re.match(r"(\d+)", w or "")
    return f"{round(int(m.group(1)) * 0.4536)} kg" if m else None


DIV_PT = {"Atlantic": "Atlântico", "Central": "Central", "Southeast": "Sudeste", "Northwest": "Noroeste", "Pacific": "Pacífico", "Southwest": "Sudoeste"}


def _summary_pt(s: str | None) -> str | None:
    """"1st in Pacific Division" -> "1º na Divisão Pacífico"."""
    m = re.match(r"(\d+)(?:st|nd|rd|th) in (\w+) Division", s or "")
    return f"{m.group(1)}º na Divisão {DIV_PT.get(m.group(2), m.group(2))}" if m else s


POS_NBA = {"G": "Armador", "PG": "Armador", "SG": "Ala-armador", "F": "Ala", "SF": "Ala", "PF": "Ala-pivô", "C": "Pivô", "G-F": "Ala-armador", "F-C": "Ala-pivô"}


def nba_team(tid: int) -> dict:
    t = _get(f"{NBA}/teams/{tid}", 1800)["team"]
    rec = {s["name"]: s.get("value") for s in ((t.get("record") or {}).get("items") or [{}])[0].get("stats", [])}
    venue = (t.get("franchise") or {}).get("venue") or {}
    out = {"id": tid, "nome": t.get("displayName"), "curto": t.get("shortDisplayName"), "sigla": t.get("abbreviation"),
           "cidade": t.get("location"), "logo": next((l["href"] for l in t.get("logos") or [] if "default" in (l.get("rel") or [])), None) or ((t.get("logos") or [{}])[0].get("href")),
           "cor": "#" + t["color"] if re.fullmatch(r"[0-9a-fA-F]{6}", t.get("color") or "") else None,
           "cor2": "#" + t["alternateColor"] if re.fullmatch(r"[0-9a-fA-F]{6}", t.get("alternateColor") or "") else None,
           "resumo": _summary_pt(t.get("standingSummary")), "ginasio": venue.get("fullName"), "local": ", ".join(x for x in ((venue.get("address") or {}).get("city"), (venue.get("address") or {}).get("state")) if x),
           "campanha": {"v": _int(rec.get("wins"), 0), "d": _int(rec.get("losses"), 0), "pontos_pro": round(rec.get("avgPointsFor") or 0, 1),
                        "pontos_contra": round(rec.get("avgPointsAgainst") or 0, 1), "saldo": round(rec.get("differential") or 0, 1),
                        "posicao": _int(rec.get("playoffSeed")), "sequencia": None}}
    # elenco
    try:
        r = _get(f"{NBA}/teams/{tid}/roster", 3600)
        coach = (r.get("coach") or [{}])[0]
        out["tecnico"] = f"{coach.get('firstName', '')} {coach.get('lastName', '')}".strip() or None
        out["elenco"] = sorted([{"id": _int(a.get("id")), "nome": a.get("displayName"), "camisa": a.get("jersey"), "posicao": POS_NBA.get((a.get("position") or {}).get("abbreviation"), (a.get("position") or {}).get("displayName")),
                                 "sigla_pos": (a.get("position") or {}).get("abbreviation"), "idade": a.get("age"), "altura": _meters(a.get("displayHeight")), "peso": _kg(a.get("displayWeight")),
                                 "foto": (a.get("headshot") or {}).get("href"), "origem": (a.get("college") or {}).get("name") or (a.get("birthPlace") or {}).get("country"),
                                 "lesao": ((a.get("injuries") or [{}])[0] or {}).get("status") if a.get("injuries") else None}
                                for a in r.get("athletes") or []], key=lambda x: ({"G": 0, "PG": 0, "SG": 1, "G-F": 2, "F": 3, "SF": 3, "PF": 4, "F-C": 5, "C": 6}.get(x["sigla_pos"], 9), x["nome"] or ""))
    except Exception:  # noqa: BLE001
        out["elenco"] = []
    # jogos da temporada
    try:
        s = _get(f"{NBA}/teams/{tid}/schedule", 600)
        games = []
        for e in s.get("events") or []:
            comp = e["competitions"][0]
            me = next((c for c in comp["competitors"] if str(c["team"]["id"]) == str(tid)), None)
            op = next((c for c in comp["competitors"] if str(c["team"]["id"]) != str(tid)), None)
            if not me or not op:
                continue
            st = (comp.get("status") or {}).get("type") or {}
            sc = lambda c: _int((c.get("score") or {}).get("value") if isinstance(c.get("score"), dict) else c.get("score"))  # noqa: E731
            d = _dt(e.get("date"))
            games.append({"id": _int(e["id"]), "data_iso": _iso(d), "casa": me.get("homeAway") == "home",
                          "adversario": {"id": _int(op["team"]["id"]), "nome": op["team"].get("shortDisplayName") or op["team"].get("displayName"), "sigla": op["team"].get("abbreviation"),
                                         "logo": ((op["team"].get("logos") or [{}])[0].get("href"))},
                          "status": {"pre": "agendado", "in": "andamento", "post": "finalizado"}.get(st.get("state"), "agendado"),
                          "placar": sc(me), "placar_adv": sc(op), "vitoria": bool(me.get("winner")) if st.get("state") == "post" else None})
        done = [g for g in games if g["status"] == "finalizado"]
        out["ultimos"] = done[-8:][::-1]
        out["proximos"] = [g for g in games if g["status"] != "finalizado"][:6]
        streak = 0
        for g in reversed(done):
            if streak == 0 or (streak > 0) == g["vitoria"]:
                streak += 1 if g["vitoria"] else -1
            else:
                break
        out["campanha"]["sequencia"] = (f"{abs(streak)} vitória" + ("s" if abs(streak) > 1 else "")) if streak > 0 else (f"{abs(streak)} derrota" + ("s" if abs(streak) > 1 else "")) if streak < 0 else None
        out["casa_fora"] = {"casa": f"{sum(1 for g in done if g['casa'] and g['vitoria'])}-{sum(1 for g in done if g['casa'] and not g['vitoria'])}",
                            "fora": f"{sum(1 for g in done if not g['casa'] and g['vitoria'])}-{sum(1 for g in done if not g['casa'] and not g['vitoria'])}"}
    except Exception:  # noqa: BLE001
        out["ultimos"], out["proximos"] = [], []
    # estatísticas do time (média por jogo e posição na liga)
    try:
        st = _get(f"{NBA}/teams/{tid}/statistics", 3600)
        cats = ((st.get("results") or {}).get("stats") or {}).get("categories") or []
        flat = {x["name"]: x for c in cats for x in c.get("stats") or []}
        WANT = [("avgPoints", "Pontos por jogo"), ("avgRebounds", "Rebotes"), ("avgAssists", "Assistências"), ("fieldGoalPct", "Arremessos (%)"),
                ("threePointFieldGoalPct", "Bolas de 3 (%)"), ("freeThrowPct", "Lances livres (%)"), ("avgSteals", "Roubos de bola"), ("avgBlocks", "Tocos"), ("avgTurnovers", "Erros")]
        out["estatisticas"] = [{"nome": pt, "valor": flat[k].get("displayValue"), "rank": flat[k].get("rankDisplayValue") or flat[k].get("rank")} for k, pt in WANT if k in flat]
    except Exception:  # noqa: BLE001
        out["estatisticas"] = []
    return out


def nba_player(pid: int) -> dict:
    d = _get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{pid}", 3600)
    a = d.get("athlete") or {}
    t = a.get("team") or {}
    out = {"id": pid, "nome": a.get("displayName"), "nome_completo": a.get("fullName"), "camisa": a.get("jersey"),
           "posicao": POS_NBA.get((a.get("position") or {}).get("abbreviation"), (a.get("position") or {}).get("displayName")),
           "foto": (a.get("headshot") or {}).get("href"), "idade": a.get("age"), "nascimento": a.get("displayDOB"), "naturalidade": a.get("displayBirthPlace"),
           "altura": _meters(a.get("displayHeight")), "peso": _kg(a.get("displayWeight")), "experiencia": a.get("displayExperience"),
           "draft": a.get("displayDraft"), "universidade": (a.get("college") or {}).get("name"),
           "time": {"id": _int(t.get("id")), "nome": t.get("displayName"), "logo": ((t.get("logos") or [{}])[0].get("href")),
                    "cor": "#" + t["color"] if re.fullmatch(r"[0-9a-fA-F]{6}", t.get("color") or "") else None} if t.get("id") else None,
           "status": (a.get("status") or {}).get("name")}
    try:
        ov = _get(f"https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/{pid}/overview", 1800)
        s = ov.get("statistics") or {}
        labels = s.get("labels") or []
        LBL = {"GP": "Jogos", "MIN": "Minutos", "FG%": "Arremessos %", "3P%": "Bolas de 3 %", "FT%": "Lances livres %", "REB": "Rebotes", "AST": "Assistências",
               "BLK": "Tocos", "STL": "Roubos", "PF": "Faltas", "TO": "Erros", "PTS": "Pontos"}
        out["medias"] = [{"nome": {"Regular Season": "Temporada regular", "Career": "Carreira"}.get(sp.get("displayName"), sp.get("displayName")),
                          "stats": [{"sigla": lb, "nome": LBL.get(lb, lb), "valor": v} for lb, v in zip(labels, sp.get("stats") or [])]} for sp in s.get("splits") or []]
        gl = ov.get("gameLog") or {}
        gst = (gl.get("statistics") or [{}])[0]
        glabels = gst.get("labels") or []
        events = gl.get("events") or {}
        out["ultimos_jogos"] = []
        for ev in (gst.get("events") or [])[:8]:
            meta = events.get(str(ev.get("eventId"))) or {}
            vals = dict(zip(glabels, ev.get("stats") or []))
            out["ultimos_jogos"].append({"id": _int(ev.get("eventId")), "data_iso": _iso(_dt(meta.get("gameDate"))),
                                         "adversario": ((meta.get("opponent") or {}).get("abbreviation")), "adv_logo": (meta.get("opponent") or {}).get("logo"),
                                         "casa": meta.get("atVs") == "vs", "resultado": meta.get("gameResult"), "placar": meta.get("score"),
                                         "pts": vals.get("PTS"), "reb": vals.get("REB"), "ast": vals.get("AST"), "min": vals.get("MIN")})
    except Exception:  # noqa: BLE001
        out.setdefault("medias", [])
        out.setdefault("ultimos_jogos", [])
    return out


def nba_standings() -> list[dict]:
    data = _get(NBA_STANDINGS, 600)
    out = []
    for conf in data.get("children") or []:
        rows = []
        for e in conf["standings"]["entries"]:
            st = {x.get("name"): x.get("displayValue") for x in e.get("stats") or []}
            st.update({x.get("type") or x.get("name"): x.get("displayValue") for x in e.get("stats") or [] if x.get("type")})
            t = e["team"]
            rows.append({"time": {"id": _int(t.get("id")), "nome": t.get("displayName"), "curto": t.get("shortDisplayName"), "sigla": t.get("abbreviation"),
                                  "logo": ((t.get("logos") or [{}])[0].get("href"))},
                         "posicao": _int(st.get("playoffSeed"), 99), "v": _int(st.get("wins"), 0), "d": _int(st.get("losses"), 0),
                         "pct": st.get("winPercent"), "atras": st.get("gamesBehind"), "sequencia": st.get("streak"),
                         "casa": st.get("Home") or st.get("home"), "fora": st.get("Road") or st.get("road"), "ultimos10": st.get("Last Ten Games") or st.get("lasttengames"),
                         "saldo": st.get("differential")})
        rows.sort(key=lambda r: r["posicao"])
        out.append({"nome": {"Eastern Conference": "Conferência Leste", "Western Conference": "Conferência Oeste"}.get(conf.get("name"), conf.get("name")), "times": rows})
    return out


