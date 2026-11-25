"""Sala do jogo (placar/core/sala.py): moderação, limites, denúncias, enquetes, votos e nota da torcida.
Banco temporário; nenhuma fonte de dados é consultada."""

import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="vyra-sala-")

from placar.core import auth, sala  # noqa: E402

PID = 900000001


def user(nome):
    auth.x("INSERT INTO users(username, email, name, created, verified) VALUES (?,?,?,?,1)", (nome, f"{nome}@teste.invalid", nome.title(), time.time()))
    return auth.q("SELECT * FROM users WHERE username=?", (nome,), one=True)


def partida(status="andamento"):
    t = lambda i, n: {"time_id": i, "nome_popular": n, "sigla": n[:3].upper()}  # noqa: E731
    p = lambda i, n: {"atleta": {"atleta_id": i, "nome_popular": n}, "posicao": {"sigla": "ATA"}}  # noqa: E731
    return {"partida_id": PID, "status": status, "time_mandante": t(1, "Flamengo"), "time_visitante": t(2, "Palmeiras"),
            "placar_mandante": 1, "placar_visitante": 0,
            "escalacoes": {"mandante": {"titulares": [p(11, "Pedro")], "reservas": [p(12, "Bruno Henrique"), p(13, "Reserva Que Não Entrou")]},
                           "visitante": {"titulares": [p(21, "Vitor Roque")], "reservas": []}},
            "substituicoes": {"mandante": [{"entrou": {"atleta_id": 12}, "saiu": {"atleta_id": 11}}], "visitante": []}}


class Base(unittest.TestCase):
    match = partida()

    @classmethod
    def setUpClass(cls):
        sala.fetch_match = lambda pid: cls.match if pid == PID else None
        sala._match_cache.clear()

    def setUp(self):
        sala._match_cache.clear()
        auth.LIMIT.hits.clear()

    def ctx(self, u=None, ip="10.0.0.1"):
        c = {"ip": ip, "ua": "teste", "cookies": {}}
        if u:
            hdr = auth.start_session(u["id"], c)[0][1]
            c["cookies"] = {auth.COOKIE: hdr.split("=", 1)[1].split(";", 1)[0]}
        return c


class Mensagens(Base):
    def test_conta_e_moderacao(self):
        ana = user("ana")
        st, d = sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "oi"}, self.ctx())
        self.assertEqual(st, 401)  # escrever precisa de conta
        st, d = sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "Que golaço, porraaa!"}, self.ctx(ana))
        self.assertEqual(st, 200)
        self.assertIn("p*****", d["texto"])
        st, d = sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "outra"}, self.ctx(ana))
        self.assertEqual(st, 429)  # uma mensagem a cada 3 s
        auth.LIMIT.hits.clear()
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "veja www.bet.com"}, self.ctx(ana))[0], 400)
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "x" * 281}, self.ctx(ana))[0], 400)
        st, d = sala.handle("GET", f"/sala/{PID}", {}, {}, self.ctx())
        self.assertEqual([m["texto"] for m in d["mensagens"]], ["Que golaço, p******!"])  # ler é livre ("porraaa": 7 letras)
        self.assertIsNone(d["eu"])

    def test_tres_denuncias_escondem_e_autor_apaga(self):
        bia, c1, c2, c3 = user("bia"), user("c1"), user("c2"), user("c3")
        mid = sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "mensagem chata"}, self.ctx(bia))[1]["id"]
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/denunciar", {}, {"id": mid}, self.ctx(bia))[0], 400)  # a própria
        for u in (c1, c2):
            sala.handle("POST", f"/sala/{PID}/denunciar", {}, {"id": mid}, self.ctx(u))
        sala.handle("POST", f"/sala/{PID}/denunciar", {}, {"id": mid}, self.ctx(c1))  # a mesma pessoa não conta duas vezes
        self.assertIn(mid, [m["id"] for m in sala.messages(PID)])
        sala.handle("POST", f"/sala/{PID}/denunciar", {}, {"id": mid}, self.ctx(c3))
        self.assertNotIn(mid, [m["id"] for m in sala.messages(PID)])
        auth.LIMIT.hits.clear()
        mid2 = sala.handle("POST", f"/sala/{PID}/mensagens", {}, {"texto": "vou apagar"}, self.ctx(bia))[1]["id"]
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/apagar", {}, {"id": mid2}, self.ctx(c1))[0], 404)  # só o autor
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/apagar", {}, {"id": mid2}, self.ctx(bia))[0], 200)


