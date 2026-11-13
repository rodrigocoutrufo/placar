"""'Pergunte ao Placar': assistente que responde sobre jogos, tabelas, chances, notícias, NBA e F1.

O modelo não sabe os dados de hoje: ele chama ferramentas (tools) e o Placar responde com os próprios dados
(as mesmas rotas do site). O servidor injeta as implementações em answer(); este módulo só define o
contrato das ferramentas e o fluxo.
"""

import json
from datetime import datetime

from .. import config
from . import client

SYSTEM = """Você é o assistente do Placar, app brasileiro de futebol (com NBA e Fórmula 1).
Responda em português do Brasil, de forma direta e curta (até ~120 palavras, listas quando ajudar).
Use as ferramentas para buscar os dados; nunca invente placares, datas, posições ou notícias. Se uma
ferramenta não trouxer o dado, diga que o Placar não tem essa informação agora. Horários são de Brasília.
Quando citar um jogo, inclua o placar ou o horário. Não responda sobre apostas nem sobre temas fora de esporte."""

_INT = {"type": "integer"}
_STR = {"type": "string"}


def _tool(name, description, props=None):
    props = props or {}
    return {"name": name, "description": description, "strict": True,
            "input_schema": {"type": "object", "properties": props, "required": list(props), "additionalProperties": False}}


TOOLS = [
    _tool("campeonatos", "Lista os campeonatos de futebol do Placar com id, nome e rodada/fase atual."),
    _tool("jogos", "Jogos de futebol. campeonato_id=0 para todos; data no formato AAAA-MM-DD ou vazio para hoje.",
          {"campeonato_id": _INT, "data": _STR}),
    _tool("ao_vivo", "Jogos de futebol em andamento agora, com placar e minuto."),
    _tool("tabela", "Classificação de um campeonato de pontos corridos.", {"campeonato_id": _INT}),
    _tool("chances", "Probabilidades do modelo do Placar de título, vagas e rebaixamento num campeonato.", {"campeonato_id": _INT}),
    _tool("partida", "Detalhes de uma partida (placar, gols, cartões, probabilidade, onde assistir).", {"partida_id": _INT}),
    _tool("buscar_time", "Procura um time pelo nome: campeonato, posição e próximos/últimos jogos.", {"nome": _STR}),
    _tool("noticias", "Manchetes recentes. busca: palavras (pode ser vazio); campeonato_id=0 para todas.", {"busca": _STR, "campeonato_id": _INT}),
    _tool("nba", "Jogos da NBA. data AAAAMMDD (data dos EUA) ou vazio para hoje.", {"data": _STR}),
    _tool("f1", "Fórmula 1: próximo GP com horários, classificação de pilotos e construtores, sessão ao vivo."),
]


def answer(question: str, history: list[dict], tools_impl: dict) -> dict:
    """history: [{"role": "user"|"assistant", "content": str}] (últimas trocas). Devolve {resposta, ferramentas}."""
    now = datetime.now(config.BRT)
    msgs = [m for m in history[-6:] if m.get("role") in ("user", "assistant") and isinstance(m.get("content"), str)]
    msgs.append({"role": "user", "content": f"(Agora: {now:%d/%m/%Y %H:%M}, horário de Brasília)\n{question}"})

    schemas = {t["name"]: t["input_schema"]["properties"] for t in TOOLS}

    def execute(name, args):
        fn = tools_impl.get(name)
        if not fn:
            raise ValueError("ferramenta desconhecida")
        # modelos locais às vezes omitem ou trocam o tipo de um argumento: completa e converte pelo schema
        clean = {}
        for k, spec in schemas.get(name, {}).items():
            v = (args or {}).get(k)
            if spec.get("type") == "integer":
                try:
                    v = int(v or 0)
                except (TypeError, ValueError):
                    v = 0
            else:
                v = "" if v is None else str(v)
            clean[k] = v
        out = fn(**clean)
        text = json.dumps(out, ensure_ascii=False)
        return text[:12000]  # resposta de ferramenta enxuta: o modelo não precisa de tudo

    if client.provider() != "anthropic":  # Gemini e IA local: fluxo fixo (planeja, consulta, responde), ver abaixo
        return _plan_and_answer(question, msgs, execute, tools_impl)
    text, used = client.run_tools(SYSTEM, msgs, TOOLS, execute, effort="medium", max_steps=6)
    return {"resposta": text, "ferramentas": sorted(set(used))}


