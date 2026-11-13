"""Motor de probabilidades do Placar.

Modelo de Poisson (o mesmo princípio usado por casas de estatística esportiva):
- força de ataque e de defesa de cada time = gols por jogo comparados com a média da liga,
  puxados para a média no começo do campeonato (poucos jogos = pouca certeza);
- vantagem de jogar em casa;
- gols esperados de cada lado -> probabilidade de cada placar;
- chances no campeonato: simulação de Monte Carlo de todos os jogos que faltam (milhares de
  campeonatos simulados), contando em que posição cada time termina.
Sem dependências: só a biblioteca padrão.
"""

import bisect
import math
import random
import unicodedata

HOME, AWAY = 1.12, 0.90   # fator de mando de campo sobre a média de gols
SHRINK = 10               # jogos "fictícios" na média: com poucos jogos, a força fica perto da média da liga
MAX_GOALS = 8


def _norm(s):
    return "".join(c for c in unicodedata.normalize("NFD", (s or "").lower()) if c.isalnum())


def ratings(rows):
    """rows: linhas da tabela (formato da API Futebol). Devolve (média de gols, {time_id: (ataque, defesa)})."""
    games = sum(r["jogos"] or 0 for r in rows)
    goals = sum(r["gols_pro"] or 0 for r in rows)
    mu = goals / games if games else 1.3
    out = {}
    for r in rows:
        j = r["jogos"] or 0
        att = ((r["gols_pro"] or 0) / j / mu) if j and mu else 1.0
        dfn = ((r["gols_contra"] or 0) / j / mu) if j and mu else 1.0
        out[r["time"]["time_id"]] = ((j * att + SHRINK) / (j + SHRINK), (j * dfn + SHRINK) / (j + SHRINK))
    return mu, out


def expected_goals(mu, home, away):
    (ah, dh), (aa, da) = home, away
    return mu * ah * da * HOME, mu * aa * dh * AWAY


def _pmf(lam):
    p = [math.exp(-lam)]
    for k in range(1, MAX_GOALS + 1):
        p.append(p[-1] * lam / k)
    return p


def outcome(lh, la, cur=(0, 0), frac=1.0):
    """Probabilidades de vitória do mandante, empate e vitória do visitante.
    cur = placar atual; frac = fração do jogo que ainda falta (1.0 antes de começar)."""
    ph, pa = _pmf(max(lh * frac, 1e-9)), _pmf(max(la * frac, 1e-9))
    win = draw = loss = 0.0
    for i, a in enumerate(ph):
        for j, b in enumerate(pa):
            h, v = cur[0] + i, cur[1] + j
            p = a * b
            if h > v:
                win += p
            elif h == v:
                draw += p
            else:
                loss += p
    t = win + draw + loss or 1
    return {"casa": round(win / t * 100, 1), "empate": round(draw / t * 100, 1), "fora": round(loss / t * 100, 1)}


def _sampler(lh, la, cur, frac):
    ph, pa = _pmf(max(lh * frac, 1e-9)), _pmf(max(la * frac, 1e-9))
    cells = sorted(((a * b, cur[0] + i, cur[1] + j) for i, a in enumerate(ph) for j, b in enumerate(pa)), reverse=True)
    cum, acc = [], 0.0
    for p, _, _ in cells:
        acc += p
        cum.append(acc)
    return cum, [(h, v) for _, h, v in cells]


def simulate(rows, fixtures, zones, sims=None, seed=None):
    """Chances no campeonato.
    rows: tabela atual; fixtures: jogos que faltam [{casa, fora, placar_atual, fracao}] com time_ids;
    zones: [(de, até, chave)] — ex.: (1, 4, "libertadores")."""
    rng = random.Random(seed)
    mu, rat = ratings(rows)
    ids = [r["time"]["time_id"] for r in rows]
    idx = {t: i for i, t in enumerate(ids)}
    n = len(ids)
    base = [[r["pontos"] or 0, r["vitorias"] or 0, r["saldo_gols"] or 0, r["gols_pro"] or 0] for r in rows]
    games = []
    for f in fixtures:
        if f["casa"] not in idx or f["fora"] not in idx:
            continue
        lh, la = expected_goals(mu, rat[f["casa"]], rat[f["fora"]])
        games.append((idx[f["casa"]], idx[f["fora"]], *_sampler(lh, la, f.get("placar_atual") or (0, 0), f.get("fracao", 1.0))))
    sims = sims or max(1000, min(5000, 300000 // max(1, len(games))))
    pos_count = [[0] * n for _ in range(n)]
    pts_sum = [0.0] * n
    for _ in range(sims):
        s = [b[:] for b in base]
        for hi, ai, cum, scores in games:
            h, v = scores[min(bisect.bisect_left(cum, rng.random() * cum[-1]), len(scores) - 1)]
            sh, sa = s[hi], s[ai]
            sh[2] += h - v; sa[2] += v - h; sh[3] += h; sa[3] += v
            if h > v:
                sh[0] += 3; sh[1] += 1
            elif h < v:
                sa[0] += 3; sa[1] += 1
            else:
                sh[0] += 1; sa[0] += 1
        order = sorted(range(n), key=lambda i: (s[i][0], s[i][1], s[i][2], s[i][3], rng.random()), reverse=True)
        for pos, i in enumerate(order):
            pos_count[i][pos] += 1
            pts_sum[i] += s[i][0]
    out = []
    for i, r in enumerate(rows):
        dist = [c / sims * 100 for c in pos_count[i]]
        z = {}
        for lo, hi, key in zones:
            z[key] = round(sum(dist[lo - 1:hi]), 1)
        out.append({"time": r["time"], "posicao_atual": r["posicao"], "pontos": r["pontos"], "jogos": r["jogos"],
                    "titulo": round(dist[0], 1), "zonas": z, "pontos_esperados": round(pts_sum[i] / sims, 1),
                    "posicao_media": round(sum((p + 1) * d for p, d in enumerate(dist)) / 100, 1),
                    "distribuicao": [round(d, 1) for d in dist]})
    out.sort(key=lambda x: (-x["pontos_esperados"], x["posicao_atual"]))
    return {"simulacoes": sims, "jogos_restantes": len(games), "media_gols": round(mu, 2), "times": out}


def name_index(rows, mu_rat):
    """{nome normalizado: (média, (ataque, defesa))} para achar a força de um time pelo nome (copas)."""
    mu, rat = mu_rat
    return {_norm(r["time"]["nome_popular"]): (mu, rat[r["time"]["time_id"]]) for r in rows if r["time"]["time_id"] in rat}
