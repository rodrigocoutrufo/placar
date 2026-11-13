"""Perfil completo de jogadores via Transfermarkt.

Mesma abordagem do projeto felipeall/transfermarkt-api (busca + página de perfil + endpoints
JSON internos "ceapi"), embutida aqui sem dependências. A instância pública daquele projeto
(transfermarkt-api.fly.dev) hoje responde 504 nas buscas; se você hospedar a sua, aponte
TRANSFERMARKT_API no .env e este módulo usa ela.

Para incomodar o site o mínimo possível: cache em disco de 24 h (.cache/tm) e no máximo
1 requisição por segundo.
"""

import hashlib
import html
import json
import os
import re
import threading
import time
import unicodedata
import urllib.parse
import urllib.request

from .. import config

BASE = "https://www.transfermarkt.com.br"
API = os.environ.get("TRANSFERMARKT_API", "").rstrip("/")  # instância própria do transfermarkt-api (opcional)
CACHE_DIR = config.DATA_DIR / "tm"
TTL = 24 * 3600
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
      "Accept-Language": "pt-BR,pt;q=0.9"}

_throttle = threading.Lock()
_last = [0.0]


def _norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9 ]+", " ", s).split()


def _text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment or ""))).strip()


def _fetch(url, as_json=False):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    f = CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if f.exists() and time.time() - f.stat().st_mtime < TTL:
        body = json.loads(f.read_text(encoding="utf-8"))["body"]
    else:
        with _throttle:  # no máximo 1 req/s ao Transfermarkt
            wait = 1 - (time.time() - _last[0])
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
            try:
                with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                    body = r.read().decode("utf-8", "replace")
            except Exception:
                if f.exists():  # sem acesso: usa a cópia antiga
                    body = json.loads(f.read_text(encoding="utf-8"))["body"]
                else:
                    raise
        # página de bloqueio/erro do site (curta ou com captcha) não vai para o cache: senão o jogador
        # ficaria "não encontrado" por 24 h
        if as_json or (len(body) > 3000 and "captcha" not in body[:5000].lower()):
            f.write_text(json.dumps({"url": url, "body": body}), encoding="utf-8")
    return json.loads(body) if as_json else body


# ---------------------------------------------------------------- busca
def search(name: str) -> list[dict]:
    page = _fetch(f"{BASE}/schnellsuche/ergebnis/schnellsuche?query={urllib.parse.quote(name)}")
    out = []
    for m in re.finditer(r'<td class="hauptlink"><a title="([^"]+)" href="/[^"]+/profil/spieler/(\d+)">', page):
        row = page[m.end(): page.find("</tr> <tr", m.end()) if page.find("</tr> <tr", m.end()) > 0 else m.end() + 3000]
        club = re.search(r'<a title="([^"]+)" href="/[^"]+/startseite/verein/\d+"', row)
        age = re.search(r'<td class="zentriert">(\d{1,2})</td>', row)
        value = re.search(r'<td class="rechts hauptlink">([^<]*)</td>', row)
        out.append({"id": int(m.group(2)), "nome": html.unescape(m.group(1)), "clube": html.unescape(club.group(1)) if club else None,
                    "idade": int(age.group(1)) if age else None, "valor": value.group(1).strip() if value else None})
    return out


def _score(hit, name, club, age):
    hn, qn = set(_norm(hit["nome"])), set(_norm(name))
    s = len(hn & qn) * 3 - len(qn - hn)
    if club and hit["clube"]:
        cn = set(_norm(club)) - {"fc", "ec", "sc", "cr", "se", "ac", "club", "clube", "de", "do", "da"}
        s += 4 * len(cn & set(_norm(hit["clube"])))
    if age and hit["idade"] is not None:
        s += 2 if abs(hit["idade"] - age) <= 1 else -2
    return s


_STOP = {"fc", "ec", "sc", "cr", "se", "ac", "club", "clube", "de", "do", "da", "esporte", "futebol", "sport"}


def _club_matches(a, b):
    return bool((set(_norm(a)) - _STOP) & (set(_norm(b)) - _STOP))