class Enquetes(Base):
    def test_lances_viram_enquete_uma_vez_e_um_voto_por_pessoa(self):
        p = partida()
        sala.on_event("lance", {"partida": p, "tipo": "vermelho", "time": p["time_visitante"], "autor": {"nome": "Gustavo Gómez"}})
        sala.on_event("lance", {"partida": p, "tipo": "vermelho", "time": p["time_visitante"], "autor": {"nome": "Gustavo Gómez"}})
        sala.on_event("periodo", {"partida": p, "texto": "Intervalo"})
        ps = sala.polls(PID)
        perguntas = [x["pergunta"] for x in ps]
        self.assertEqual(sum("Gustavo Gómez" in q for q in perguntas), 1)
        self.assertTrue(any(q.startswith("Intervalo") for q in perguntas))
        eid = next(x["id"] for x in ps if "Gómez" in x["pergunta"])
        st, d = sala.handle("POST", f"/sala/{PID}/votar", {}, {"enquete": eid, "opcao": 0}, self.ctx(ip="1.1.1.1"))
        self.assertEqual((st, d["votos"], d["meu_voto"]), (200, [1, 0], 0))
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/votar", {}, {"enquete": eid, "opcao": 1}, self.ctx(ip="1.1.1.1"))[0], 400)
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/votar", {}, {"enquete": eid, "opcao": 1}, self.ctx(ip="2.2.2.2"))[1]["votos"], [1, 1])
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/votar", {}, {"enquete": eid, "opcao": 7}, self.ctx(ip="3.3.3.3"))[0], 400)

    def test_quem_vence_antes_do_jogo(self):
        st, d = sala.handle("GET", f"/sala/{PID}", {}, {}, self.ctx())
        self.assertTrue(any(e["pergunta"] == "Quem vence?" and e["opcoes"] == ["Flamengo", "Empate", "Palmeiras"] for e in d["enquetes"]))


class Reacoes(Base):
    def test_termometro(self):
        for em in ("🔥", "🔥", "😂"):
            self.assertEqual(sala.handle("POST", f"/sala/{PID}/reagir", {}, {"emoji": em}, self.ctx(ip="5.5.5.5"))[0], 200)
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/reagir", {}, {"emoji": "💩"}, self.ctx())[0], 400)
        r = sala._reac_snapshot(PID)
        self.assertEqual((r["minuto"]["🔥"], r["minuto"]["😂"]), (2, 1))


class Notas(Base):
    def test_so_depois_do_jogo_e_so_quem_jogou(self):
        dani, edu, fabi = user("dani"), user("edu"), user("fabi")
        Base.match = partida("andamento")
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/nota", {}, {"atleta_id": 11, "nota": 8}, self.ctx(dani))[0], 400)
        Base.match = partida("finalizado")
        sala._match_cache.clear()
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/nota", {}, {"atleta_id": 13, "nota": 8}, self.ctx(dani))[0], 400)  # não entrou
        self.assertEqual(sala.handle("POST", f"/sala/{PID}/nota", {}, {"atleta_id": 11, "nota": 11}, self.ctx(dani))[0], 400)
        for u, n in ((dani, 9), (edu, 8), (fabi, 10)):
            self.assertEqual(sala.handle("POST", f"/sala/{PID}/nota", {}, {"atleta_id": 11, "nota": n}, self.ctx(u))[0], 200)
        sala.handle("POST", f"/sala/{PID}/nota", {}, {"atleta_id": 12, "nota": 6}, self.ctx(dani))
        st, d = sala.handle("GET", f"/sala/{PID}", {}, {}, self.ctx(dani))
        n = d["notas"]
        nomes = [j["nome"] for j in n["jogadores"]]
        self.assertIn("Bruno Henrique", nomes)  # reserva que entrou
        self.assertNotIn("Reserva Que Não Entrou", nomes)
        pedro = next(j for j in n["jogadores"] if j["atleta_id"] == 11)
        self.assertEqual((pedro["media"], pedro["votos"], pedro["minha"]), (9.0, 3, 9))
        self.assertEqual(n["craque"]["nome"], "Pedro")  # 3 votos: o mínimo
        Base.match = partida()


if __name__ == "__main__":
    unittest.main()
