"""F1: a temporada inteira de uma vez (Jolpica/Ergast) para estatísticas, duelos e comparações.

- season(): resultados, classificações e sprints de todas as etapas (todas as páginas da API, em cache).
- f1_season(): evolução do campeonato, líderes em estatísticas, duelos internos de todas as equipes e os dados do
  simulador do título.
- teammate_duel(): duelo de um piloto com o companheiro com quem mais correu (não o primeiro da lista da equipe,
  que pode ser um reserva que só correu uma vez).
- f1_compare(): dois pilotos quaisquer lado a lado.
"""

from collections import Counter
from datetime import datetime, timezone

from .common import NotFound, _int
from .f1 import STATUS_PT, _add_headshots, _driver, _gp, _jget, _schedule, _team, f1_overview

RACE_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1]
SPRINT_PTS = [8, 7, 6, 5, 4, 3, 2, 1]


def _pages(path: str, key: str) -> dict:
    """{rodada: {"gp", "linhas"}} juntando as páginas de 100 da API (uma etapa pode vir dividida entre duas)."""
    first = _jget(f"{path}?limit=100&offset=0", 1800)["MRData"]
    races = list(first["RaceTable"]["Races"])
    for off in range(100, _int(first.get("total"), 0), 100):
        races += _jget(f"{path}?limit=100&offset={off}", 1800)["MRData"]["RaceTable"]["Races"]
    out: dict = {}
    for r in races:
        e = out.setdefault(_int(r["round"]), {"gp": _gp(r["raceName"]), "linhas": {}})
        for x in r.get(key) or []:
            e["linhas"][x["Driver"]["driverId"]] = x  # sem duplicar se a página mudou entre um pedido e outro
    return out


def season() -> tuple[dict, dict, dict]:
    return (_pages("current/results.json", "Results"), _pages("current/qualifying.json", "QualifyingResults"),
            _pages("current/sprint.json", "SprintResults"))


def _classified(x) -> bool:
    return (x.get("positionText") or "").isdigit()


def _stats(res, quali, sprint) -> dict:
    """Números da temporada por piloto."""
    S: dict = {}
    for rnd in sorted(res):
        for did, x in res[rnd]["linhas"].items():
            s = S.setdefault(did, {"driver": x["Driver"], "team": x.get("Constructor"), "corridas": 0, "pontos": 0.0, "vitorias": 0, "podios": 0,
                                   "poles": 0, "voltas_rapidas": 0, "abandonos": 0, "ganhos": 0, "chegadas": [], "q3": 0, "rodadas": {}})
            s["team"] = x.get("Constructor") or s["team"]  # equipe mais recente
            pos, grid, ok = _int(x.get("position"), 99), _int(x.get("grid"), 0), _classified(x)
            sp = float((sprint.get(rnd, {}).get("linhas", {}).get(did) or {}).get("points") or 0)
            pts = float(x.get("points") or 0)
            s["corridas"] += 1
            s["pontos"] += pts + sp
            s["vitorias"] += ok and pos == 1
            s["podios"] += ok and pos <= 3
            s["voltas_rapidas"] += (x.get("FastestLap") or {}).get("rank") == "1"
            s["abandonos"] += not ok
            if ok:
                s["chegadas"].append(pos)
                if grid:
                    s["ganhos"] += grid - pos
            q = quali.get(rnd, {}).get("linhas", {}).get(did) or {}
            s["rodadas"][rnd] = {"pos": pos if ok else None, "grid": grid, "pontos": pts + sp, "quali": _int(q.get("position")),
                                 "equipe": (x.get("Constructor") or {}).get("constructorId")}
    for rnd, e in quali.items():  # poles e Q3 vêm da classificação (o grid muda com punições)
        for did, q in e["linhas"].items():
            if did in S:
                S[did]["poles"] += q.get("position") == "1"
                S[did]["q3"] += bool(q.get("Q3"))
    return S


def _h2h(a: dict, b: dict, rounds) -> dict:
    """Corrida (quem chegou à frente; quem terminou vence quem abandonou), classificação e pontos nas etapas em comum."""
    h = {"corrida": [0, 0], "classificacao": [0, 0], "pontos": [0.0, 0.0], "rodadas": 0}
    for rnd in rounds:
        x, y = a["rodadas"].get(rnd), b["rodadas"].get(rnd)
        if not x or not y:
            continue
        h["rodadas"] += 1
        h["pontos"][0] += x["pontos"]
        h["pontos"][1] += y["pontos"]
        if x["pos"] or y["pos"]:
            h["corrida"][0 if (x["pos"] or 99) < (y["pos"] or 99) else 1] += 1
        if x["quali"] and y["quali"]:
            h["classificacao"][0 if x["quali"] < y["quali"] else 1] += 1
    return h