def _squad_lookup(name, club):
    """Desempate pelo elenco do clube (nomes curtos como "Pedro" têm centenas de homônimos)."""
    page = _fetch(f"{BASE}/schnellsuche/ergebnis/schnellsuche?query={urllib.parse.quote(club)}")
    clubs = [(html.unescape(t), i) for t, i in re.findall(r'<a title="([^"]+)" href="/[^"]+/startseite/verein/(\d+)"', page)]
    # o clube cujo nome bate, de preferência o time principal (sem "U20", "Sub-23", "B"...)
    clubs = [c for c in clubs if _club_matches(c[0], club)]
    clubs.sort(key=lambda c: bool(re.search(r"\b(U\d{2}|Sub[- ]?\d{2}|B|II|Fem|Women)\b", c[0], re.I)))
    if not clubs:
        return None
    club_name, club_id = clubs[0]
    squad = _fetch(f"{BASE}/x/kader/verein/{club_id}")
    players = {int(i): html.unescape(n) for i, n in re.findall(r'<td class="hauptlink">\s*<a href="/[^"]+/profil/spieler/(\d+)"[^>]*>\s*([^<]+?)\s*</a>', squad)}
    qn = set(_norm(name))
    scored = sorted(((len(set(_norm(n)) & qn) * 3 - len(set(_norm(n)) ^ qn), i, n) for i, n in players.items()), reverse=True)
    if scored and scored[0][0] > 0:
        return {"id": scored[0][1], "nome": scored[0][2], "clube": club_name, "idade": None, "valor": None}
    return None


def find(name: str, club: str | None = None, age: int | None = None) -> dict | None:
    hits = search(name)
    if not hits and len(name.split()) > 1:  # "Kevin Viveros" -> "Viveros"
        hits = search(name.split()[-1])
    best = max(hits, key=lambda h: _score(h, name, club, age)) if hits else None
    if club and (not best or not best["clube"] or not _club_matches(best["clube"], club)):
        squad_hit = _squad_lookup(name, club)
        if squad_hit:
            return squad_hit
    return best if best and _score(best, name, club, age) > 0 else None


# ---------------------------------------------------------------- perfil
def _info_table(page):
    pairs = re.findall(r'info-table__content--regular">\s*(.*?)\s*</span>\s*<span class="info-table__content info-table__content--bold[^"]*">(.*?)</span>\s*(?=<span class="info-table__content info-table__content--regular|</div>)', page, re.S)
    return {_text(k).rstrip(":"): v for k, v in pairs}


def profile(pid: int) -> dict:
    page = _fetch(f"{BASE}/x/profil/spieler/{pid}")
    info = _info_table(page)
    head = re.search(r'data-header__headline-wrapper">(.*?)</h1>', page, re.S)
    number = re.search(r'data-header__shirt-number">\s*#?(\d+)', page)
    photo = re.search(r'src="([^"]+/portrait/header/[^"]+)"', page)
    value = re.search(r'data-header__market-value-wrapper">(.*?)<span class="data-header__last-update">\s*(.*?)</span>', page, re.S)
    born = re.search(r"(\d{2}/\d{2}/\d{4})\s*\((\d+)\)", _text(info.get("Nasc./Idade", "")))
    flags = re.findall(r'<img src="([^"]+/flagge/[^"]+)" title="([^"]+)"', info.get("Nacionalidade", ""))
    club_html = info.get("Clube atual", "")
    club_logo = re.search(r'srcset="([^" ]+)', club_html) or re.search(r'src="([^"]+wappen[^"]+)"', club_html)
    titles = [{"titulo": html.unescape(t), "quantidade": int(n)} for t, n in re.findall(
        r'<a[^>]*title="([^"]+)"[^>]*class="data-header__success-data"[^>]*>.*?data-header__success-number">\s*(\d+)', page, re.S)]
    name = _text(head.group(1)) if head else ""
    name = re.sub(r"^#\d+\s*", "", name)
    return {
        "transfermarkt_id": pid,
        "nome": name,
        "nome_completo": _text(info.get("Nome no país de origem") or info.get("Nome completo")) or None,
        "foto": photo.group(1) if photo and "default" not in photo.group(1) else None,
        "camisa": number.group(1) if number else None,
        "nascimento": born.group(1) if born else None,
        "idade": int(born.group(2)) if born else None,
        "naturalidade": _text(info.get("Local de nascimento")) or None,
        "altura": _text(info.get("Altura")) or None,
        "nacionalidades": [{"nome": html.unescape(t), "bandeira": u} for u, t in flags],
        "posicao": _text(info.get("Posição")) or None,
        "pe": _text(info.get("Pé")) or None,
        "empresario": _text(info.get("Empresários") or info.get("Agente")) or None,
        "clube": {"nome": _text(club_html) or None, "escudo": club_logo.group(1) if club_logo else None},
        "no_clube_desde": _text(info.get("No time desde")) or None,
        "contrato_ate": _text(info.get("Contrato até")) or None,
        "valor_mercado": _text(value.group(1)) if value else None,
        "valor_atualizado_em": _text(value.group(2)).replace("Última alteração:", "").strip() if value else None,
        "titulos": titles,
        "url": f"{BASE}/x/profil/spieler/{pid}",
    }


