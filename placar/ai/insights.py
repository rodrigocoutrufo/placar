"""Análise da partida pela IA: antes do jogo (prévia e palpite), ao vivo (o que está acontecendo) e depois (resumo).

Recebe só dados que o Placar já tem e devolve texto curto em JSON. Para funcionar bem também com modelos
pequenos (IA local), o contexto chega "mastigado": fatos prontos em português (posição, pontos, forma,
probabilidades) e só a instrução do momento do jogo. A resposta fica em cache até o jogo mudar.
"""

import re

from . import client

BASE = """Você é o analista do Placar, um app brasileiro de futebol. Escreva em português do Brasil, como um bom
jornalista esportivo: frases curtas, concretas, sem clichês e sem exageros. Use só os FATOS fornecidos.
Nunca invente lesões, escalações, declarações, posições ou números que não estejam nos fatos. Não diga que
um time "lidera" a tabela se o fato não disser que ele está em 1º lugar.

Devolva:
- titulo: uma manchete de até 70 caracteres;
- resumo: 2 ou 3 frases (instrução abaixo);
- pontos: 3 fatos objetivos, cada um com até 140 caracteres, com números dos fatos;
- palpite: placar (mandante e visitante) e um comentário de uma frase;
- fique_de_olho: uma frase sobre o detalhe que pode decidir (ou decidiu) o jogo."""

MOMENT = {
    "agendado": "O JOGO AINDA NÃO COMEÇOU. resumo: o que está em jogo e quem chega melhor. palpite: o placar final mais provável.",
    "andamento": "O JOGO ESTÁ ACONTECENDO AGORA. resumo: o que o placar, o minuto e as estatísticas mostram. palpite: como deve terminar.",
    "finalizado": "O JOGO JÁ TERMINOU. resumo: como foi e o que o resultado muda na tabela. palpite: repita o placar final.",
}

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["titulo", "resumo", "pontos", "palpite", "fique_de_olho"],
          "properties": {"titulo": {"type": "string"}, "resumo": {"type": "string"},
                         "pontos": {"type": "array", "items": {"type": "string"}},
                         "palpite": {"type": "object", "additionalProperties": False, "required": ["mandante", "visitante", "comentario"],
                                     "properties": {"mandante": {"type": "integer"}, "visitante": {"type": "integer"}, "comentario": {"type": "string"}}},
                         "fique_de_olho": {"type": "string"}}}


def ttl_for(status: str) -> int:
    return {"andamento": 600, "finalizado": 7 * 86400}.get(status, 6 * 3600)


def facts(ctx: dict) -> list[str]:
    """Fatos em português a partir do contexto da partida (o modelo não precisa interpretar JSON cru)."""
    out = []
    h, a = ctx.get("mandante") or {}, ctx.get("visitante") or {}
    comp = " · ".join(x for x in (ctx.get("campeonato"), ctx.get("fase"), ctx.get("rodada")) if x)
    out.append(f"Jogo: {h.get('nome')} (mandante) x {a.get('nome')} (visitante){f' — {comp}' if comp else ''}"
               f"{f', {ctx.get('data')} {ctx.get('hora') or ''}' if ctx.get('data') else ''}{f', {ctx.get('estadio')}' if ctx.get('estadio') else ''}.")
    if ctx.get("placar"):
        out.append(f"Placar {'atual' if ctx.get('status') == 'andamento' else 'final'}: {h.get('nome')} {ctx['placar'][0]} x {ctx['placar'][1]} {a.get('nome')}"
                   f"{f' (por volta dos {ctx.get('minuto')})' if ctx.get('minuto') else ''}.")
    for t in (h, a):
        r = t.get("tabela")
        if r:
            forma = " ".join({"V": "vitória", "E": "empate", "D": "derrota"}.get(x, x) for x in (r.get("ultimos") or ""))
            out.append(f"{t['nome']}: {r['pos']}º lugar, {r['pts']} pontos em {r['j']} jogos ({r['v']} vitórias, {r['e']} empates, {r['d']} derrotas), "
                       f"{r['gp']} gols marcados e {r['gc']} sofridos{f'; últimos jogos: {forma}' if forma else ''}.")
    p = (ctx.get("probabilidades_modelo") or {})
    cur = p.get("ao_vivo") or p.get("pre")
    if cur:
        out.append(f"Modelo do Placar{' (ao vivo)' if p.get('ao_vivo') else ''}: {cur['casa']}% vitória do {h.get('nome')}, {cur['empate']}% empate, "
                   f"{cur['fora']}% vitória do {a.get('nome')}.")
    if p.get("gols_esperados"):
        g = p["gols_esperados"]
        out.append(f"Gols esperados pelo modelo: {h.get('nome')} {g['casa']}, {a.get('nome')} {g['fora']}.")
    for g in ctx.get("gols") or []:
        quem = h.get("nome") if g["lado"] == "mandante" else a.get("nome")
        extra = " (pênalti)" if g.get("penalti") else " (gol contra)" if g.get("contra") else ""
        out.append(f"Gol do {quem}: {g.get('jogador') or 'jogador não informado'} {g.get('minuto') or ''}{extra}.")
    for e in ctx.get("expulsoes") or []:
        out.append(f"Expulsão: {e.get('jogador') or 'jogador'} ({h.get('nome') if e['lado'] == 'mandante' else a.get('nome')}) {e.get('minuto') or ''}.")
    for k, (x, y) in (ctx.get("estatisticas") or {}).items():
        out.append(f"{k.replace('_', ' ').capitalize()}: {h.get('nome')} {x} x {y} {a.get('nome')}.")
    c = ctx.get("confronto_direto") or {}
    if c.get("jogos"):
        out.append(f"Confronto direto (últimos {c['jogos']} jogos): {c.get('vitorias_mandante')} vitórias do {h.get('nome')}, {c.get('empates')} empates, "
                   f"{c.get('vitorias_visitante')} vitórias do {a.get('nome')}, {c.get('gols')} gols.")
    return out


