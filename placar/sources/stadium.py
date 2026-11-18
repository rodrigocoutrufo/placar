"""Estádio do clube: foto, localização, capacidade e inauguração (Wikipédia e Wikidata).

O Commons quase não tem fotos 360° de estádios; o passeio 360° vem do Street View (opcional, abaixo).

Tudo grátis e sem chave. A Wikimedia limita bastante quem acessa sem conta, então:
- no máximo 1 requisição a cada 1,5 s, respeitando o Retry-After quando ela pede para esperar;
- cache em disco de 30 dias por estádio (1 dia quando não acha nada).

O Street View do Google é opcional: só aparece se GOOGLE_MAPS_EMBED_KEY estiver no .env. A Maps Embed API é
grátis e sem limite, mas a chave vai dentro do endereço do iframe (é assim que o Google faz); por isso, no Google
Cloud, restrinja essa chave ao seu domínio e só à Maps Embed API.
"""

import hashlib
import json
import os
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request

from .. import config

CACHE_DIR = config.DATA_DIR / "estadios"
TTL, TTL_MISS = 30 * 86400, 86400
UA = {"User-Agent": "Placar/1.0 (placar ao vivo; estadios)"}
WIKI = "https://pt.wikipedia.org/w/api.php"
WD = "https://www.wikidata.org/w/api.php"
EMBED_KEY = os.environ.get("GOOGLE_MAPS_EMBED_KEY", "").strip()

_throttle = threading.Lock()
_last = [0.0]
_locks: dict[str, threading.Lock] = {}


def _get(url, **q):
    q["format"] = "json"
    full = url + "?" + urllib.parse.urlencode(q)
    with _throttle:
        for attempt in range(2):
            wait = 1.5 - (time.time() - _last[0])
            if wait > 0:
                time.sleep(wait)
            _last[0] = time.time()
            try:
                with urllib.request.urlopen(urllib.request.Request(full, headers=UA), timeout=20) as r:
                    return json.load(r)
            except urllib.error.HTTPError as e:
                if e.code != 429 or attempt:
                    raise
                time.sleep(min(int(e.headers.get("Retry-After") or 10), 20))  # pediu para esperar: espera e tenta 1 vez
    return {}


def _norm(s):
    s = unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower()
    return " ".join(re.sub(r"[^a-z0-9]+", " ", s).split())


def _vals(claims, p):
    """Valores de uma propriedade do Wikidata; os de posição "preferida" vêm primeiro."""
    st = [s for s in claims.get(p, []) if s.get("mainsnak", {}).get("datavalue") and s.get("rank") != "deprecated"]
    st.sort(key=lambda s: s.get("rank") != "preferred")
    return [s["mainsnak"]["datavalue"]["value"] for s in st]


def _search_items(text):
    """Busca na Wikipédia em português e devolve os itens do Wikidata dos artigos, na ordem da busca."""
    r = _get(WIKI, action="query", generator="search", gsrsearch=text, gsrlimit=6, prop="pageprops", ppprop="wikibase_item", redirects=1)
    pages = sorted((r.get("query") or {}).get("pages", {}).values(), key=lambda p: p.get("index", 99))
    return [p["pageprops"]["wikibase_item"] for p in pages if p.get("pageprops", {}).get("wikibase_item")]


def _thumb(file, width=1600):
    return f"https://commons.wikimedia.org/wiki/Special:FilePath/{urllib.parse.quote(file.replace(' ', '_'))}?width={width}"


def _build(item):
    e = _get(WD, action="wbgetentities", ids=item, props="claims|labels|descriptions|sitelinks", languages="pt|en")["entities"][item]
    c = e.get("claims", {})
    coord = _vals(c, "P625")[0]
    label = (e.get("labels", {}).get("pt") or e.get("labels", {}).get("en") or {}).get("value")
    desc = (e.get("descriptions", {}).get("pt") or e.get("descriptions", {}).get("en") or {}).get("value")
    caps = [int(float(v["amount"])) for v in _vals(c, "P1083")]
    opened = next((v["time"] for p in ("P1619", "P571") for v in _vals(c, p)), None)
    photo = (_vals(c, "P18") or [None])[0]
    wiki = (e.get("sitelinks", {}).get("ptwiki") or {}).get("title")
    lat, lon = round(coord["latitude"], 6), round(coord["longitude"], 6)
    return {
        "wikidata": item, "nome": label, "descricao": desc,
        "lat": lat, "lon": lon,
        "capacidade": caps[0] if caps else None,
        "inauguracao": int(opened[1:5]) if opened and opened[1:5].isdigit() else None,
        "foto": _thumb(photo) if photo else None,
        "foto_pagina": f"https://commons.wikimedia.org/wiki/File:{urllib.parse.quote(photo.replace(' ', '_'))}" if photo else None,
        "wikipedia": f"https://pt.wikipedia.org/wiki/{urllib.parse.quote(wiki.replace(' ', '_'))}" if wiki else None,
    }


def _find(name, club):
    tries = [t for t in (name, f"{name} estádio" if name else None, f"estádio do {club}" if club else None) if t]
    seen = set()
    for t in tries:
        ids = [i for i in _search_items(t) if i not in seen][:6]
        seen.update(ids)
        if not ids:
            continue
        ents = _get(WD, action="wbgetentities", ids="|".join(ids), props="claims")["entities"]
        for i in ids:  # estádio de verdade: tem coordenadas e capacidade (o clube e as pessoas não têm)
            cl = ents.get(i, {}).get("claims", {})
            if _vals(cl, "P625") and _vals(cl, "P1083"):
                return i
    return None


def lookup(name: str | None, club: str | None = None) -> dict | None:
    key = _norm(name) or _norm(club)
    if not key:
        return None
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    f = CACHE_DIR / (hashlib.sha1(f"{key}|{_norm(club)}".encode()).hexdigest() + ".json")
    lock = _locks.setdefault(f.name, threading.Lock())
    with lock:  # duas visitas ao mesmo tempo fazem uma busca só
        if f.exists():
            saved = json.loads(f.read_text(encoding="utf-8"))
            if time.time() - saved["t"] < (TTL if saved["d"] else TTL_MISS):
                return _with_streetview(saved["d"])
        try:
            item = _find(name, club)
            data = _build(item) if item else None
        except Exception:
            if f.exists():  # Wikimedia fora do ar: usa a cópia antiga
                return _with_streetview(json.loads(f.read_text(encoding="utf-8"))["d"])
            raise
        f.write_text(json.dumps({"t": time.time(), "d": data}, ensure_ascii=False), encoding="utf-8")
        return _with_streetview(data)


def _with_streetview(d):
    if not d:
        return None
    d = dict(d)
    d["streetview"] = (f"https://www.google.com/maps/embed/v1/streetview?key={urllib.parse.quote(EMBED_KEY)}"
                       f"&location={d['lat']},{d['lon']}&fov=90&language=pt-BR") if EMBED_KEY else None
    return d
