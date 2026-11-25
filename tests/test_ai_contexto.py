"""Fatos que a IA recebe (placar/ai_routes.py e placar/ai/insights.py): tabela no momento do jogo, zonas, nomes e
forma recente. Tudo com dados de mentira: nenhuma fonte de dados nem IA é consultada."""

import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="vyra-ctx-"))
for k in ("ANTHROPIC_API_KEY", "GEMINI_API_KEY"):
    os.environ[k] = ""

from placar import ai_routes as r  # noqa: E402
from placar.ai import insights  # noqa: E402


def row(tid, nome, pts, j, v, e, d, gp, gc):
    return {"posicao": 0, "time": {"time_id": tid, "nome_popular": nome}, "pontos": pts, "jogos": j, "vitorias": v, "empates": e,
            "derrotas": d, "gols_pro": gp, "gols_contra": gc, "saldo_gols": gp - gc}


def jogo(pid, casa, fora, gm, gv, iso, status="finalizado"):
    return {"partida_id": pid, "campeonato": {"campeonato_id": 10, "nome_popular": "Brasileirão"}, "status": status,
            "time_mandante": {"time_id": casa[0], "nome_popular": casa[1]}, "time_visitante": {"time_id": fora[0], "nome_popular": fora[1]},
            "placar_mandante": gm, "placar_visitante": gv, "data_realizacao_iso": iso}


A, B, C = (1, "Alfa"), (2, "Beta"), (3, "Gama")


class Tabela(unittest.TestCase):
    def test_refeita_pelos_resultados_ate_o_jogo(self):
        games = [jogo(10, A, B, 2, 0, "2026-11-01T16:00:00-0300"), jogo(11, B, C, 1, 1, "2026-11-08T16:00:00-0300"),
                 jogo(12, C, A, 3, 0, "2026-11-15T16:00:00-0300")]  # depois do jogo analisado
        rows = [row(1, "Alfa", 3, 2, 1, 0, 1, 2, 3), row(2, "Beta", 1, 2, 0, 1, 1, 1, 3), row(3, "Gama", 4, 2, 1, 1, 0, 4, 1)]
        with mock.patch.object(r, "_season_results", lambda cid, m: games):
            t = r.table_after(rows, 10, games[1])  # Beta x Gama, 08/11
        self.assertEqual((t[1]["pts"], t[1]["j"], t[1]["pos"]), (3, 1, 1))  # a vitória de Gama sobre Alfa (15/11) não conta
        self.assertEqual((t[3]["pts"], t[3]["j"]), (1, 1))
        self.assertEqual(t[2]["pos_antes"], 3)  # antes do empate, Beta (0 pts) era o último

    def test_fonte_atrasada_conta_o_jogo(self):
        # a tabela/lista da fonte ainda não tem o jogo encerrado ontem: ele entra mesmo assim
        m = jogo(20, A, B, 1, 0, "2026-11-24T17:00:00-0300")
        with mock.patch.object(r, "_season_results", lambda cid, mm: [jogo(10, A, B, 2, 0, "2026-11-01T16:00:00-0300")]):
            t = r.table_after([row(1, "Alfa", 3, 1, 1, 0, 0, 2, 0), row(2, "Beta", 0, 1, 0, 0, 1, 0, 2)], 10, m)
        self.assertEqual((t[1]["pts"], t[1]["j"]), (6, 2))


class Zonas(unittest.TestCase):
    def tabela(self, n):
        return {i: {"pts": 100 - i * 2, "pos": i, "nome": f"T{i}"} for i in range(1, n + 1)}

    def test_brasileirao_z4(self):
        t = self.tabela(20)
        self.assertIn("dentro do Z4", r._zone_fact(10, t[18], t))
        self.assertIn("2 pontos acima do Z4", r._zone_fact(10, t[16], t))

    def test_champions_fase_de_liga(self):
        t = self.tabela(36)
        self.assertIn("top 8", r._zone_fact(106, t[3], t))
        self.assertIn("playoff", r._zone_fact(106, t[12], t))
        self.assertIn("25º em diante", r._zone_fact(106, t[30], t))
        self.assertNotIn("G4", r._zone_fact(106, t[12], t))

    def test_singular(self):
        self.assertEqual(r._pts(1), "1 ponto")
        self.assertEqual(r._pts(3), "3 pontos")


class Nomes(unittest.TestCase):
    def test_limpa(self):
        self.assertEqual(r.clean_name("Como 1907"), "Como")
        self.assertEqual(r.clean_name("PAE AEK"), "AEK")
        self.assertEqual(r.clean_name("Athletico-PR"), "Athletico-PR")


class Fatos(unittest.TestCase):
    def test_fim_de_jogo_fala_do_que_mudou(self):
        ctx = {"status": "finalizado", "placar": [1, 1], "rodadas_restantes": 2,
               "mandante": {"nome": "Alfa", "posicao_antes": 3, "tabela": {"pos": 2, "pts": 74, "j": 36, "v": 21, "e": 11, "d": 4, "gp": 64, "gc": 26},
                            "situacao": "6 pontos atrás do líder", "forma": ["V 6x1 Remo (casa, Brasileirão, 05/11)"], "artilheiro": "Fulano, 10 gols"},
               "visitante": {"nome": "Beta"}}
        f = " ".join(insights.facts(ctx))
        self.assertIn("foi do 3º para o 2º lugar", f)
        self.assertIn("Logo depois do jogo", f)
        self.assertIn("V 6x1 Remo", f)
        self.assertIn("Rodadas que faltam no campeonato depois deste jogo: 2", f)
        self.assertIn("O QUE MUDA", insights.MOMENT["finalizado"])




class IAOcupada(unittest.TestCase):
    def test_mostra_a_ultima_analise(self):
        from placar.ai import client as ai
        ctx = {"status": "finalizado", "mandante": {"nome": "Alfa"}, "visitante": {"nome": "Beta"}}
        boa = {"titulo": "Alfa vence", "resumo": "x", "pontos": [], "palpite": {}, "fique_de_olho": "y"}
        with mock.patch.object(ai, "available", lambda: True), mock.patch.object(r, "match_context", lambda pid: ctx), \
                mock.patch.object(r.auth.LIMIT, "allow", lambda *a: True):
            with mock.patch.object(insights, "match_insight", lambda c: boa):
                st, d = r.handle_get("/ia/partida/123", {}, "1.2.3.4")
            self.assertEqual((st, d["analise"]["titulo"], d.get("anterior")), (200, "Alfa vence", None))

            def ocupada(c):
                raise ai.AIError("Muita gente usando a IA agora.")
            with mock.patch.object(insights, "match_insight", ocupada):
                st, d = r.handle_get("/ia/partida/123", {}, "1.2.3.4")  # IA ocupada: a última análise, marcada
                self.assertEqual((st, d["analise"]["titulo"], d.get("anterior")), (200, "Alfa vence", True))
                st, d = r.handle_get("/ia/partida/999", {}, "1.2.3.4")  # sem análise anterior: o erro de sempre
                self.assertEqual(st, 503)


if __name__ == "__main__":
    unittest.main()
