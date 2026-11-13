"""Outros esportes do Placar: rotas em /api/esportes/... (ver nba.py e f1.py)."""

import json
import re

from .common import NotFound, stats
from .f1 import f1_driver, f1_live, f1_overview, f1_race, f1_race_analysis, f1_team
from .nba import nba_game, nba_live, nba_player, nba_scoreboard, nba_standings, nba_team

__all__ = ["handle", "live_summary", "stats"]


# ================================================================ rotas
ROUTES = [
    (re.compile(r"^/nba/jogos$"), lambda m, q: nba_scoreboard(q.get("data"))),
    (re.compile(r"^/nba/jogo/(\d+)$"), lambda m, q: nba_game(int(m.group(1)))),
    (re.compile(r"^/nba/classificacao$"), lambda m, q: nba_standings()),
    (re.compile(r"^/nba/time/(\d+)$"), lambda m, q: nba_team(int(m.group(1)))),
    (re.compile(r"^/nba/jogador/(\d+)$"), lambda m, q: nba_player(int(m.group(1)))),
    (re.compile(r"^/f1/piloto/([a-z_]+)$"), lambda m, q: f1_driver(m.group(1))),
    (re.compile(r"^/f1/equipe/([a-z_]+)$"), lambda m, q: f1_team(m.group(1))),
    (re.compile(r"^/f1$"), lambda m, q: f1_overview()),
    (re.compile(r"^/f1/corrida/(\d+)$"), lambda m, q: f1_race(int(m.group(1)))),
    (re.compile(r"^/f1/corrida/(\d+)/analise$"), lambda m, q: f1_race_analysis(int(m.group(1)))),
]


def handle(path: str, query: dict | None = None) -> tuple[int, bytes]:
    for rx, fn in ROUTES:
        m = rx.match(path)
        if m:
            try:
                return 200, json.dumps(fn(m, query or {}), ensure_ascii=False).encode()
            except NotFound:
                return 404, b'{"message":"N\\u00e3o encontrado"}'
    return 404, b'{"message":"Rota n\\u00e3o suportada"}'


def live_summary() -> dict:
    """Para a transmissão ao vivo (SSE): jogos da NBA rolando e a sessão de F1 em andamento."""
    return {"nba": nba_live(), "f1": f1_live()}
