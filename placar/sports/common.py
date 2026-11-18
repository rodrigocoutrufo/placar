"""Base comum de NBA e F1: HTTP com cache, erros e conversões. Outros esportes da Vyra: basquete (NBA, pela ESPN) e Fórmula 1 (Jolpica/Ergast + ESPN para a sessão ao vivo).

Tudo normalizado em português, com cache em memória e uso do último dado bom se a fonte cair.
Rotas (via server.py, em /api/esportes/...):
  /nba/jogos?data=AAAAMMDD   jogos do dia (data dos EUA; sem data = rodada atual da ESPN)
  /nba/jogo/{id}             placar por quarto, box score (titulares e reservas), chance de vitória e lances
  /nba/classificacao         Leste e Oeste
  /f1                        próximo GP com sessões, sessão ao vivo, calendário, pilotos e construtores
  /f1/corrida/{rodada}       resultado, grid e classificação da etapa
"""

import json
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))
NBA = "https://site.api.espn.com/apis/site/v2/sports/basketball/nba"
NBA_STANDINGS = "https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings"
F1_ESPN = "https://site.api.espn.com/apis/site/v2/sports/racing/f1/scoreboard"
JOLPICA = "https://api.jolpi.ca/ergast/f1"

_cache: dict[str, tuple[float, object]] = {}
_lock = threading.Lock()
stats = {"requests": 0, "errors": 0}


class NotFound(Exception):
    pass


def _get(url: str, ttl: float):
    now = time.time()
    with _lock:
        hit = _cache.get(url)
    if hit and hit[0] > now:
        return hit[1]
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 PlacarAoVivo/3.0", "Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=20) as r:
            data = json.loads(r.read())
        stats["requests"] += 1
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        stats["errors"] += 1
        if hit:  # fonte fora do ar: último dado bom
            return hit[1]
        if isinstance(e, urllib.error.HTTPError) and e.code in (400, 404):
            raise NotFound(url) from e
        raise
    with _lock:
        _cache[url] = (now + ttl, data)
        if len(_cache) > 2000:
            for k in sorted(_cache, key=lambda k: _cache[k][0])[:500]:
                _cache.pop(k, None)
    return data


def _dt(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def _iso(d):
    return d.astimezone(BRT).strftime("%Y-%m-%dT%H:%M:%S%z") if d else None


def _int(v, default=None):
    try:
        return int(float(v))
    except (TypeError, ValueError):
        return default


