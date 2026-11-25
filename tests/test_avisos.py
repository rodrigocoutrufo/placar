"""Novos tipos de aviso do ao vivo (cartão vermelho, pênalti perdido, gol anulado, 15 min antes, escalação).
Tudo simulado: nenhuma fonte de dados nem serviço de push é consultado."""

import json
import os
import sys
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="vyra-avisos-"))
sys.argv = sys.argv[:1]

from placar import server  # noqa: E402
from placar.core import webpush  # noqa: E402
from placar.sources import espn  # noqa: E402


def jogo(pm=0, pv=0, lances=None, pid=900000001):
    t = lambda i, n: {"time_id": i, "nome_popular": n, "escudo": None}  # noqa: E731
    return {"partida_id": pid, "campeonato": {"campeonato_id": 10, "nome_popular": "Brasileirão"}, "status": "andamento",
            "periodo": "segundo-tempo", "time_mandante": t(1, "Flamengo"), "time_visitante": t(2, "Palmeiras"),
            "placar_mandante": pm, "placar_visitante": pv, "lances_ao_vivo": lances or []}


class LiveFlags(unittest.TestCase):
    def test_vermelho_e_penalti_da_espn(self):
        comp = {"competitors": [{"homeAway": "home", "team": {"id": "819"}}, {"homeAway": "away", "team": {"id": "2029"}}],
                "details": [
                    {"type": {"text": "Yellow Card"}, "yellowCard": True, "clock": {"displayValue": "10'"}, "team": {"id": "819"}, "athletesInvolved": [{"id": "1", "displayName": "A"}]},
                    {"type": {"text": "Red Card"}, "redCard": True, "clock": {"displayValue": "55'"}, "team": {"id": "2029"}, "athletesInvolved": [{"id": "2", "displayName": "Gustavo Gómez"}]},
                    {"type": {"text": "Penalty - Saved"}, "clock": {"displayValue": "70'"}, "team": {"id": "819"}, "athletesInvolved": [{"id": "3", "displayName": "Pedro"}]},
                    {"type": {"text": "Goal"}, "scoringPlay": True, "clock": {"displayValue": "80'"}, "team": {"id": "819"}, "athletesInvolved": [{"id": "3", "displayName": "Pedro"}]}]}
        f = espn.live_flags(comp)
        self.assertEqual([(x["tipo"], x["lado"], x["nome"], x["detalhe"]) for x in f],
                         [("vermelho", "visitante", "Gustavo Gómez", None), ("penalti", "mandante", "Pedro", "Defendido")])


class Tick(unittest.TestCase):
    def run_ticks(self, frames):
        hub = server.LiveHub()
        events = []
        hub.publish = lambda ev, data: events.append((ev, data))  # noqa: E731
        hub._scorer = lambda m, side: None  # noqa: E731
        for f in frames:
            with mock.patch.object(server, "route", lambda path, q=None, f=f: (200, json.dumps(f).encode(), "teste")):
                hub.tick()
        # só os avisos (o ao vivo também publica a lista atualizada, "update")
        return [(e, d.get("tipo") or d.get("texto") or "gol") for e, d in events if e in ("gol", "lance", "periodo")]

    def test_vermelho_penalti_e_anulado(self):
        red = {"k": "vermelho-55'-2", "tipo": "vermelho", "lado": "visitante", "nome": "Gustavo Gómez", "minuto": "55'"}
        pen = {"k": "penalti-70'-3", "tipo": "penalti", "lado": "mandante", "nome": "Pedro", "minuto": "70'", "detalhe": "Perdido"}
        ev = self.run_ticks([[jogo()], [jogo(lances=[red])], [jogo(lances=[red, pen])], [jogo(1, 0, [red, pen])],
                             [jogo(0, 0, [red, pen])], [jogo(0, 0, [red, pen])]])
        self.assertEqual(ev, [("lance", "vermelho"), ("lance", "penalti"), ("gol", "gol"), ("lance", "anulado")])

    def test_primeira_rodada_nao_avisa_o_que_ja_estava(self):
        red = {"k": "vermelho-55'-2", "tipo": "vermelho", "lado": "visitante"}
        self.assertEqual(self.run_ticks([[jogo(lances=[red])], [jogo(lances=[red])]]), [])


class PreJogo(unittest.TestCase):
    def test_15_min_e_escalacao(self):
        agora = datetime.now(server.BRT)
        iso = lambda mins: (agora + timedelta(minutes=mins)).strftime("%Y-%m-%dT%H:%M:%S%z")  # noqa: E731
        games = [{**jogo(pid=900000010), "status": "agendado", "data_realizacao_iso": iso(12)},
                 {**jogo(pid=900000011), "status": "agendado", "data_realizacao_iso": iso(5)},     # perto demais: só marca
                 {**jogo(pid=900000012), "status": "agendado", "data_realizacao_iso": iso(40)}]
        events = []
        lineups = {900000010: False, 900000011: False, 900000012: False}
        with mock.patch.object(server, "agenda", lambda: json.dumps(games).encode()), \
                mock.patch.object(server.HUB, "publish", lambda ev, d: events.append((d["tipo"], d["partida"]["partida_id"]))), \
                mock.patch.object(server, "_has_lineup", lambda m: lineups[m["partida_id"]]), \
                mock.patch.object(server.HUB, "ready", True):
            server._pre_first[0] = False
            server.pre_match()
            server.pre_match()  # a segunda rodada não repete
            lineups[900000012] = True
            server._lineup_check.clear()
            server.pre_match()
            server._lineup_check.clear()
            server.pre_match()
        self.assertEqual(events, [("em_breve", 900000010), ("escalacao", 900000012)])


class Push(unittest.TestCase):
    def test_quem_recebe_e_texto(self):
        pr = webpush.clean_prefs({"comps": [10], "tipos": {"vermelho": True, "anulado": False, "escalacao": True}})
        red = {"partida": jogo(1, 0), "tipo": "vermelho", "time": jogo()["time_visitante"], "autor": {"nome": "Gustavo Gómez", "minuto": "55'"}}
        self.assertTrue(webpush.wants("lance", red, pr))
        self.assertFalse(webpush.wants("lance", {**red, "tipo": "anulado"}, pr))
        msg = webpush.message("lance", red, pr)
        self.assertIn("Cartão vermelho", msg["title"])
        self.assertIn("Gustavo Gómez", msg["body"])
        esc = webpush.message("lance", {"partida": jogo(), "tipo": "escalacao"}, pr)
        self.assertTrue(esc["url"].endswith("/escalacoes"))


if __name__ == "__main__":
    unittest.main()
