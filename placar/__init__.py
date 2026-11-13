"""Placar: futebol, NBA e F1 ao vivo.

Pacotes:
  sources/  adaptadores das fontes de dados (ESPN, football-data, Transfermarkt, portais por RSS)
  sports/   NBA e Fórmula 1
  core/     regras do produto: probabilidades, identidade dos times, notícias, contas
  ai/       camada de IA (Claude): classificação de notícias, análises de jogo, assistente, "para você"
  server.py HTTP, rotas /api, tempo real (SSE) e agendador
"""

from . import config  # noqa: F401 — carrega o .env antes de qualquer módulo ler variáveis

__all__ = ["config"]
