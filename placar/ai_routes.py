"""Rotas /api/ia/*: ligam a camada de IA (placar/ai) aos dados da própria Vyra.

  GET  /api/ia/status            a IA está ligada? (o site esconde os recursos de IA quando não está)
  GET  /api/ia/partida/{id}      análise da partida (prévia, ao vivo ou resumo)
  GET  /api/ia/para-voce         resumo do dia a partir dos interesses (?times=A,B&campeonatos=10,7)
  POST /api/ia/perguntar         "Pergunte à Vyra" (só com conta: controla o custo por pessoa)
"""

import json
import re
import unicodedata
from datetime import datetime, timedelta

from . import config
from .ai import assistant, foryou, insights
from .ai import client as ai
from .core import auth


class NotFound(Exception):
    pass


def _srv():
    from . import server  # import tardio: server importa este módulo
    return server


def _get(path, query=None):
    st, body, _ = _srv().route(path, query or {})
    return json.loads(body) if st == 200 else None


def _nk(s):
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower())


# ---------------------------------------------------------------- formatos compactos (o que vai para a IA)
def _m(m: dict) -> dict:
    started = m.get("status") in ("andamento", "finalizado")
    return {"partida_id": m.get("partida_id"), "campeonato": (m.get("campeonato") or {}).get("nome_popular"),
            "mandante": m["time_mandante"]["nome_popular"], "visitante": m["time_visitante"]["nome_popular"],
            "placar": f"{m.get('placar_mandante')}-{m.get('placar_visitante')}" if started else None,
            "status": m.get("status"), "minuto": m.get("cronometro_label") if m.get("status") == "andamento" else None,
            "data": m.get("data_realizacao"), "hora": m.get("hora_realizacao")}


def _line(m: dict) -> str:
    """'Brasileirão: Chapecoense x Vasco, 14/11 20:30' / 'Série B: Londrina 2x1 Náutico (encerrado)'."""
    x = _m(m)
    if x["status"] == "finalizado":
        jogo, quando = f"{x['mandante']} {x['placar'].replace('-', 'x')} {x['visitante']}", "(encerrado)"
    elif x["status"] == "andamento":
        jogo, quando = f"{x['mandante']} {x['placar'].replace('-', 'x')} {x['visitante']}", f"(ao vivo{', ' + x['minuto'] if x.get('minuto') else ''})"
    else:
        jogo, quando = f"{x['mandante']} x {x['visitante']}", f"{(x.get('data') or '')[:5]} {x.get('hora') or ''}".strip()
    return f"{x['campeonato']}: {jogo}, {quando} [id {x['partida_id']}]"


def _row(r: dict) -> dict:
    return {"pos": r["posicao"], "time": r["time"]["nome_popular"], "pts": r["pontos"], "j": r["jogos"], "v": r["vitorias"],
            "e": r["empates"], "d": r["derrotas"], "gp": r["gols_pro"], "gc": r["gols_contra"], "sg": r["saldo_gols"],
            "ultimos": "".join((x or "")[:1].upper() for x in (r.get("ultimos_jogos") or []))}


def _table(cid) -> list:
    t = _get(f"/campeonatos/{cid}/tabela")
    return t if isinstance(t, list) else []


def _comps() -> list:
    return _get("/campeonatos") or []


def _current_matches(c: dict) -> list:
    cid = c["campeonato_id"]
    if c.get("rodada_atual"):
        r = _get(f"/campeonatos/{cid}/rodadas/{c['rodada_atual']['rodada']}") or {}
        return r.get("partidas") or []
    if c.get("fase_atual"):
        f = _get(f"/campeonatos/{cid}/fases/{c['fase_atual']['fase_id']}") or {}
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
        walk(f.get("partidas"))
        for ch in f.get("chaves") or []:
            walk(ch.get("partida_ida"))
            walk(ch.get("partida_volta"))
        return out
    return []


# ---------------------------------------------------------------- agenda, nomes e tabela no momento do jogo
def clean_name(n: str | None) -> str | None:
    """Nome como o torcedor fala: sem o ano de fundação e sem siglas de sociedade ("Como 1907" -> "Como", "PAE AEK" -> "AEK")."""
    if not n:
        return n
    n = re.sub(r"\s+(18|19|20)\d{2}$", "", n.strip())
    return re.sub(r"^(PAE|PFC|PAOK FC)\s+", "", n).strip()


def _agenda() -> list:
    """Jogos de todos os campeonatos de 21 dias atrás a 30 à frente (a mesma agenda da página inicial)."""
    try:
        return json.loads(_srv().agenda())
    except (ValueError, TypeError):
        return []


