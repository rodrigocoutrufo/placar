"""Criptografia do Web Push (placar/core/webpush.py) conferida com os exemplos oficiais. Nada sai para a rede."""

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("DATA_DIR", tempfile.mkdtemp(prefix="vyra-push-"))  # chaves e inscrições de teste fora do disco real

from placar.core import webpush as wp  # noqa: E402


class Crypto(unittest.TestCase):
    def test_aes_fips197(self):
        key = bytes(range(16))
        pt = bytes.fromhex("00112233445566778899aabbccddeeff")
        self.assertEqual(wp._aes_block(wp._expand(key), pt).hex(), "69c4e0d86a7b0430d8cdb78070b4c55a")

    def test_gcm_nist_case2(self):
        out = wp.aes128gcm_encrypt(b"\x00" * 16, b"\x00" * 12, b"\x00" * 16)
        self.assertEqual(out[:16].hex(), "0388dace60b6a392f328c2b971b2fe78")
        self.assertEqual(out[16:].hex(), "ab6e47d42cec13bdf53a67b21257bddf")

    def test_rfc8291_exemplo(self):
        # RFC 8291, seção 5 e apêndice A: mesmas chaves e salt -> mesma mensagem cifrada
        as_private = int.from_bytes(wp.b64d("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big")
        as_public = wp.b64d("BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8")
        self.assertEqual(wp.pub_bytes(wp._mul(as_private, wp.G)), as_public)
        ua_public = wp.b64d("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
        self.assertEqual(wp.b64e(wp.ecdh(as_private, ua_public)), "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs")
        body = wp.encrypt(ua_public, wp.b64d("BTBZMqHH6r4Tts7J_aSIgg"), b"When I grow up, I want to be a watermelon",
                          as_key=(as_private, as_public), salt=wp.b64d("DGv6ra1nlYgDCS1FRnbzlw"))
        esperado = ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml"
                    "mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT"
                    "pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN")
        self.assertEqual(wp.b64e(body), esperado)

    def test_ecdsa_assina_e_confere(self):
        d, pub = wp.new_key()
        sig = wp.ecdsa_sign(d, b"vyra")
        self.assertEqual(len(sig), 64)
        self.assertTrue(wp.ecdsa_verify(pub, b"vyra", sig))
        self.assertFalse(wp.ecdsa_verify(pub, b"outra", sig))

    def test_chave_fora_da_curva(self):
        with self.assertRaises(ValueError):
            wp.pub_point(b"\x04" + b"\x01" * 64)


class Regras(unittest.TestCase):
    def setUp(self):
        self.pr = wp.clean_prefs({"comps": [106], "times": [900000819], "nomes": ["Palmeiras"], "tipos": {"gol": True, "fim": True},
                                  "nbaTimes": [13], "f1Pilotos": ["bortoleto"], "f1Equipes": ["ferrari"]})

    def jogo(self, cid, casa, fora):
        t = lambda i, n: {"time_id": i, "nome_popular": n}  # noqa: E731
        return {"partida_id": 1, "campeonato": {"campeonato_id": cid}, "time_mandante": t(*casa), "time_visitante": t(*fora)}

    def test_gol_campeonato_time_e_nome(self):
        self.assertTrue(wp.wants("gol", {"partida": self.jogo(106, (1, "A"), (2, "B"))}, self.pr))  # Champions seguida
        self.assertTrue(wp.wants("gol", {"partida": self.jogo(10, (900000819, "Flamengo"), (3, "C"))}, self.pr))  # time
        self.assertTrue(wp.wants("gol", {"partida": self.jogo(2, (5, "Palmeiras"), (6, "D"))}, self.pr))  # pelo nome
        self.assertFalse(wp.wants("gol", {"partida": self.jogo(10, (7, "E"), (8, "F"))}, self.pr))

    def test_tipo_desligado(self):
        self.assertFalse(wp.wants("periodo", {"partida": self.jogo(106, (1, "A"), (2, "B")), "texto": "Intervalo"}, self.pr))
        self.assertTrue(wp.wants("periodo", {"partida": self.jogo(106, (1, "A"), (2, "B")), "texto": "Fim de jogo"}, self.pr))

    def test_nba_e_f1(self):
        self.assertTrue(wp.wants("nba", {"jogo": {"casa": {"id": 13}, "fora": {"id": 2}}, "tipo": "fim"}, self.pr))
        self.assertFalse(wp.wants("nba", {"jogo": {"casa": {"id": 1}, "fora": {"id": 2}}, "tipo": "fim"}, self.pr))
        ordem = [{"pos": 4, "nome": "Charles Leclerc", "id": "leclerc", "equipe": "ferrari"}, {"pos": 12, "nome": "Gabriel Bortoleto", "id": "bortoleto", "equipe": "audi"}]
        self.assertTrue(wp.wants("f1", {"texto": "Terminou", "ordem": ordem}, self.pr))
        msg = wp.message("f1", {"texto": "Terminou", "sessao": "Classificação", "gp": "GP de Catar", "ordem": ordem}, self.pr)
        self.assertIn("4º Leclerc", msg["body"])
        self.assertIn("12º Bortoleto", msg["body"])

    def test_so_servicos_de_push(self):
        self.assertTrue(wp.valid_endpoint("https://fcm.googleapis.com/fcm/send/abc"))
        self.assertTrue(wp.valid_endpoint("https://wns2-bl2p.notify.windows.com/w/?token=x"))
        self.assertFalse(wp.valid_endpoint("https://evil.example.com/fcm.googleapis.com"))
        self.assertFalse(wp.valid_endpoint("http://fcm.googleapis.com/x"))
        self.assertFalse(wp.valid_endpoint("https://127.0.0.1/x"))


if __name__ == "__main__":
    unittest.main()