def market_value(pid: int) -> dict:
    d = _fetch(f"{BASE}/ceapi/marketValueDevelopment/graph/{pid}", as_json=True)
    return {
        "atual": d.get("current"), "maior": d.get("highest"), "maior_em": d.get("highest_date"), "atualizado_em": d.get("last_change"),
        "historico": [{"data": p.get("datum_mw"), "timestamp": p.get("x"), "valor": p.get("y"), "valor_fmt": p.get("mw"),
                       "clube": p.get("verein"), "idade": p.get("age"), "escudo": p.get("wappen") or None} for p in d.get("list", [])],
    }


def transfers(pid: int) -> dict:
    d = _fetch(f"{BASE}/ceapi/transferHistory/list/{pid}", as_json=True)
    side = lambda s: {"clube": s.get("clubName"), "escudo": s.get("clubEmblem-2x") or s.get("clubEmblem-1x"), "bandeira": s.get("countryFlag")}
    return {
        "total_taxas": d.get("formattedFeeSum"),
        "lista": [{"data": t.get("date"), "temporada": t.get("season"), "de": side(t.get("from") or {}), "para": side(t.get("to") or {}),
                   "taxa": _text(t.get("fee") or ""), "valor_mercado": t.get("marketValue"), "futura": bool(t.get("futureTransfer"))}
                  for t in d.get("transfers", [])],
    }


# ---------------------------------------------------------------- títulos
_TITLE_PT = {
    "colombian cup winner": "Campeão da Copa da Colômbia", "colombian super cup winner": "Campeão da Supercopa da Colômbia",
    "derby of the americas champion": "Campeão do Derby das Américas", "challenger cup champion": "Campeão da Challenger Cup",
    "champions league winner": "Campeão da Champions League", "europa league winner": "Campeão da Europa League",
    "uefa super cup winner": "Campeão da Supercopa da UEFA", "club world cup winner": "Campeão do Mundial de Clubes",
    "fifa club world cup winner": "Campeão do Mundial de Clubes da FIFA", "intercontinental cup winner": "Campeão da Copa Intercontinental",
    "copa libertadores winner": "Campeão da Libertadores", "copa sudamericana winner": "Campeão da Sul-Americana",
    "recopa sudamericana winner": "Campeão da Recopa Sul-Americana", "world cup winner": "Campeão da Copa do Mundo",
    "copa america winner": "Campeão da Copa América", "olympic medalist": "Medalhista olímpico", "top goal scorer": "Artilheiro",
    "english champion": "Campeão inglês", "spanish champion": "Campeão espanhol", "italian champion": "Campeão italiano",
    "german champion": "Campeão alemão", "french champion": "Campeão francês", "portuguese champion": "Campeão português",
    "dutch champion": "Campeão holandês", "argentinian champion": "Campeão argentino", "uruguayan champion": "Campeão uruguaio",
    "english fa cup winner": "Campeão da FA Cup", "spanish cup winner": "Campeão da Copa do Rei", "italian cup winner": "Campeão da Copa da Itália",
    "german cup winner": "Campeão da Copa da Alemanha", "french cup winner": "Campeão da Copa da França",
}