# ---------------------------------------------------------------- fluxo para modelos locais (pequenos)
# Modelos pequenos se perdem no laço livre de ferramentas (raciocinam em voz alta e não chamam nada).
# Fluxo fixo e mais rápido: 1) a IA escolhe as consultas num JSON com schema; 2) o Placar executa;
# 3) a IA escreve a resposta num JSON. Saída presa ao schema = sem divagação.
PLAN_SYSTEM = """Você planeja consultas para responder perguntas sobre esporte no app Placar.
Escolha de 1 a 2 consultas da lista que trazem os dados necessários. Use os ids de campeonato da lista.
Consultas:
- campeonatos: lista de campeonatos
- jogos: jogos (campeonato_id, ou 0 para todos; data AAAA-MM-DD ou vazio para hoje)
- ao_vivo: jogos de futebol rolando agora
- tabela: classificação (campeonato_id)
- chances: chances de título/rebaixamento (campeonato_id)
- partida: detalhes de um jogo (partida_id)
- buscar_time: dados de um time (nome)
- noticias: manchetes (busca, campeonato_id ou 0)
- nba: jogos da NBA (data AAAAMMDD ou vazio)
- f1: Fórmula 1 (próximo GP, classificação)
Preencha só os campos que a consulta usa; os outros com 0 ou vazio."""

ANSWER_SYSTEM = SYSTEM + "\nResponda só com base nos DADOS abaixo. Se os dados não respondem, diga isso em uma frase."


def _plan_schema():
    return {"type": "object", "additionalProperties": False, "required": ["consultas"], "properties": {"consultas": {
        "type": "array", "items": {"type": "object", "additionalProperties": False,
                                   "required": ["nome", "campeonato_id", "partida_id", "data", "nome_time", "busca"],
                                   "properties": {"nome": {"type": "string", "enum": [t["name"] for t in TOOLS]},
                                                  "campeonato_id": _INT, "partida_id": _INT, "data": _STR, "nome_time": _STR, "busca": _STR}}}}}


def _plan_and_answer(question, msgs, execute, tools_impl):
    comps = tools_impl["campeonatos"]() if "campeonatos" in tools_impl else []
    lista = "\n".join(f"{c['id']}: {c['nome']}" for c in comps) if isinstance(comps, list) else ""
    convo = "\n".join(f"{m['role']}: {m['content']}" for m in msgs[:-1][-4:])
    plan = client.ask_json(PLAN_SYSTEM + f"\n\nCampeonatos (id: nome):\n{lista}",
                           (f"Conversa anterior:\n{convo}\n\n" if convo else "") + f"Pergunta: {question}", _plan_schema(), cache=False)
    used, dados = [], []
    for c in (plan.get("consultas") or [])[:2]:
        name = c.get("nome")
        args = {"campeonato_id": c.get("campeonato_id"), "partida_id": c.get("partida_id"), "data": c.get("data"),
                "nome": c.get("nome_time"), "busca": c.get("busca")}
        try:
            dados.append(f"[{name}] {execute(name, args)[:3500]}")
            used.append(name)
        except Exception as e:  # noqa: BLE001
            dados.append(f"[{name}] erro: {e}")
    now = msgs[-1]["content"].split("\n", 1)[0]
    out = client.ask_json(ANSWER_SYSTEM, f"{now}\nPergunta: {question}\n\nDADOS:\n" + "\n".join(dados),
                          {"type": "object", "additionalProperties": False, "required": ["resposta"], "properties": {"resposta": _STR}}, cache=False)
    return {"resposta": (out.get("resposta") or "").strip(), "ferramentas": sorted(set(used))}
