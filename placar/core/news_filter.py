"""Classificação das notícias: de que esporte é, se é futebol profissional masculino e de quais campeonatos fala.

Duas camadas:
  1. regras (sempre): palavras-chave de cada campeonato, com exclusões (Série B não é Série A,
     feminino e base não entram nos campeonatos principais, outros esportes ficam de fora);
  2. IA (quando ligada): ai/news.py rotula as notícias novas em segundo plano; o rótulo da IA tem
     prioridade sobre as regras.

Filtro de campeonato (matches): entra a notícia que cita o campeonato. Sem campeonato citado, uma notícia
de clube conta para a liga nacional do clube (nunca para copas: transferência do Arsenal não é Champions).
"""

import re

# ligas: aceitam notícia de clube sem campeonato citado (as extras da ESPN também: Argentina, MLS, Arábia...)
DOMESTIC = {10, 14, 101, 102, 103, 104, 105, 107, 108, 211, 213, 214, 221, 222, 233, 234, 235, 236, 237, 238, 239, 251, 252}

COMP_RX = {
    14: r"s[ée]rie\s+b\b(?!\s+(italiana|da\s+it[áa]lia))",
    2: r"copa\s+do\s+brasil(?!\s+(sub|feminin))",
    7: r"libertadores(?!\s+(sub|feminin))",
    9: r"sul-?americana|sudamericana",
    106: r"\bchampions\b(\s+league)?(?!\s+(feminin|da\s+[áa]sia|africana))|liga\s+dos\s+campe[õo]es(?!\s+(feminin|da\s+[áa]sia|africana))",
    101: r"premier\s+league|campeonato\s+ingl[êe]s",
    102: r"la\s?liga|campeonato\s+espanhol",
    103: r"s[ée]rie\s+a\s+(italiana|da\s+it[áa]lia)|campeonato\s+italiano|calcio",
    104: r"bundesliga|campeonato\s+alem[ãa]o",
    105: r"ligue\s+1|campeonato\s+franc[êe]s",
    107: r"liga\s+portugal|campeonato\s+portugu[êe]s|liga\s+betclic|primeira\s+liga",
    108: r"eredivisie|campeonato\s+holand[êe]s",
    # campeonatos extras (ESPN)
    201: r"paulist[ãa]o|campeonato\s+paulista(?!\s+(sub|feminin|da\s+s[ée]rie|a[2-4]))",
    202: r"carioc[ãa]o|campeonato\s+carioca|ta[çc]a\s+guanabara",
    203: r"campeonato\s+mineiro",
    204: r"gauch[ãa]o|campeonato\s+ga[úu]cho",
    205: r"copa\s+do\s+nordeste|nordest[ãa]o",
    211: r"campeonato\s+argentino|liga\s+(profissional\s+)?argentina",
    213: r"campeonato\s+chileno",
    214: r"campeonato\s+uruguaio",
    231: r"europa\s+league|liga\s+europa(?!\s+(feminin|confer))",
    232: r"conference\s+league|liga\s+confer[êe]ncia",
    233: r"\bchampionship\b|segunda\s+divis[ãa]o\s+(inglesa|da\s+inglaterra)",
    234: r"laliga\s*2|laliga\s+hypermotion|segunda\s+divis[ãa]o\s+(espanhola|da\s+espanha)",
    235: r"s[ée]rie\s+b\s+(italiana|da\s+it[áa]lia)|segunda\s+divis[ãa]o\s+(italiana|da\s+it[áa]lia)",
    236: r"2\.?\s*bundesliga|segunda\s+divis[ãa]o\s+(alem[ãa]|da\s+alemanha)",
    237: r"s[üu]per\s+lig|campeonato\s+turco",
    238: r"campeonato\s+belga|jupiler\s+pro\s+league",
    239: r"campeonato\s+escoc[êe]s|scottish\s+premiership",
    240: r"\bfa\s+cup\b|copa\s+da\s+inglaterra",
    241: r"carabao\s+cup|copa\s+da\s+liga\s+inglesa|\bleague\s+cup\b",
    242: r"copa\s+do\s+rei|copa\s+del\s+rey",
    243: r"copa\s+da\s+it[áa]lia|coppa\s+italia",
    244: r"copa\s+da\s+alemanha|dfb-?pokal",
    245: r"copa\s+da\s+fran[çc]a|coupe\s+de\s+france",
    221: r"\bmls\b|major\s+league\s+soccer",
    222: r"liga\s+mx\b|campeonato\s+mexicano",
    251: r"(liga|campeonato)\s+saudita|saudi\s+pro\s+league",
    252: r"j-?league|j1\s+league|campeonato\s+japon[êe]s",
    261: r"liga\s+das\s+na[çc][õo]es|nations\s+league",
}
COMP_RX = {k: re.compile(v, re.I) for k, v in COMP_RX.items()}
BRASILEIRAO = re.compile(r"brasileir[ãa]o|s[ée]rie\s+a\b(?!\s*\d)", re.I)
LOWER_DIV = re.compile(r"s[ée]rie\s+([b-d]|a\s*[2-4])\b|brasileir[ãa]o\s+(da\s+)?s[ée]rie\s+[b-d]", re.I)
ITALY = re.compile(r"it[áa]li|calcio|italian", re.I)
WOMEN = re.compile(r"\bfeminin[oa]s?\b|\bmulheres\b|\bdas\s+meninas\b|\bfutebol\s+de\s+mulheres\b", re.I)
YOUTH = re.compile(r"\bsub-?\s?(1[3-9]|2[0-3])\b|\bcategorias?\s+de\s+base\b|\bjuniores\b|\bcopinha\b|\bjuvenil\b", re.I)
OTHER = re.compile(r"\b(surfe?|wsl|v[ôo]lei|basquete|nba|nbb|superliga|t[êe]nis|ufc|mma|boxe|nata[çc][ãa]o|atletismo|skate|f[óo]rmula\s?1|f1|"
                   r"motogp|stock\s+car|futsal|beach\s+soccer|futev[ôo]lei|handebol|ciclismo|golfe|xadrez|e-?sports?|nfl)\b", re.I)