def _title_pt(t):
    t = html.unescape(t).strip()
    k = t.lower()
    if k in _TITLE_PT:
        return _TITLE_PT[k]
    m = re.match(r"^(.*) (champion|winner)$", t, re.I)
    if m:  # "Xyz Champion" -> "Campeão Xyz" (nomes próprios de torneio ficam como estão)
        return f"Campeão {m.group(1)}"
    return t


def player_titles(pid: int) -> list[dict]:
    """Títulos do jogador com temporadas e clubes (página "Títulos" do Transfermarkt)."""
    page = _fetch(f"{BASE}/x/erfolge/spieler/{pid}")
    out = []
    for box in re.split(r'<div class="box">', page)[1:]:
        h = re.search(r'<h2 class="content-box-headline">\s*(\d+)x\s*(.*?)\s*</h2>', box, re.S)
        if not h:
            continue
        img = re.search(r'erfolg_bild_box">\s*<img src="([^"]+)"', box)
        entries = []
        for season, row in re.findall(r'<td class="erfolg_table_saison[^"]*">\s*([^<]*?)\s*</td>(.*?)</tr>', box, re.S):
            club = re.search(r'<a title="([^"]+)"[^>]*>\s*<img src="([^"]+)"', row)
            entries.append({"temporada": season, "clube": html.unescape(club.group(1)) if club else None, "escudo": club.group(2) if club else None})
        out.append({"titulo": _title_pt(h.group(2)), "quantidade": int(h.group(1)), "imagem": img.group(1) if img else None, "conquistas": entries})
    return out


def club_titles(cid: int) -> list[dict]:
    page = _fetch(f"{BASE}/x/erfolge/verein/{cid}")
    out = []
    for box in re.split(r'<div class="box">', page)[1:]:
        h = re.search(r'<div class="header">\s*<h2>\s*(\d+)x\s*(.*?)\s*</h2>', box, re.S)
        if not h:
            continue
        img = re.search(r'erfolg_bild_box">\s*<img src="([^"]+)"', box)
        seasons = re.search(r'erfolg_infotext_box">(.*?)</div>', box, re.S)
        out.append({"titulo": _title_pt(h.group(2)), "quantidade": int(h.group(1)), "imagem": img.group(1) if img else None,
                    "temporadas": [s.strip() for s in _text(seasons.group(1)).split(",") if s.strip()] if seasons else []})
    for t in out:
        t["categoria"] = _title_tier(t["titulo"])[1]
    return sorted(out, key=lambda t: (_title_tier(t["titulo"])[0], -t["quantidade"]))


_TIERS = [
    (0, "Mundial", r"mundial|copa do mundo|intercontinental|world"),
    (1, "Continental", r"libertadores|champions|sul-?americana|sudamericana|recopa|uefa|europe|taça das taças|copa dos clubes campeões|conmebol|conference|europa league"),
    (2, "Liga nacional", r"campeão brasileiro|campeão de |campeão (inglês|espanhol|italiano|alemão|francês|português|holandês)|série b|segunda divisão|bundesliga|premier|serie a|la liga|eredivisie|ligue 1"),
    (3, "Copa nacional", r"copa do brasil|supercopa do brasil|taça fa|fa cup|copa do rei|copa da |taça de |supertaça|supercopa|league cup|taça da liga|dfb|coppa"),
    (4, "Estadual", r"carioca|paulista|mineiro|gaúcho|baiano|paranaense|pernambucano|cearense|goiano|catarinense|estadual|rio-são paulo"),
]


def _title_tier(t):
    k = t.lower()
    for rank, label, rx in _TIERS:
        if re.search(rx, k):
            return rank, label
    return 5, "Outros"


# ---------------------------------------------------------------- clubes
CLUB_ALIASES = {
    "atletico-mg": "Atlético Mineiro", "atletico-go": "Atlético Goianiense", "athletico-pr": "Athletico Paranaense",
    "bragantino": "Red Bull Bragantino", "vasco": "Vasco da Gama", "sport": "Sport Recife", "america-mg": "América Mineiro",
    "botafogo-sp": "Botafogo-SP", "operario-pr": "Operário Ferroviário", "man city": "Manchester City",
    "man united": "Manchester United", "atleti": "Atlético de Madrid", "barca": "FC Barcelona", "inter": "Inter de Milão",
    "spurs": "Tottenham Hotspur", "psg": "Paris Saint-Germain", "bayern": "Bayern de Munique",
}
COUNTRY_TM = {"England": "Inglaterra", "Spain": "Espanha", "Italy": "Itália", "Germany": "Alemanha", "France": "França",
              "Portugal": "Portugal", "Netherlands": "Holanda", "Brazil": "Brasil", "Argentina": "Argentina"}