def _when(m: dict):
    try:
        return datetime.strptime(m.get("data_realizacao_iso") or "", "%Y-%m-%dT%H:%M:%S%z")
    except ValueError:
        return None


def _plays(m: dict, tid, nome: str) -> str | None:
    """'casa' / 'fora' se o time joga essa partida."""
    for side, key in (("casa", "time_mandante"), ("fora", "time_visitante")):
        t = m.get(key) or {}
        if (tid and t.get("time_id") == tid) or _nk(t.get("nome_popular")) == _nk(nome):
            return side
    return None


def team_games(tid, nome: str, ref=None, agenda=None) -> tuple[list, list]:
    """(últimos jogos encerrados, do mais recente; próximos jogos, do mais próximo), em todas as competições.
    ref: data de referência (padrão: agora)."""
    ref = ref or datetime.now(config.BRT)
    past, nxt = [], []
    games = list(agenda if agenda is not None else _agenda())
    if tid and int(tid) >= 900_000_000:  # time da ESPN: histórico completo da temporada, em todas as competições
        seen = {g.get("partida_id") for g in games}
        for kind in ("anteriores", "proximas"):
            d = _get(f"/times/{tid}/partidas/{kind}")
            for lst in (d.values() if isinstance(d, dict) else [d] if isinstance(d, list) else []):
                for g in lst if isinstance(lst, list) else []:
                    if isinstance(g, dict) and g.get("partida_id") not in seen:
                        seen.add(g.get("partida_id"))
                        games.append(g)
    for m in games:
        side, d = _plays(m, tid, nome), _when(m)
        if not side or not d:
            continue
        if m.get("status") == "finalizado" and d < ref:
            past.append((d, side, m))
        elif m.get("status") in ("agendado", "andamento") and d >= ref - timedelta(hours=3):  # jogo rolando também conta
            nxt.append((d, side, m))
    past.sort(key=lambda x: x[0], reverse=True)
    nxt.sort(key=lambda x: x[0])
    return past, nxt


def _result_line(d, side, m, nome) -> str:
    """'V 2x0 Grêmio (casa, Brasileirão, 22/11)' do ponto de vista do time."""
    gm, gv = m.get("placar_mandante") or 0, m.get("placar_visitante") or 0
    pro, contra = (gm, gv) if side == "casa" else (gv, gm)
    res = "V" if pro > contra else "E" if pro == contra else "D"
    adv = clean_name((m["time_visitante"] if side == "casa" else m["time_mandante"])["nome_popular"])
    return f"{res} {pro}x{contra} {adv} ({side}, {(m.get('campeonato') or {}).get('nome_popular')}, {d.strftime('%d/%m')})"


def _next_line(d, side, m) -> str:
    adv = clean_name((m["time_visitante"] if side == "casa" else m["time_mandante"])["nome_popular"])
    when = "hoje" if d.date() == datetime.now(config.BRT).date() else d.strftime("%d/%m")
    return f"{adv} ({side}, {(m.get('campeonato') or {}).get('nome_popular')}, {when} {d.strftime('%H:%M')})"


def _walk_matches(v, out):
    if isinstance(v, list):
        for x in v:
            _walk_matches(x, out)
    elif isinstance(v, dict):
        if v.get("partida_id"):
            out.append(v)
        else:
            for x in v.values():
                _walk_matches(x, out)


def _season_results(cid, match: dict) -> list:
    """Jogos do campeonato (ou da fase do jogo, nas copas europeias) para refazer a tabela pelos resultados."""
    out = []
    d = _get(f"/campeonatos/{cid}/partidas")
    _walk_matches((d or {}).get("partidas") if isinstance(d, dict) else d, out)
    fid = (match.get("fase") or {}).get("fase_id")
    if not out and fid:
        _walk_matches((_get(f"/campeonatos/{cid}/fases/{fid}") or {}).get("partidas"), out)
    return out


def _rank(t: dict, cid) -> list:
    # Brasileirão e Série B desempatam por vitórias; as ligas europeias, pelo saldo de gols
    if cid in (10, 14):
        key = lambda k: (-t[k]["pts"], -t[k]["v"], -(t[k]["gp"] - t[k]["gc"]), -t[k]["gp"])  # noqa: E731
    else:
        key = lambda k: (-t[k]["pts"], -(t[k]["gp"] - t[k]["gc"]), -t[k]["gp"], -t[k]["v"])  # noqa: E731
    return sorted(t, key=key)


