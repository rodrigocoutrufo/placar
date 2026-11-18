"""'Para você' com IA: um resumo curto do dia a partir dos interesses da pessoa.

O algoritmo da Vyra (public/foryou.js) aprende os interesses no aparelho (times, campeonatos, esportes, com
pesos que decaem no tempo). O navegador manda os principais; o servidor junta os jogos e manchetes ligados a
eles e a IA escreve o resumo, em ordem de importância. Cache por combinação de interesses, por 1 hora.
"""

import json

from . import client

SYSTEM = """Você escreve o "Seu dia no futebol", um resumo pessoal do app Vyra. Português do Brasil, frases curtas,
tom de amigo que entende de futebol. Use só os dados recebidos (jogos e manchetes ligados aos interesses da
pessoa). Ordene do mais importante para o menos: jogo ao vivo ou de hoje de um time que a pessoa segue,
resultados recentes, jogos dos próximos dias, notícias. Não repita a mesma informação. Não invente.

Devolva:
- titulo: até 60 caracteres;
- itens: de 3 a 6, cada um com texto (até 160 caracteres), tipo ("jogo", "noticia", "tabela" ou "outro") e
  ref: o partida_id do jogo citado, o link da notícia citada ou vazio."""

SCHEMA = {"type": "object", "additionalProperties": False, "required": ["titulo", "itens"],
          "properties": {"titulo": {"type": "string"},
                         "itens": {"type": "array", "items": {"type": "object", "additionalProperties": False, "required": ["texto", "tipo", "ref"],
                                                              "properties": {"texto": {"type": "string"},
                                                                             "tipo": {"type": "string", "enum": ["jogo", "noticia", "tabela", "outro"]},
                                                                             "ref": {"type": "string"}}}}}}


def briefing(interests: dict, matches: list[dict], news: list[dict]) -> dict:
    payload = {"interesses": interests, "jogos": matches[:14], "manchetes": news[:10]}
    data = client.ask_json(SYSTEM, json.dumps(payload, ensure_ascii=False), SCHEMA, effort="low", ttl=3600)
    data["itens"] = [i for i in data.get("itens", []) if i.get("texto")][:6]
    return data