def club_search(name: str) -> list[dict]:
    page = _fetch(f"{BASE}/schnellsuche/ergebnis/schnellsuche?query={urllib.parse.quote(name)}")
    i = page.find('id="club-grid"')
    if i < 0:
        return []
    block = page[i: i + 60000]  # só a tabela de clubes
    out = []
    for row in re.findall(r'<tr class="(?:odd|even)">(.*?)</tr>\s*(?=<tr class="(?:odd|even)">|</tbody>)', block, re.S):
        m = re.search(r'<td class="hauptlink"><a title="([^"]+)" href="/[^"]+/startseite/verein/(\d+)"', row)
        if not m:
            continue
        country = re.search(r'class="zentriert"><img src="[^"]+/flagge/[^"]+" title="([^"]+)"', row)
        league = re.search(r'/startseite/wettbewerb/[^"]+">([^<]+)</a>', row)
        value = re.search(r'<td class="rechts">([^<]*)</td>', row)
        out.append({"id": int(m.group(2)), "nome": html.unescape(m.group(1)), "pais": html.unescape(country.group(1)) if country else None,
                    "liga": html.unescape(league.group(1)) if league else None, "valor": value.group(1) if value else None})
    return out


def club_find(name: str, full_name: str | None = None, country: str | None = None) -> dict | None:
    key = re.sub(r"\s+", " ", unicodedata.normalize("NFD", name or "").encode("ascii", "ignore").decode().lower()).strip()
    queries = [q for q in (CLUB_ALIASES.get(key), full_name, name) if q]
    country = COUNTRY_TM.get(country, country)
    for q in dict.fromkeys(queries):
        hits = [h for h in club_search(q) if not re.search(r"\b(U\d{2}|Sub[- ]?\d{2}|B|II|Fem|Women|Feminino)\b", h["nome"], re.I)]
        if country:
            hits = [h for h in hits if h["pais"] == country] or hits
        hits = [h for h in hits if _club_matches(h["nome"], q) or _club_matches(h["nome"], name)]
        if hits:
            return hits[0]
    return None


def club_profile(cid: int) -> dict:
    page = _fetch(f"{BASE}/x/startseite/verein/{cid}")
    items = dict((_text(k).rstrip(":"), v) for k, v in re.findall(
        r'<li class="data-header__label">\s*(.*?)<span itemprop="dataItem" class="data-header__content">(.*?)</span>\s*</li>', page, re.S))
    value = re.search(r'data-header__market-value-wrapper">(.*?)<p class="data-header__last-update">', page, re.S)
    name = re.search(r'<h1 class="data-header__headline-wrapper[^"]*">(.*?)</h1>', page, re.S)
    crest = re.search(r'<img src="([^"]+/wappen/head/[^"]+)"', page) or re.search(r'data-header__profile-container">\s*<img src="([^"]+)"', page)
    stadium = items.get("Estádio", "")
    cap = re.search(r'tabellenplatz">([^<]+)<', stadium)
    foreign = items.get("Estrangeiros", "")
    foreign_pct = re.search(r'tabellenplatz">([^<]+)<', foreign)
    league = re.search(r'data-header__club">\s*<a[^>]*title="([^"]+)"', page)
    return {
        "transfermarkt_id": cid, "nome": _text(name.group(1)) if name else None, "escudo": crest.group(1) if crest else None,
        "valor_mercado": _text(value.group(1)) if value else None,
        "plantel": _text(items.get("Jogadores no plantel")) or None, "idade_media": _text(items.get("Média etária")) or None,
        "estrangeiros": _text(re.sub(r'<span class="tabellenplatz">.*?</span>', "", foreign)) or None,
        "estrangeiros_pct": foreign_pct.group(1).strip() if foreign_pct else None,
        "selecao": _text(items.get("Jogadores de Seleção")) or None,
        "estadio": _text(re.sub(r'<span class="tabellenplatz">.*?</span>', "", stadium)) or None,
        "capacidade": cap.group(1).strip() if cap else None,
        "balanco_transferencias": _text(items.get("Balanço atual de transferência")) or None,
        "liga": html.unescape(league.group(1)) if league else None,
        "url": f"{BASE}/x/startseite/verein/{cid}",
    }


