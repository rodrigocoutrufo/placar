"""Notícias de portais brasileiros via RSS (feeds públicos que os próprios portais oferecem).

Cada item vem com título, resumo, imagem (quando o feed traz), data e link para a matéria original.
Notícias de outros esportes são descartadas e cada item é marcado com os times citados, para
o filtro por time funcionar com todos os portais. Cache de 10 min em disco.
"""

import email.utils
import gzip
import hashlib
import html
import json
import re
import threading
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta, timezone
from pathlib import Path

from .. import config

BRT = timezone(timedelta(hours=-3))
CACHE_DIR = config.DATA_DIR / "rss"
TTL = 600
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 Placar/5.0"}

# slug: (nome, url, domínio, só futebol?)
FEEDS = {
    "ge": ("ge", "https://ge.globo.com/rss/ge/", "ge.globo.com", False),
    "gazeta": ("Gazeta Esportiva", "https://www.gazetaesportiva.com/feed/", "gazetaesportiva.com", False),
    "trivela": ("Trivela", "https://trivela.com.br/feed/", "trivela.com.br", True),
    "folha": ("Folha", "https://feeds.folha.uol.com.br/esporte/rss091.xml", "folha.uol.com.br", False),
    "estadao": ("Estadão", "https://www.estadao.com.br/arc/outboundfeeds/feeds/rss/sections/esportes/", "estadao.com.br", False),
    "placar": ("Placar", "https://placar.com.br/feed/", "placar.com.br", True),
    "terra": ("Terra", "https://www.terra.com.br/esportes/futebol/rss.xml", "terra.com.br", True),
    "metropoles": ("Metrópoles", "https://www.metropoles.com/esportes/feed", "metropoles.com", False),
    # futebol europeu: o feed geral dos portais brasileiros quase não traz Champions e ligas da Europa
    "ge-int": ("ge", "https://ge.globo.com/rss/ge/futebol/futebol-internacional/", "ge.globo.com", True),
    "ge-ucl": ("ge", "https://ge.globo.com/rss/ge/futebol/futebol-internacional/liga-dos-campeoes/", "ge.globo.com", True),
}
# feeds de um campeonato só: toda notícia deles é desse campeonato
FEED_COMPS = {"ge-ucl": [106]}
OTHER_SPORTS = re.compile(r"\b(f[óo]rmula ?1|f1|nba|nfl|basquete|v[ôo]lei|t[êe]nis|ufc|mma|boxe|nata[çc][ãa]o|atletismo|skate|surfe?|gin[áa]stica|"
                          r"hand(ebol)?|j[úu]d[ôo]|ciclismo|xadrez|automobilismo|stock car|motogp|golfe|beisebol|h[óo]quei|rugby|futsal|beach|"
                          r"(para)?escalada|paral[íi]mpic\w*|esgrima|canoagem|taekwondo|karat[êe]|triatlo|maratona|e-?sports?)\b", re.I)
FOOTBALL = re.compile(r"\b(futebol|gol(s|eiro)?|brasileir[ãa]o|s[ée]rie [abcd]|copa|libertadores|sul-americana|sele[çc][ãa]o|t[ée]cnico|treinador|"
                      r"zagueiro|atacante|meia|volante|lateral|rodada|cl[áa]ssico|campeonato|premier|champions|la liga|est[áa]dio|elenco|"
                      r"contrata[çc][ãa]o|transfer[êe]ncia|escala[çc][ãa]o|vit[óo]ria|derrota|empate|torcida|cbf|fifa|conmebol)\b", re.I)

stats = {"requests": 0, "errors": 0}
_lock = threading.Lock()


def _fetch(url):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    f = CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".xml")
    if f.exists() and time.time() - f.stat().st_mtime < TTL:
        return f.read_bytes()
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=15) as r:
            data = r.read()
        if data[:2] == b"\x1f\x8b":  # alguns feeds vêm compactados mesmo sem pedir
            data = gzip.decompress(data)
        stats["requests"] += 1
        f.write_bytes(data)
        return data
    except Exception:
        stats["errors"] += 1
        return f.read_bytes() if f.exists() else b""  # sem acesso: última cópia


def _strip(s):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s or ""))).strip()


def _image(item, desc_raw):
    for tag in ("{http://search.yahoo.com/mrss/}content", "{http://search.yahoo.com/mrss/}thumbnail", "enclosure"):
        for el in item.iter(tag):
            url = el.get("url")
            if url and (tag != "enclosure" or (el.get("type") or "image").startswith("image")):
                return url
    encoded = item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
    m = re.search(r'<img[^>]+src="([^"]+)"', html.unescape(desc_raw or "") + encoded)
    return m.group(1) if m else None


