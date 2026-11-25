"""Nome atual dos estádios.

As fontes (ESPN, API Futebol, Transfermarkt) demoram a trocar nomes de naming rights e às vezes mandam o nome oficial
longo, que ninguém usa. Aqui fica o nome que o torcedor conhece hoje; o primeiro de cada grupo é o atual e os outros
são os nomes antigos ou formais que chegam das fontes.

Para trocar um nome: coloque o novo no começo do grupo e deixe o antigo na lista (ele continua chegando das fontes e
ajuda a achar o estádio na Wikipédia, que às vezes ainda usa o nome antigo).
"""

import re
import unicodedata

GROUPS = [
    # naming rights (atualizado em novembro de 2026)
    ["Nubank Parque", "Allianz Parque", "Arena Allianz Parque", "Arena Palestra Itália", "Palestra Itália"],  # desde maio de 2026
    ["Arena Acelen Fonte Nova", "Arena Fonte Nova", "Fonte Nova", "Itaipava Arena Fonte Nova", "Casa de Apostas Arena Fonte Nova",
     "Estádio Octávio Mangabeira"],  # desde outubro de 2026 (fim do contrato com a casa de apostas)
    ["Arena da Baixada", "Ligga Arena", "Estádio Mario Celso Petraglia", "Estádio Joaquim Américo Guimarães", "Kyocera Arena"],  # Ligga saiu em 2025
    ["Neo Química Arena", "Arena Corinthians", "Arena de São Paulo", "Itaquerão", "Arena Itaquera"],
    ["MorumBIS", "Morumbi", "Estádio do Morumbi", "Estádio Cícero Pompeu de Toledo"],
    ["Estádio Cícero de Souza Marques", "Estádio Nabi Abi Chedid", "Nabizão"],  # Bragantino: o Nabi foi demolido em 2025 para a nova arena
    # nome formal -> nome conhecido
    ["Maracanã", "Estádio do Maracanã", "Estádio Jornalista Mário Filho"],
    ["Estádio Nilton Santos", "Engenhão", "Estádio Olímpico Nilton Santos", "Estádio Olímpico João Havelange"],
    ["Mineirão", "Estádio Mineirão", "Estádio Governador Magalhães Pinto"],
    ["Beira-Rio", "Estádio Beira-Rio", "Estádio José Pinheiro Borda"],
    ["Vila Belmiro", "Estádio Urbano Caldeira"],
    ["São Januário", "Estádio São Januário", "Estádio Vasco da Gama"],
    ["Arena Castelão", "Castelão", "Estádio Governador Plácido Castelo"],
    ["Barradão", "Estádio Manoel Barradas"],
    ["Couto Pereira", "Estádio Couto Pereira", "Estádio Major Antônio Couto Pereira"],
    ["Ilha do Retiro", "Estádio Adelmar da Costa Carvalho"],
    ["Maião", "Estádio José Maria de Campos Maia"],
]


def _key(s: str | None) -> str:
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(w for w in s.split() if w not in ("estadio", "de", "do", "da"))


_CURRENT = {_key(n): g[0] for g in GROUPS for n in g}
_GROUP = {_key(n): g for g in GROUPS for n in g}


def canonical(name: str | None) -> str | None:
    """Nome atual do estádio (ou o próprio nome, se não estiver na lista)."""
    if not name:
        return name
    return _CURRENT.get(_key(name), name)


def names(name: str | None) -> list:
    """O nome atual primeiro e depois os antigos: para procurar o estádio na Wikipédia."""
    g = _GROUP.get(_key(name))
    return list(g) if g else ([name] if name else [])


def fix(obj):
    """Troca, no lugar, o nome de todo campo "estadio" de uma resposta (partida, rodada, time, perfil do clube)."""
    if isinstance(obj, list):
        for x in obj:
            fix(x)
    elif isinstance(obj, dict):
        for k, v in obj.items():
            if k == "estadio":
                if isinstance(v, str):
                    obj[k] = canonical(v)
                elif isinstance(v, dict):
                    for f in ("nome_popular", "nome"):
                        if isinstance(v.get(f), str):
                            v[f] = canonical(v[f])
            elif isinstance(v, (dict, list)):
                fix(v)
    return obj
