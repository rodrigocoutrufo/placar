"""Rotas /api/ia/*: ligam a camada de IA (placar/ai) aos dados da própria Vyra.

  GET  /api/ia/status            a IA está ligada? (o site esconde os recursos de IA quando não está)
  GET  /api/ia/partida/{id}      análise da partida (prévia, ao vivo ou resumo)
  GET  /api/ia/para-voce         resumo do dia a partir dos interesses (?times=A,B&campeonatos=10,7)
  POST /api/ia/perguntar         "Pergunte à Vyra" (só com conta: controla o custo por pessoa)
"""

import json
import re
import unicodedata
from datetime import datetime

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


# ---------------------------------------------------------------- análise da partida
def match_context(pid: int) -> dict:
    s = _srv()
    st, body, _ = s.route(f"/partidas/{pid}")
    if st != 200:
        raise NotFound()
    m = json.loads(s.enrich_match(body))
    camp = m.get("campeonato") or {}
    rows = _table(camp.get("campeonato_id")) if camp.get("campeonato_id") else []

    def team(t):
        r = next((x for x in rows if x["time"]["time_id"] == t["time_id"] or _nk(x["time"]["nome_popular"]) == _nk(t["nome_popular"])), None)
        return {"nome": t["nome_popular"], **({"tabela": _row(r)} if r else {})}

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
        "partida_id": pid, "campeonato": camp.get("nome_popular"), "fase": (m.get("fase") or {}).get("nome"), "rodada": m.get("rodada"),
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
        games = [_m(m) for m in _current_matches(c) if r["time"]["time_id"] in (m["time_mandante"]["time_id"], m["time_visitante"]["time_id"])]
        return {"time": r["time"]["nome_popular"], "time_id": r["time"]["time_id"], "campeonato": c.get("nome_popular"),
                "campeonato_id": c["campeonato_id"], "tabela": _row(r), "jogos_da_rodada": games}

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

    return {"campeonatos": campeonatos, "jogos": jogos, "ao_vivo": ao_vivo, "tabela": tabela, "chances": chances, "partida": partida,
            "buscar_time": buscar_time, "noticias": noticias, "nba": nba, "f1": f1}


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
        try:
            ctx = match_context(int(m.group(1)))
            return 200, {"analise": insights.match_insight(ctx), "status": ctx["status"], "gerado_em": datetime.now(config.BRT).isoformat(timespec="minutes")}
        except NotFound:
            return 404, {"message": "Partida não encontrada."}
        except ai.AIError as e:
            return _err(e)
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