def _out_driver(s: dict) -> dict:
    return _driver(s["driver"], s["team"])


def _summary(s: dict) -> dict:
    ch = s["chegadas"]
    return {"corridas": s["corridas"], "pontos": s["pontos"], "vitorias": s["vitorias"], "podios": s["podios"], "poles": s["poles"],
            "voltas_rapidas": s["voltas_rapidas"], "abandonos": s["abandonos"], "ganhos": s["ganhos"], "q3": s["q3"],
            "media_chegada": round(sum(ch) / len(ch), 1) if ch else None, "melhor": min(ch) if ch else None,
            "media_quali": (lambda qs: round(sum(qs) / len(qs), 1) if qs else None)([r["quali"] for r in s["rodadas"].values() if r["quali"]])}


def _cumulative(s: dict, rounds) -> list:
    acc, out = 0.0, []
    for rnd in rounds:
        acc += (s["rodadas"].get(rnd) or {}).get("pontos", 0.0)
        out.append(acc)
    return out


# ---------------------------------------------------------------- duelo com o companheiro
def teammate_duel(did: str) -> dict | None:
    res, quali, sprint = season()
    S = _stats(res, quali, sprint)
    me = S.get(did)
    if not me:
        return None
    mates = Counter()
    for rnd, r in me["rodadas"].items():
        for other, s in S.items():
            if other != did and (s["rodadas"].get(rnd) or {}).get("equipe") == r["equipe"]:
                mates[other] += 1
    if not mates:
        return None
    mate = mates.most_common(1)[0][0]
    h = _h2h(me, S[mate], sorted(res))
    return {"piloto": _out_driver(S[mate]), **h, "outros": [_out_driver(S[o]) | {"etapas": n} for o, n in mates.most_common()[1:]]}


# ---------------------------------------------------------------- temporada
CATS = [("pontos", "Pontos", False), ("vitorias", "Vitórias", False), ("podios", "Pódios", False), ("poles", "Poles", False),
        ("voltas_rapidas", "Voltas mais rápidas", False), ("ganhos", "Posições ganhas na corrida", False), ("q3", "Vezes no Q3", False),
        ("media_chegada", "Melhor média de chegada", True), ("abandonos", "Abandonos", False)]


def f1_season() -> dict:
    res, quali, sprint = season()
    S = _stats(res, quali, sprint)
    rounds = sorted(res)
    ov = f1_overview()
    order = [d["piloto"]["id"] for d in ov.get("pilotos") or []] or sorted(S, key=lambda k: -S[k]["pontos"])
    drivers = {k: _out_driver(s) for k, s in S.items()}
    _add_headshots(list(drivers.values()), ov.get("temporada") or 0)

    # evolução do campeonato: pontos acumulados dos 8 primeiros e das equipes
    evo_d = [{"piloto": drivers[k], "pontos": _cumulative(S[k], rounds)} for k in order[:8] if k in S]
    teams: dict = {}
    for k, s in S.items():
        for rnd, r in s["rodadas"].items():
            t = teams.setdefault(r["equipe"], {"pts": Counter(), "info": None})
            t["pts"][rnd] += r["pontos"]
        tid = (s["team"] or {}).get("constructorId")
        if tid in teams:
            teams[tid]["info"] = s["team"]
    evo_t = []
    for tid, t in teams.items():
        acc, pts = 0.0, []
        for rnd in rounds:
            acc += t["pts"][rnd]
            pts.append(acc)
        evo_t.append({"equipe": _team(t["info"] or {"constructorId": tid, "name": tid}), "pontos": pts})
    evo_t.sort(key=lambda e: -e["pontos"][-1] if e["pontos"] else 0)

    # líderes em cada estatística (média de chegada: só quem terminou metade das corridas)
    summ = {k: _summary(s) for k, s in S.items()}
    leaders = []
    for key, label, low in CATS:
        rows = [(k, v[key]) for k, v in summ.items() if v[key] is not None and (v[key] > 0 if not low else len(S[k]["chegadas"]) >= len(rounds) / 2)]
        rows.sort(key=lambda kv: kv[1] if low else -kv[1])
        if rows:
            leaders.append({"id": key, "nome": label, "lista": [{"piloto": drivers[k], "valor": v} for k, v in rows[:5]]})

    # duelos internos: em cada equipe, a dupla que mais correu junta
    pairs = Counter()
    for rnd in rounds:
        by_team: dict = {}
        for k, s in S.items():
            r = s["rodadas"].get(rnd)
            if r:
                by_team.setdefault(r["equipe"], []).append(k)
        for tid, ks in by_team.items():
            if len(ks) == 2:
                pairs[(tid, *sorted(ks, key=lambda k: order.index(k) if k in order else 99))] += 1
    duels, done = [], set()
    for (tid, a, b), _n in pairs.most_common():
        if tid in done:
            continue
        done.add(tid)
        h = _h2h(S[a], S[b], rounds)
        duels.append({"equipe": _team((teams.get(tid) or {}).get("info") or {"constructorId": tid, "name": tid}), "a": drivers[a], "b": drivers[b], **h})
    rank = {e["equipe"]["id"]: i for i, e in enumerate(evo_t)}
    duels.sort(key=lambda d: rank.get(d["equipe"]["id"], 99))

    # simulador do título: etapas que faltam e quem ainda pode ser campeão
    left = [{"rodada": r["rodada"], "gp": r["nome"], "sprint": r["sprint"]} for r in ov.get("calendario") or [] if r["status"] != "finalizada"]
    max_left = sum(25 + (8 if r["sprint"] else 0) for r in left)
    # os 8 primeiros: com o título decidido ainda dá para simular a briga pelo vice e pelas outras posições
    table = ov.get("pilotos") or []
    alive = [{"piloto": d["piloto"], "pontos": d["pontos"], "vitorias": d["vitorias"],
              "pode_mudar": any(abs(d["pontos"] - e["pontos"]) <= max_left for e in table[:9] if e is not d)} for d in table[:8]]
    return {"temporada": ov.get("temporada"), "rodadas": [{"rodada": r, "gp": res[r]["gp"]} for r in rounds],
            "evolucao": {"pilotos": evo_d, "equipes": evo_t},
            "lideres": leaders, "duelos": duels,
            "simulador": {"restantes": left, "pontos_corrida": RACE_PTS, "pontos_sprint": SPRINT_PTS, "pilotos": alive,
                          "decidido": bool((ov.get("titulo") or {}).get("decidido"))},
            "pilotos": sorted(({"id": k, "nome": drivers[k]["nome"], "equipe": drivers[k]["equipe"]} for k in order if k in S),
                              key=lambda p: order.index(p["id"]))}