# outros torneios (estaduais, regionais, seleções): a notícia é desses, não da liga nacional do clube
ELSEWHERE = re.compile(r"paulist[ãa]o|paulista|carioca|mineiro|ga[úu]cho|gauch[ãa]o|piauiense|paraibano|baiano|pernambucano|cearense|catarinense|"
                       r"paranaense|goiano|potiguar|alagoano|sergipano|maranhense|paraense|amazonense|capixaba|mato-grossense|sul-mato-grossense|"
                       r"tocantinense|rondoniense|acreano|amapaense|roraimense|brasiliense|copa\s+(para[íi]ba|do\s+nordeste|verde|rio|fgf|santa\s+catarina)|"
                       r"estadual|amistoso|sele[çc][ãa]o|eliminat[óo]rias|copa\s+do\s+mundo|mundial\s+de\s+clubes", re.I)
# "ex-Grêmio", "passagens por Grêmio e Goiás": o clube citado é o passado do jogador
PAST_CLUB = re.compile(r"\bex-[^\s,.;:]+|passage(m|ns)\s+(por|pelo|pela)[^.;:]*", re.I)


def subject_teams(title: str, names: list[str]) -> list[str]:
    """Times que são o assunto da manchete: citados no título, fora de "ex-X"/"passagens por" e não como
    sobrenome de jogador ("Léo Ceará", "Júnior Viçosa")."""
    clean = PAST_CLUB.sub(" ", title or "")
    out = []
    for name in names:
        for m in re.finditer(re.escape(name), clean):
            before = clean[:m.start()].rstrip().split(" ")[-1] if clean[:m.start()].strip() else ""
            if before and before[0].isupper() and before.lower() not in {"o", "a", "os", "as", "e", "x", "do", "da", "no", "na"}:
                continue  # "Léo Ceará": nome de jogador, não o clube
            out.append(name)
            break
    return out


def rule_labels(item: dict, team_leagues: dict | None = None) -> dict:
    """Rótulos por regras. team_leagues: {nome do time: liga nacional} dos times marcados na notícia."""
    title = item.get("titulo") or ""
    text = f"{title} {item.get('resumo') or ''}"
    esporte = "outro" if OTHER.search(title) else "futebol"
    categoria = "feminino" if WOMEN.search(text) else "base" if YOUTH.search(text) else "profissional_masculino"
    comps = {cid for cid, rx in COMP_RX.items() if rx.search(text)} | set(item.get("_comps") or [])  # feed do próprio campeonato
    lower = LOWER_DIV.search(text)
    if BRASILEIRAO.search(text) and not (lower and not re.search(r"s[ée]rie\s+a\b(?!\s*\d)", text, re.I)) and not ITALY.search(text):
        comps.add(10)
    if 103 in comps:
        comps.discard(10)
    if 235 in comps:  # Série B italiana não é a Série A italiana nem o Brasileirão
        comps -= {10, 14, 103}
    inferred = set()
    if not comps and team_leagues and not ELSEWHERE.search(text) and not lower:
        subj = subject_teams(title, list(team_leagues))
        leagues = {team_leagues[n] for n in subj if team_leagues[n] in DOMESTIC}
        if 0 < len(subj) <= 2 and len(leagues) == 1:  # um clube (ou um jogo entre dois da mesma liga): conta para essa liga
            inferred = leagues
    if not comps and not inferred and item.get("_home") and not ELSEWHERE.search(text):
        inferred = {item["_home"]}  # seção de um país no portal (ge "futebol inglês"): conta para a liga de lá
    return {"esporte": esporte, "categoria": categoria, "competicoes": sorted(comps), "inferidas": sorted(inferred), "origem": "regras",
            "do_feed": sorted(set(item.get("_comps") or []))}


def merge(rules: dict, ai: dict | None) -> dict:
    if not ai:
        return rules
    # a IA decide esporte, categoria e campeonatos citados; quando ela não cita nenhum, vale a liga
    # nacional do clube inferida pelas regras (notícia de bastidor de clube)
    # o feed de um campeonato só (ge Liga dos Campeões, Liga Europa) vale sempre: rótulo antigo da IA não tem os campeonatos novos
    return {"esporte": ai.get("esporte", rules["esporte"]), "categoria": ai.get("categoria", rules["categoria"]),
            "competicoes": sorted(set(ai.get("competicoes") or []) | set(rules.get("do_feed") or [])), "inferidas": rules.get("inferidas", []), "origem": "ia",
            "times_ia": ai.get("times") or []}


def matches(labels: dict, cid: int) -> bool:
    """A notícia entra no filtro do campeonato cid?"""
    if labels["esporte"] != "futebol" or labels["categoria"] != "profissional_masculino":
        return False
    if cid in labels["competicoes"]:
        return True
    return not labels["competicoes"] and cid in DOMESTIC and cid in labels.get("inferidas", [])