def _parse(slug, data):
    name, _, domain, football_only = FEEDS[slug]
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return []
    out = []
    for it in root.iter("item"):
        title = _strip(it.findtext("title"))
        link = (it.findtext("link") or "").strip()
        if not title or not link:
            continue
        desc_raw = it.findtext("description") or ""
        summary = _strip(desc_raw)
        cats = " ".join(_strip(c.text) for c in it.findall("category") if c.text)
        text = f"{title} {summary} {cats}"
        if OTHER_SPORTS.search(f"{title} {cats}") or re.search(r" - Ao vivo\b", title):
            continue  # outros esportes e páginas de transmissão
        if not football_only and not FOOTBALL.search(text) and not _teams_in(text):
            continue  # portal de esportes em geral: só entra o que é de futebol
        try:
            pub = email.utils.parsedate_to_datetime(it.findtext("pubDate") or "").astimezone(BRT)
        except (TypeError, ValueError):
            pub = None
        out.append({
            "noticia_id": "rss-" + hashlib.sha1(link.encode()).hexdigest()[:12],
            "titulo": title, "resumo": summary[:280] + ("…" if len(summary) > 280 else "") if summary and summary != title else None,
            "imagem": _image(it, desc_raw), "link": link,
            "publicado_em": pub.strftime("%Y-%m-%dT%H:%M:%S%z") if pub else None,
            "provedor": {"slug": slug, "nome": name, "logo": f"https://www.google.com/s2/favicons?domain={domain}&sz=64"},
            "relevancia": None, "classificacao": {"tipo": "noticia", "assuntos": [], "competicoes": []},
            "times": _teams_in(text), "_comps": FEED_COMPS.get(slug, []),
        })
    return out


# ---------------------------------------------------------------- marcação de times
TEAM_RX: list = [None]  # [(regex, time)], montado a partir dos times conhecidos
NICKNAMES = {
    "Flamengo": ["Mengão"], "Palmeiras": ["Verdão"], "Corinthians": ["Timão"], "Atlético-MG": ["Galo", "Atlético Mineiro"],
    "Cruzeiro": ["Raposa"], "Santos": ["Peixe"], "Internacional": ["Colorado"], "Botafogo": ["Fogão"],
    "Athletico-PR": ["Athletico", "Furacão"], "Vasco": ["Vascão", "Vasco da Gama"], "Bragantino": ["Red Bull Bragantino", "Massa Bruta"],
    "São Paulo": ["Tricolor Paulista"], "Fluminense": ["Tricolor carioca"], "Grêmio": ["Tricolor Gaúcho"], "Bahia": ["Esquadrão"],
}


# nomes de time que também são estádio, cidade ou palavra comum: geram marcação errada
# nomes curtos que aparecem em outros contextos ("Inter" é a Internazionale e o apelido do Internacional;
# "Sport" é palavra comum): não marcam time sozinhos
AMBIGUOUS = {"A definir", "Maracanã", "Nacional", "América", "Independiente", "Universitario", "Liverpool", "Inter", "Athletic",
             "Sport", "Real", "Racing", "Atlético", "União", "Avaí FC"}


def _norm(s):
    return unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()


def set_teams(teams: list[dict]):
    """Recebe os times conhecidos (com time_id, nome_popular, escudo) e prepara a busca nos textos."""
    rx = []
    seen = set()
    for t in teams:
        name = t.get("nome_popular") or ""
        if not name or name in seen or name in AMBIGUOUS:
            continue
        seen.add(name)
        variants = [name] + NICKNAMES.get(name, [])
        pats = "|".join(re.escape(v) for v in sorted(variants, key=len, reverse=True))
        rx.append((re.compile(rf"(?<![\w-])({pats})(?![\w-])"), {k: t.get(k) for k in ("time_id", "nome_popular", "sigla", "escudo", "escudo_escuro")}))
    TEAM_RX[0] = rx


def _teams_in(text):
    out = []
    for rx, t in TEAM_RX[0] or []:
        if rx.search(text):  # busca sensível a maiúsculas: "Santos" (time) e não "santos"
            out.append(t)
    return out[:6]


teams_in = _teams_in  # uso externo: marcar times em notícias de outras fontes (ESPN)


# ---------------------------------------------------------------- API
_items = {"at": 0.0, "data": []}


def all_news() -> list[dict]:
    with _lock:
        if time.time() - _items["at"] < 120 and _items["data"]:
            return _items["data"]
    with ThreadPoolExecutor(max_workers=8) as ex:
        raw = dict(zip(FEEDS, ex.map(lambda s: _fetch(FEEDS[s][1]), FEEDS)))
    # no máximo 25 por portal (os mais recentes): a página não fica dominada por um só veículo
    items = [n for s, d in raw.items() if d for n in sorted(_parse(s, d), key=lambda n: n["publicado_em"] or "", reverse=True)[:30]]
    # o mesmo link pode vir em dois feeds (ge geral, internacional, Liga dos Campeões): fica um, com as dicas somadas
    by_link: dict[str, dict] = {}
    for n in items:
        if n["link"] in by_link:
            by_link[n["link"]]["_comps"] = sorted(set(by_link[n["link"]]["_comps"]) | set(n["_comps"]))
        else:
            by_link[n["link"]] = n
    items = list(by_link.values())
    items.sort(key=lambda n: n["publicado_em"] or "", reverse=True)
    with _lock:
        _items.update(at=time.time(), data=items)
    return items


def providers():
    return [{"slug": s, "nome": v[0], "site": f"https://{v[2]}", "logo": f"https://www.google.com/s2/favicons?domain={v[2]}&sz=64"} for s, v in FEEDS.items()]


def dump(path):  # depuração: python -c "import news_rss; news_rss.dump('x.json')"
    Path(path).write_text(json.dumps(all_news(), ensure_ascii=False, indent=1), encoding="utf-8")
