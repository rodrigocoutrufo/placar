"""Camada de IA da Vyra (Claude). Tudo aqui é opcional: sem ANTHROPIC_API_KEY o site usa as regras normais.

  client.py     chamada única à API: modelo, limite diário, cache, fallback e erros
  news.py       rótulos das notícias (esporte, categoria, campeonatos, times) em segundo plano
  insights.py   análise da partida (antes, durante e depois do jogo)
  assistant.py  "Pergunte à Vyra": responde perguntas consultando os dados da própria Vyra
  foryou.py     resumo do dia "Para você", a partir dos interesses da pessoa
"""