def likely_score(ctx: dict):
    """Placar mais provável pelo modelo de Poisson do Placar (gols esperados), ou o placar atual somado ao resto do jogo."""
    g = (ctx.get("probabilidades_modelo") or {}).get("gols_esperados")
    if not g:
        return None
    from ..core import prob
    best, score = 0.0, (0, 0)
    ph, pa = prob._pmf(g["casa"]), prob._pmf(g["fora"])
    for i, x in enumerate(ph[:7]):
        for j, y in enumerate(pa[:7]):
            if x * y > best:
                best, score = x * y, (i, j)
    return score


def _fix_claims(text: str, ctx: dict) -> str:
    """Corrige o erro mais comum de modelo pequeno: dizer que um time "lidera" sem estar em 1º."""
    for side in ("mandante", "visitante"):
        t = ctx.get(side) or {}
        pos = (t.get("tabela") or {}).get("pos")
        if t.get("nome") and pos and pos != 1:
            text = re.sub(rf"({re.escape(t['nome'])})\s+(lidera|é o líder|segue líder)", rf"\1 está em {pos}º lugar", text, flags=re.I)
    if not any(((ctx.get(s) or {}).get("tabela") or {}).get("pos") == 1 for s in ("mandante", "visitante")):
        text = re.sub(r"\b(manter|defender|buscar manter) a lideran[çc]a\b", r"\1 a posição", text, flags=re.I)
    return text


def match_insight(ctx: dict) -> dict:
    """ctx: dados compactos da partida (ver ai_routes.match_context). Cacheado pelo próprio conteúdo:
    muda o placar, o minuto em blocos de 15' ou o status, muda a análise."""
    status = ctx.get("status", "agendado")
    system = f"{BASE}\n\n{MOMENT.get(status, MOMENT['agendado'])}"
    fs = facts(ctx)
    likely = likely_score(ctx) if status != "finalizado" else None
    if likely:
        fs.append(f"Placar mais provável pelo modelo do Placar: {ctx['mandante']['nome']} {likely[0]} x {likely[1]} {ctx['visitante']['nome']}.")
    data = client.ask_json(system, "FATOS:\n- " + "\n- ".join(fs), SCHEMA, effort="medium", ttl=ttl_for(status))
    # modelos pequenos às vezes numeram os itens ("Fato 1: ...", "1: ..."): fica só o texto
    data["pontos"] = [_fix_claims(re.sub(r"^\s*((fato|ponto)\s*)?\d+\s*[:.)-]\s*", "", p, flags=re.I), ctx) for p in data.get("pontos", []) if p][:4]
    for k in ("titulo", "resumo", "fique_de_olho"):
        data[k] = _fix_claims(data.get(k) or "", ctx)
    # o placar do palpite vem do modelo matemático (ou do placar final), não do texto: sempre coerente com os números
    pal = data.get("palpite") or {}
    if status == "finalizado" and ctx.get("placar"):
        pal.update(mandante=ctx["placar"][0], visitante=ctx["placar"][1])
    elif likely:
        h, a = likely
        if status == "andamento" and ctx.get("placar"):
            h, a = max(h, ctx["placar"][0]), max(a, ctx["placar"][1])
        pal.update(mandante=h, visitante=a)
        pal["comentario"] = re.sub(r"\b\d+\s*[x×-]\s*\d+\b", f"{h}x{a}", pal.get("comentario") or "")
    data["palpite"] = pal
    return data