# ---------------------------------------------------------------- comparar dois pilotos
def f1_compare(a: str, b: str) -> dict:
    res, quali, sprint = season()
    S = _stats(res, quali, sprint)
    if a not in S or b not in S:
        raise NotFound("piloto")
    rounds = sorted(res)
    drivers = {k: _out_driver(S[k]) for k in (a, b)}
    _add_headshots(list(drivers.values()), datetime.now(timezone.utc).year)
    # etapa a etapa: posição de cada um (AB = abandono)
    per = []
    for rnd in rounds:
        x, y = S[a]["rodadas"].get(rnd), S[b]["rodadas"].get(rnd)
        if x or y:
            per.append({"rodada": rnd, "gp": res[rnd]["gp"], "a": x and {"pos": x["pos"], "quali": x["quali"], "pontos": x["pontos"]},
                        "b": y and {"pos": y["pos"], "quali": y["quali"], "pontos": y["pontos"]}})
    return {"a": {"piloto": drivers[a], **_summary(S[a])}, "b": {"piloto": drivers[b], **_summary(S[b])},
            "duelo": _h2h(S[a], S[b], rounds), "evolucao": {"rodadas": rounds, "a": _cumulative(S[a], rounds), "b": _cumulative(S[b], rounds)},
            "etapas": per}


# ---------------------------------------------------------------- histórico do circuito
def circuit_history(rnd: int) -> dict | None:
    r = next((x for x in _schedule() if _int(x["round"]) == rnd), None)
    cid = ((r or {}).get("Circuit") or {}).get("circuitId")
    if not cid:
        return None
    first = _jget(f"circuits/{cid}/results/1.json?limit=100", 86400)["MRData"]
    races = list(first["RaceTable"]["Races"])
    for off in range(100, _int(first.get("total"), 0), 100):
        races += _jget(f"circuits/{cid}/results/1.json?limit=100&offset={off}", 86400)["MRData"]["RaceTable"]["Races"]
    wins = []
    for x in races:
        w = (x.get("Results") or [None])[0]
        if w:
            wins.append({"ano": _int(x["season"]), "piloto": _driver(w["Driver"], w.get("Constructor")),
                         "largada": _int(w.get("grid")), "status": STATUS_PT.get(w.get("status"), w.get("status"))})
    wins.sort(key=lambda w: -w["ano"])
    top = Counter(w["piloto"]["id"] for w in wins)
    names = {w["piloto"]["id"]: w["piloto"] for w in wins}
    return {"corridas": len(wins), "primeira": wins[-1]["ano"] if wins else None, "vencedores": wins[:10],
            "maiores": [{"piloto": names[k], "vitorias": n} for k, n in top.most_common(5) if n > 1],
            "pole_venceu": sum(1 for w in wins if w["largada"] == 1)}