def table_after(rows: list, cid, match: dict, agenda=None) -> dict:
    """Tabela logo depois desta partida, com a posição recalculada e 'pos_antes' (sem esta partida).
    Refaz a tabela pelos resultados do campeonato até o jogo (a tabela da fonte pode estar atrasada ou ter rodadas a
    mais); sem a lista de jogos, usa a tabela atual menos os jogos que vieram depois."""
    md = _when(match)
    if not rows or not md:
        return {}
    t = {r["time"]["time_id"]: {"pts": 0, "j": 0, "v": 0, "e": 0, "d": 0, "gp": 0, "gc": 0, "nome": r["time"]["nome_popular"]} for r in rows}

    def apply(m, sign=1):
        gm, gv = m.get("placar_mandante") or 0, m.get("placar_visitante") or 0
        for tid, pro, contra in ((m["time_mandante"]["time_id"], gm, gv), (m["time_visitante"]["time_id"], gv, gm)):
            r = t.get(tid)
            if not r:
                continue
            r["j"] += sign
            r["gp"] += sign * pro
            r["gc"] += sign * contra
            if pro > contra:
                r["v"] += sign
                r["pts"] += sign * 3
            elif pro == contra:
                r["e"] += sign
                r["pts"] += sign
            else:
                r["d"] += sign

    games = [g for g in _season_results(cid, match) if g.get("status") == "finalizado" and _when(g)
             and g["time_mandante"].get("time_id") in t and g["time_visitante"].get("time_id") in t]
    if games:  # pelos resultados: tudo até o jogo (inclusive)
        ids = {g.get("partida_id") for g in games}
        for g in games:
            if _when(g) <= md:
                apply(g)
        if match.get("status") == "finalizado" and match.get("partida_id") not in ids:
            apply(match)  # o jogo ainda não entrou na lista da fonte
    else:  # sem lista: tabela atual menos o que veio depois
        for r in rows:
            t[r["time"]["time_id"]].update(pts=r["pontos"], j=r["jogos"], v=r["vitorias"], e=r["empates"], d=r["derrotas"],
                                           gp=r["gols_pro"], gc=r["gols_contra"])
        for g in agenda if agenda is not None else _agenda():
            if ((g.get("campeonato") or {}).get("campeonato_id") == cid and g.get("status") == "finalizado"
                    and g.get("partida_id") != match.get("partida_id") and (_when(g) or md) > md):
                apply(g, -1)
    for i, k in enumerate(_rank(t, cid), 1):
        t[k]["pos"] = i
    if match.get("status") == "finalizado":
        apply(match, -1)
        for i, k in enumerate(_rank(t, cid), 1):
            t[k]["pos_antes"] = i
        apply(match)
    return t


# zonas que fazem sentido em cada competição: (nome da zona de cima, até que posição, nome da de baixo, quantos caem)
ZONES = {10: ("G4", 4, "Z4", 4), 14: ("G4 (acesso)", 4, "Z4", 4)}
# fase de liga das copas europeias (36 times): 1º-8º vão direto às oitavas, 9º-24º jogam o playoff, 25º em diante saem
CUP_LEAGUE = {106, 231, 232}


def _pts(n: int) -> str:
    return f"{n} ponto" if abs(n) == 1 else f"{n} pontos"


def _zone_fact(cid, row: dict, table: dict) -> str | None:
    """Distância para o líder, para o G4 e para a zona de rebaixamento (com a tabela do momento)."""
    if not row or not table:
        return None
    ranked = sorted(table.values(), key=lambda r: r["pos"])
    n = len(ranked)
    parts = []
    leader = ranked[0]
    if row["pos"] != 1:
        parts.append(f"{_pts(leader['pts'] - row['pts'])} atrás do líder ({clean_name(leader['nome'])}, {leader['pts']})")
    else:
        parts.append(f"líder, {_pts(row['pts'] - ranked[1]['pts'])} à frente do 2º ({clean_name(ranked[1]['nome'])})")
    if cid in CUP_LEAGUE and n >= 30:
        pos = row["pos"]
        if pos <= 8:
            parts.append(f"no top 8 (vaga direta nas oitavas), {_pts(row['pts'] - ranked[8]['pts'])} à frente do 9º")
        elif pos <= 24:
            parts.append(f"na zona do playoff (9º ao 24º), {_pts(ranked[7]['pts'] - row['pts'])} atrás do 8º (vaga direta) e "
                         f"{_pts(row['pts'] - ranked[24]['pts'])} à frente do 25º (eliminação)")
        else:
            parts.append(f"fora da zona de classificação (25º em diante), {_pts(ranked[23]['pts'] - row['pts'])} atrás do 24º")
        return "; ".join(parts)
    g_name, g, z_name, z = ZONES.get(cid, ("4 primeiros", 4, None, 0))
    if row["pos"] > g and n > g:
        parts.append(f"{_pts(ranked[g - 1]['pts'] - row['pts'])} atrás do {g}º lugar (limite do {g_name})")
    if z_name and n > z:
        first_z = ranked[n - z]  # primeiro time dentro da zona
        last_safe = ranked[n - z - 1]
        if row["pos"] > n - z:
            parts.append(f"dentro do {z_name}, {_pts(last_safe['pts'] - row['pts'])} abaixo do primeiro fora da zona ({clean_name(last_safe['nome'])}, {last_safe['pts']})")
        else:
            parts.append(f"{_pts(row['pts'] - first_z['pts'])} acima do {z_name}")
    return "; ".join(parts)