def club_squad(cid: int) -> list[dict]:
    page = _fetch(f"{BASE}/x/kader/verein/{cid}/plus/1")
    i = page.find('class="items"')
    out = []
    for row in re.findall(r'<tr class="(?:odd|even)">(.*?)</tr>\s*(?=<tr class="(?:odd|even)">|</tbody>)', page[i:], re.S):
        link = re.search(r'<td class="hauptlink">\s*<a href="/[^"]+/profil/spieler/(\d+)">\s*([^<]+?)\s*</a>', row)
        if not link:
            continue
        num = re.search(r'rn_nummer>([^<]*)<', row)
        pos = re.search(r'</td>\s*</tr>\s*<tr>\s*<td>\s*([^<]+?)\s*</td>', row)
        photo = re.search(r'data-src="([^"]+/portrait/[^"]+)"', row)
        tds = re.findall(r'<td class="zentriert">(.*?)</td>', row, re.S)
        dob = re.search(r"(\d{2}/\d{2}/\d{4})\s*\((\d+)\)", row)
        flags = re.findall(r'<img src="([^"]+/flagge/[^"]+)" title="([^"]+)"', row)
        value = re.search(r'<td class="rechts hauptlink">(.*?)</td>', row, re.S)
        texts = [_text(t) for t in tds]
        height = next((t for t in texts if re.match(r"^\d,\d{2}\s?m$", t)), None)
        foot = next((t for t in texts if t in ("direito", "esquerdo", "ambidestro")), None)
        dates = [t for t in texts if re.match(r"^\d{2}/\d{2}/\d{4}$", t)]
        out.append({"transfermarkt_id": int(link.group(1)), "nome": html.unescape(link.group(2)), "camisa": (num.group(1) if num else "").replace("-", ""),
                    "posicao": html.unescape(pos.group(1)) if pos else None,
                    "foto": photo.group(1) if photo and "default" not in photo.group(1) else None,
                    "nascimento": dob.group(1) if dob else None, "idade": int(dob.group(2)) if dob else None,
                    "nacionalidades": [{"nome": html.unescape(t), "bandeira": u} for u, t in flags[:2]],
                    "altura": height, "pe": foot, "no_clube_desde": dates[0] if dates else None,
                    "contrato_ate": dates[1] if len(dates) > 1 else None, "valor_mercado": _text(value.group(1)) if value else None})
    return out


def club(name: str, full_name: str | None = None, country: str | None = None) -> dict | None:
    """Perfil do clube, títulos e elenco detalhado de uma vez."""
    hit = club_find(name, full_name, country)
    if not hit:
        return None
    out = club_profile(hit["id"])
    out["pais"] = hit.get("pais")
    for key, fn in (("titulos", club_titles), ("elenco", club_squad)):
        try:
            out[key] = fn(hit["id"])
        except Exception:  # um bloco indisponível não derruba o resto
            out[key] = []
    return out


def player(name: str, club: str | None = None, age: int | None = None) -> dict | None:
    """Encontra o jogador pelo nome (e clube/idade para desempatar) e devolve tudo de uma vez."""
    hit = find(name, club, age)
    if not hit:
        return None
    out = profile(hit["id"])
    for key, fn in (("mercado", market_value), ("transferencias", transfers), ("titulos_detalhes", player_titles)):
        try:
            out[key] = fn(hit["id"])
        except Exception:  # um bloco indisponível não derruba o perfil
            out[key] = None
    if out.get("mercado"):
        out["valor_mercado"] = out["mercado"]["atual"]
        out["valor_atualizado_em"] = out["mercado"]["atualizado_em"]
    return out
