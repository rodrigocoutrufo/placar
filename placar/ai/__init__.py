"""Camada de IA do Placar (Claude). Tudo aqui é opcional: sem ANTHROPIC_API_KEY o site usa as regras normais.

  client.py     chamada única à API: modelo, limite diário, cache, fallback e erros
  news.py       rótulos das notícias (esporte, categoria, campeonatos, times) em segundo plano
  insights.py   análise da partida (antes, durante e depois do jogo)
  assistant.py  "Pergunte ao Placar": responde perguntas consultando os dados do próprio Placar
  foryou.py     resumo do dia "Para você", a partir dos interesses da pessoa
"""