def _scorer(cid, tid, nome) -> str | None:
    lst = _get(f"/campeonatos/{cid}/artilharia") or []
    for x in lst if isinstance(lst, list) else []:
        t = x.get("time") or {}
        if t.get("time_id") == tid or _nk(t.get("nome_popular")) == _nk(nome):
            return f"{(x.get('atleta') or {}).get('nome_popular')}, {x.get('gols')} gols"
    return None


# ---------------------------------------------------------------- análise da partida
def match_context(pid: int) -> dict:
    s = _srv()
    st, body, _ = s.route(f"/partidas/{pid}")
    if st != 200:
        raise NotFound()
    m = json.loads(s.enrich_match(body))
    camp = m.get("campeonato") or {}
    cid = camp.get("campeonato_id")
    rows = _table(cid) if cid else []
    agenda = _agenda()
    # tabela do momento: jogo encerrado usa a tabela logo depois dele (e não a de hoje, com rodadas a mais)
    snap = table_after(rows, cid, m, agenda) if rows else {}
    ref = _when(m)

    def team(t):
        r = next((x for x in rows if x["time"]["time_id"] == t["time_id"] or _nk(x["time"]["nome_popular"]) == _nk(t["nome_popular"])), None)
        out = {"nome": clean_name(t["nome_popular"])}
        if r:
            row = _row(r)
            s_ = snap.get(r["time"]["time_id"])
            if s_ and m.get("status") == "finalizado":  # números de logo depois do jogo
                row.update({k: s_[k] for k in ("pts", "j", "v", "e", "d", "gp", "gc", "pos")})
                row["ultimos"] = ""  # a sequência de hoje não vale para um jogo antigo
                if s_.get("pos_antes"):
                    out["posicao_antes"] = s_["pos_antes"]
            out["tabela"] = row
            z = _zone_fact(cid, s_ or {**row, "pos": row["pos"]}, snap) if snap else None
            if z:
                out["situacao"] = z
            sc = _scorer(cid, t["time_id"], t["nome_popular"])
            if sc:
                out["artilheiro"] = sc
        past, _ = team_games(t.get("time_id"), t["nome_popular"], ref=ref, agenda=agenda)
        if past:
            out["forma"] = [_result_line(d, side, g, t["nome_popular"]) for d, side, g in past[:5]]
        return out

    def events(kind):
        out = []
        for side in ("mandante", "visitante"):
            src = (m.get("gols") or {}).get(side) if kind == "gols" else ((m.get("cartoes") or {}).get("vermelho") or {}).get(side)
            for g in src or []:
                out.append({"lado": side, "minuto": g.get("minuto_label") or g.get("minuto"), "jogador": (g.get("atleta") or {}).get("nome_popular"),
                            **({"penalti": True} if g.get("penalti") else {}), **({"contra": True} if g.get("gol_contra") else {})})
        return out

    st_ = m.get("estatisticas") or {}
    key_stats = {}
    for k, label in (("posse_de_bola", "posse"), ("finalizacao.total", "finalizacoes"), ("finalizacao.no_gol", "no_gol"), ("escanteios", "escanteios")):
        def g(o):
            for part in k.split("."):
                o = (o or {}).get(part)
            return o
        if st_.get("mandante") and g(st_["mandante"]) is not None:
            key_stats[label] = [g(st_["mandante"]), g(st_["visitante"])]
    minute = m.get("cronometro")
    conf = m.get("confronto") or {}
    started = m.get("status") in ("andamento", "finalizado")
    return {
        "partida_id": pid, "campeonato": camp.get("nome_popular"),
        # rodadas que faltam (no momento do jogo): liga de turno e returno
        "rodadas_restantes": max(0, (len(rows) - 1) * 2 - max(x["j"] for x in snap.values())) if len(snap) >= 10 else None, "fase": (m.get("fase") or {}).get("nome"), "rodada": m.get("rodada"),
        "data": m.get("data_realizacao"), "hora": m.get("hora_realizacao"), "estadio": (m.get("estadio") or {}).get("nome_popular"),
        "status": m.get("status"),
        # minuto em blocos de 15': a análise ao vivo é refeita no máximo a cada 15 minutos de jogo (ou a cada gol)
        "minuto": f"{(minute // 15) * 15}'+" if m.get("status") == "andamento" and isinstance(minute, int) else None,
        "placar": [m.get("placar_mandante"), m.get("placar_visitante")] if started else None,
        "mandante": team(m["time_mandante"]), "visitante": team(m["time_visitante"]),
        "probabilidades_modelo": m.get("probabilidades"), "gols": events("gols"), "expulsoes": events("vermelhos"),
        "estatisticas": key_stats or None,
        "confronto_direto": {k: conf.get(k) for k in ("jogos", "vitorias_mandante", "empates", "vitorias_visitante", "gols")} if conf else None,
    }


# ---------------------------------------------------------------- ferramentas do assistente
def _find_team(nome: str):
    q = _nk(nome)
    best = None
    for c in _comps():
        if not c.get("rodada_atual") and (c.get("tipo") != "Pontos Corridos"):
            continue
        for r in _table(c["campeonato_id"]):
            n = _nk(r["time"]["nome_popular"])
            score = 3 if n == q else 2 if n.startswith(q) or q.startswith(n) else 1 if q in n else 0
            if score and (not best or score > best[0]):
                best = (score, c, r)
    return best


def tools_impl() -> dict:
    srv = _srv()

    def campeonatos():
        return [{"id": c["campeonato_id"], "nome": c.get("nome_popular") or c.get("nome"), "tipo": c.get("tipo"),
                 "rodada_atual": (c.get("rodada_atual") or {}).get("nome"), "fase_atual": (c.get("fase_atual") or {}).get("nome")} for c in _comps()]

    def jogos(campeonato_id: int, data: str):
        day = data or datetime.now(config.BRT).strftime("%Y-%m-%d")
        try:
            want = datetime.strptime(day, "%Y-%m-%d").strftime("%d/%m/%Y")
        except ValueError:
            want = None
        comps = [c for c in _comps() if not campeonato_id or c["campeonato_id"] == campeonato_id]
        out = []
        for c in comps[:8]:
            for m in _current_matches(c):
                if campeonato_id or not want or m.get("data_realizacao") == want:
                    out.append(_line(m))
        # uma linha por jogo: bem menos texto para a IA ler (na IA local, ler é o que mais demora)
        return out[:40] or {"aviso": f"Nenhum jogo em {want or day} na rodada/fase atual dos campeonatos da Vyra."}

    def ao_vivo():
        return [_line(m) for m in (_get("/ao-vivo") or [])] or {"aviso": "Nenhum jogo de futebol rolando agora."}

    def tabela(campeonato_id: int):
        rows = _table(campeonato_id)
        return [_row(r) for r in rows] or {"aviso": "Esse campeonato não tem tabela de pontos corridos."}

    def chances(campeonato_id: int):
        d = _get(f"/campeonatos/{campeonato_id}/chances")
        if not d:
            return {"aviso": "Chances só existem para ligas de pontos corridos."}
        return {"simulacoes": d["simulacoes"], "jogos_restantes": d["jogos_restantes"],
                "times": [{"time": x["time"]["nome_popular"], "pts": x["pontos"], "pontos_esperados": x["pontos_esperados"],
                           "titulo_%": x["titulo"], "zonas_%": x["zonas"]} for x in d["times"]]}

    def partida(partida_id: int):
        try:
            return match_context(partida_id)
        except NotFound:
            return {"aviso": "Partida não encontrada."}

    def buscar_time(nome: str):
        hit = _find_team(nome)
        if not hit:
            return {"aviso": f"Não achei '{nome}' nas tabelas da Vyra."}
        _, c, r = hit
        tid, tn = r["time"]["time_id"], r["time"]["nome_popular"]
        past, nxt = team_games(tid, tn)
        snap = table_after(_table(c["campeonato_id"]), c["campeonato_id"], {"partida_id": 0, "data_realizacao_iso": datetime.now(config.BRT).strftime("%Y-%m-%dT%H:%M:%S%z")})
        out = {"time": tn, "time_id": tid, "campeonato": c.get("nome_popular"), "campeonato_id": c["campeonato_id"], "tabela": _row(r),
               "ultimos_jogos": [_result_line(d, side, g, tn) for d, side, g in past[:5]],
               "proximos_jogos": [_next_line(d, side, g) for d, side, g in nxt[:3]]}
        z = _zone_fact(c["campeonato_id"], snap.get(tid), snap) if snap.get(tid) else None
        if z:
            out["situacao"] = z
        sc = _scorer(c["campeonato_id"], tid, tn)
        if sc:
            out["artilheiro_do_time"] = sc
        live = [g for d, side, g in nxt if g.get("status") == "andamento"]
        if live:
            out["jogando_agora"] = _line(live[0])
        return out

    def noticias(busca: str, campeonato_id: int):
        q = {"por_pagina": "60"}
        if campeonato_id:
            q["campeonato_id"] = str(campeonato_id)
        d = _get("/noticias", q) or {}
        words = [w for w in _nk_words(busca)]
        out = []
        for n in d.get("noticias", []):
            t = _nk(f"{n.get('titulo')} {n.get('resumo') or ''}")
            if all(w in t for w in words):
                out.append({"titulo": n["titulo"], "veiculo": (n.get("provedor") or {}).get("nome"), "quando": n.get("publicado_em"), "link": n.get("link")})
        return out[:10] or {"aviso": "Nenhuma manchete encontrada."}

    def nba(data: str):
        st, body = srv.sports.handle("/nba/jogos", {"data": data} if data else {})
        if st != 200:
            return {"aviso": "NBA indisponível agora."}
        d = json.loads(body)
        return {"data": d["data"], "jogos": [{"id": g["id"], "fora": g["fora"]["nome"], "casa": g["casa"]["nome"], "placar": f"{g['fora']['placar']}-{g['casa']['placar']}" if g["status"] != "agendado" else None,
                                             "status": g["status"], "periodo": g["periodo"], "hora": g["hora"]} for g in d["jogos"]]}

    def f1():
        st, body = srv.sports.handle("/f1", {})
        if st != 200:
            return {"aviso": "F1 indisponível agora."}
        d = json.loads(body)
        return {"proximo_gp": d.get("proxima"), "titulo": d.get("titulo"), "ao_vivo": (d.get("fim_de_semana") or {}).get("ao_vivo"),
                "pilotos": [{"pos": x["posicao"], "piloto": x["piloto"]["nome"], "equipe": (x["piloto"].get("equipe") or {}).get("nome"), "pts": x["pontos"]} for x in d["pilotos"][:12]],
                "construtores": [{"pos": x["posicao"], "equipe": x["equipe"]["nome"], "pts": x["pontos"]} for x in d["construtores"]]}

    def artilharia(campeonato_id: int):
        lst = _get(f"/campeonatos/{campeonato_id}/artilharia")
        if not isinstance(lst, list) or not lst:
            return {"aviso": "A Vyra não tem a artilharia desse campeonato."}
        out = []
        for i, x in enumerate(lst[:10], 1):
            jogos = f" em {x['jogos']} jogos" if x.get("jogos") else ""
            out.append(f"{i}. {(x.get('atleta') or {}).get('nome_popular')} ({clean_name((x.get('time') or {}).get('nome_popular'))}): {x.get('gols')} gols{jogos}")
        return out

    def _f1_id(nome: str):
        st, body = srv.sports.handle("/f1", {})
        if st != 200:
            return None
        q = _nk(nome)
        for x in json.loads(body).get("pilotos") or []:
            p = x["piloto"]
            if q and (q in _nk(p.get("nome")) or _nk(p.get("sobrenome")) in q or q == _nk(p.get("sigla"))):
                return p["id"]
        return None

    def f1_piloto(nome: str):
        did = _f1_id(nome)
        if not did:
            return {"aviso": f"Não achei o piloto '{nome}' na temporada."}
        st, body = srv.sports.handle(f"/f1/piloto/{did}", {})
        if st != 200:
            return {"aviso": "Dados do piloto indisponíveis agora."}
        d = json.loads(body)
        tm = d.get("companheiro") or {}
        temp = d.get("temporada") or []
        return {"piloto": d.get("nome"), "equipe": (d.get("equipe") or {}).get("nome"), "campeonato": d.get("campeonato"),
                "carreira": d.get("carreira"), "ultimas_corridas": [f"{r['gp']}: {r['posicao'] if r.get('classificado') else 'abandonou'} "
                                                                     f"(largou {r.get('largada') or 'box'})" for r in temp[-5:]],
                "companheiro": {"nome": (tm.get("piloto") or {}).get("nome"), "chegou_a_frente": tm.get("corrida"),
                                "classificou_a_frente": tm.get("classificacao"), "pontos": tm.get("pontos")} if tm else None}

    def f1_comparar(nome: str, busca: str):
        a, b = _f1_id(nome), _f1_id(busca)
        if not a or not b or a == b:
            return {"aviso": "Diga os dois pilotos para comparar."}
        st, body = srv.sports.handle(f"/f1/comparar/{a}/{b}", {})
        if st != 200:
            return {"aviso": "Comparação indisponível agora."}
        d = json.loads(body)
        keys = ("pontos", "vitorias", "podios", "poles", "voltas_rapidas", "media_chegada", "media_quali", "abandonos", "melhor")
        return {"a": {"piloto": d["a"]["piloto"]["nome"], **{k: d["a"].get(k) for k in keys}},
                "b": {"piloto": d["b"]["piloto"]["nome"], **{k: d["b"].get(k) for k in keys}},
                "frente_a_frente": {"chegou_a_frente": d["duelo"]["corrida"], "classificou_a_frente": d["duelo"]["classificacao"],
                                    "etapas_em_comum": d["duelo"]["rodadas"]}}

    def nba_classificacao():
        st, body = srv.sports.handle("/nba/classificacao", {})
        if st != 200:
            return {"aviso": "Classificação da NBA indisponível agora."}
        return {c["nome"]: [f"{r['posicao']}. {r['time']['nome']} {r['v']}-{r['d']}" for r in c["times"]] for c in json.loads(body)}

    def nba_time(nome: str):
        st, body = srv.sports.handle("/nba/classificacao", {})
        q = _nk(nome)
        tid = None
        for c in json.loads(body) if st == 200 else []:
            for r in c["times"]:
                t = r["time"]
                if q and (q in _nk(t.get("nome")) or q == _nk(t.get("curto")) or q == _nk(t.get("sigla"))):
                    tid = t["id"]
        if not tid:
            return {"aviso": f"Não achei o time '{nome}' na NBA."}
        st, body = srv.sports.handle(f"/nba/time/{tid}", {})
        if st != 200:
            return {"aviso": "Dados do time indisponíveis agora."}
        d = json.loads(body)
        jogo = lambda g: f"{'vs' if g.get('casa') else '@'} {(g.get('adversario') or {}).get('nome')} {g.get('placar') or ''}-{g.get('placar_adv') or ''} {'V' if g.get('vitoria') else 'D' if g.get('status') == 'finalizado' else g.get('data_iso', '')[:16]}"  # noqa: E731
        return {"time": d.get("nome"), "resumo": d.get("resumo"), "campanha": d.get("campanha"), "tecnico": d.get("tecnico"),
                "ultimos": [jogo(g) for g in (d.get("ultimos") or [])[:5]], "proximos": [jogo(g) for g in (d.get("proximos") or [])[:3]],
                "estatisticas": [f"{x['nome']}: {x['valor']}{f' ({x['rank']}º)' if x.get('rank') else ''}" for x in (d.get("estatisticas") or [])]}

    return {"campeonatos": campeonatos, "jogos": jogos, "ao_vivo": ao_vivo, "tabela": tabela, "chances": chances, "partida": partida,
            "buscar_time": buscar_time, "noticias": noticias, "nba": nba, "f1": f1, "artilharia": artilharia, "f1_piloto": f1_piloto,
            "f1_comparar": f1_comparar, "nba_classificacao": nba_classificacao, "nba_time": nba_time}


def _nk_words(s):
    return [w for w in (_nk(x) for x in (s or "").split()) if len(w) > 2]


# ---------------------------------------------------------------- "Para você"
def foryou_context(team_names: list[str], comp_ids: list[int]) -> tuple[dict, list, list]:
    wanted = {_nk(n) for n in team_names if n}
    comps = {c["campeonato_id"]: c for c in _comps()}
    today = datetime.now(config.BRT).date()
    matches, seen = [], set()
    for m in (_get("/ao-vivo") or []):
        if {_nk(m["time_mandante"]["nome_popular"]), _nk(m["time_visitante"]["nome_popular"])} & wanted:
            seen.add(m["partida_id"])
            matches.append(_m(m))
    for cid in list(dict.fromkeys(comp_ids + list(comps)))[:8]:
        c = comps.get(cid)
        if not c:
            continue
        for m in _current_matches(c):
            if m["partida_id"] in seen:
                continue
            fav = {_nk(m["time_mandante"]["nome_popular"]), _nk(m["time_visitante"]["nome_popular"])} & wanted
            try:
                d = datetime.strptime(m.get("data_realizacao") or "", "%d/%m/%Y").date()
            except ValueError:
                d = None
            if (fav or cid in comp_ids) and d and abs((d - today).days) <= 3:
                seen.add(m["partida_id"])
                matches.append({**_m(m), "time_que_segue": bool(fav)})
    matches.sort(key=lambda x: (not x.get("time_que_segue", True), x["status"] != "andamento", x.get("data") or ""))
    d = _get("/noticias", {"por_pagina": "80"}) or {}
    news = [{"titulo": n["titulo"], "link": n["link"], "veiculo": (n.get("provedor") or {}).get("nome")} for n in d.get("noticias", [])
            if any(_nk(t.get("nome_popular")) in wanted for t in n.get("times") or [])][:10]
    interests = {"times": team_names[:8], "campeonatos": [comps[c].get("nome_popular") for c in comp_ids if c in comps][:6]}
    return interests, matches, news


# ---------------------------------------------------------------- rotas
# última análise de cada jogo: se a IA estiver ocupada, a página mostra esta em vez de um erro
LAST_DIR = config.DATA_DIR / "ia_ultimas"


def _save_last(pid: int, out: dict):
    try:
        LAST_DIR.mkdir(parents=True, exist_ok=True)
        (LAST_DIR / f"{int(pid)}.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _load_last(pid: int) -> dict | None:
    try:
        return json.loads((LAST_DIR / f"{int(pid)}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _err(e):
    return 503, {"message": str(e), "ativo": ai.available()}


def handle_get(path: str, query: dict, ip: str):
    if path == "/ia/status":
        on = ai.available()
        return 200, {"ativo": on, "provedor": ai.provider(), "modelo": ai.model_name() if on else None, "local": ai.provider() == "ollama"}
    if not ai.available():
        return 503, {"message": "IA desligada neste servidor.", "ativo": False}
    if not auth.LIMIT.allow(f"ia:{ip}", 30, 600):
        return 429, {"message": "Muitas análises seguidas. Aguarde alguns minutos."}
    m = re.match(r"^/ia/partida/(\d+)$", path)
    if m:
        pid = int(m.group(1))
        try:
            ctx = match_context(pid)
            out = {"analise": insights.match_insight(ctx), "status": ctx["status"], "gerado_em": datetime.now(config.BRT).isoformat(timespec="minutes")}
            _save_last(pid, out)
            return 200, out
        except NotFound:
            return 404, {"message": "Partida não encontrada."}
        except ai.AIError as e:
            last = _load_last(pid)  # IA ocupada (plano grátis no limite): mostra a última análise deste jogo
            return (200, {**last, "anterior": True}) if last else _err(e)
    if path == "/ia/para-voce":
        teams = [t.strip() for t in (query.get("times") or "").split(",") if t.strip()][:8]
        comps = [int(c) for c in (query.get("campeonatos") or "").split(",") if c.strip().isdigit()][:6]
        if not teams and not comps:
            return 400, {"message": "Siga times ou abra campeonatos para a Vyra conhecer seus interesses."}
        try:
            interests, matches, news = foryou_context(teams, comps)
            if not matches and not news:
                return 200, {"resumo": None, "message": "Nada novo sobre seus times agora."}
            return 200, {"resumo": foryou.briefing(interests, matches, news), "jogos": matches[:14]}
        except ai.AIError as e:
            return _err(e)
    return 404, {"message": "Rota não encontrada."}


def handle_post(path: str, body: dict, ctx: dict):
    if path != "/ia/perguntar":
        return 404, {"message": "Rota não encontrada."}
    if not ai.available():
        return 503, {"message": "IA desligada neste servidor.", "ativo": False}
    user, _ = auth.current(ctx)
    if not user:
        return 401, {"message": "Entre na sua conta para usar o assistente da Vyra."}
    if not auth.LIMIT.allow(f"ask:{user['id']}", 40, 86400) or not auth.LIMIT.allow(f"askm:{user['id']}", 6, 60):
        return 429, {"message": "Você fez muitas perguntas por agora. Tente mais tarde."}
    q = body.get("pergunta")
    if not isinstance(q, str) or not q.strip():
        return 400, {"message": "Escreva uma pergunta."}
    if len(q) > 500:
        return 400, {"message": "Pergunta longa demais (até 500 caracteres)."}
    hist = [h for h in (body.get("historico") or []) if isinstance(h, dict) and isinstance(h.get("content"), str) and len(h["content"]) <= 2000][-6:]
    try:
        return 200, assistant.answer(q.strip(), hist, tools_impl())
    except ai.AIError as e:
        return _err(e)


__all__ = ["handle_get", "handle_post", "match_context", "tools_impl"]
