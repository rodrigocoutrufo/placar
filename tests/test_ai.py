"""Testes da camada de IA e da classificação de notícias, sem rede e sem custo (cliente falso).

Uso:  python -m unittest tests.test_ai -v
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS

os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="placar-test-")
# chaves vazias ANTES de importar o placar (o .env não sobrescreve variáveis já definidas): nenhum teste
# chama uma IA de verdade nem gasta cota
os.environ["ANTHROPIC_API_KEY"] = ""
os.environ["GEMINI_API_KEY"] = ""
os.environ["AI_PROVIDER"] = ""
os.environ["OLLAMA_URL"] = "http://127.0.0.1:9"  # porta fechada: nenhum Ollama de verdade entra nos testes
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from placar.ai import assistant, client, gemini, insights, ollama  # noqa: E402
from placar.ai import news as ai_news  # noqa: E402
from placar.core import news_filter as nf  # noqa: E402


def text_msg(text, stop="end_turn"):
    return NS(content=[NS(type="text", text=text)], stop_reason=stop, usage=NS(input_tokens=10, output_tokens=5))


class FakeAPI:
    """Imita client.beta.messages.create: devolve respostas prontas e guarda o que recebeu."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.beta = NS(messages=NS(create=self.create))

    def create(self, **params):
        self.calls.append(params)
        return self.responses.pop(0)


class ClientTests(unittest.TestCase):
    def tearDown(self):
        client.set_client(None)

    def test_disabled_without_key(self):
        client.set_client(None)
        self.assertFalse(client.available())
        with self.assertRaises(client.AIError):
            client.ask_json("s", "u", {"type": "object"})

    def test_json_validated_and_cached(self):
        fake = FakeAPI([text_msg('{"ok": true}')])
        client.set_client(fake)
        schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"], "additionalProperties": False}
        self.assertEqual(client.ask_json("sys", "pergunta única 1", schema), {"ok": True})
        self.assertEqual(client.ask_json("sys", "pergunta única 1", schema), {"ok": True})  # do cache
        self.assertEqual(len(fake.calls), 1)
        p = fake.calls[0]
        self.assertEqual(p["model"], client.MODEL)
        self.assertEqual(p["output_config"]["format"]["type"], "json_schema")
        self.assertEqual(p["fallbacks"], "default")
        self.assertIn(client.FALLBACK_BETA, p["betas"])

    def test_refusal_raises(self):
        client.set_client(FakeAPI([text_msg("", stop="refusal")]))
        with self.assertRaises(client.AIError):
            client.ask_json("sys", "pergunta recusada", {"type": "object"}, cache=False)

    def test_tool_loop(self):
        tool_call = NS(content=[NS(type="tool_use", id="t1", name="tabela", input={"campeonato_id": 10})], stop_reason="tool_use", usage=None)
        fake = FakeAPI([tool_call, text_msg("Flamengo lidera com 70 pontos.")])
        client.set_client(fake)
        seen = []
        out = assistant.answer("Quem lidera o Brasileirão?", [], {"tabela": lambda campeonato_id: seen.append(campeonato_id) or [{"pos": 1, "time": "Flamengo"}]})
        self.assertEqual(out["resposta"], "Flamengo lidera com 70 pontos.")
        self.assertEqual(out["ferramentas"], ["tabela"])
        self.assertEqual(seen, [10])
        last = fake.calls[1]["messages"][-1]  # os resultados das ferramentas voltam numa única mensagem do usuário
        self.assertEqual(last["role"], "user")
        self.assertEqual(last["content"][0]["type"], "tool_result")
        self.assertEqual(last["content"][0]["tool_use_id"], "t1")

    def test_tool_schemas_are_strict(self):
        for t in assistant.TOOLS:
            s = t["input_schema"]
            self.assertTrue(t["strict"])
            self.assertFalse(s["additionalProperties"])
            self.assertEqual(sorted(s["required"]), sorted(s["properties"]))

    def test_insight_schema_shape(self):
        out = {"titulo": "T", "resumo": "R", "pontos": ["a", "", "b"], "palpite": {"mandante": 1, "visitante": 0, "comentario": "c"}, "fique_de_olho": "f"}
        client.set_client(FakeAPI([text_msg(json.dumps(out))]))
        data = insights.match_insight({"partida_id": 1, "status": "agendado"})
        self.assertEqual(data["pontos"], ["a", "b"])


class OllamaTests(unittest.TestCase):
    """Provedor local: respostas falsas no lugar do servidor do Ollama."""

    def setUp(self):
        self.calls = []
        self._post, self._avail, self._prov = ollama._post, ollama.available, client.PROVIDER
        ollama.available = lambda: True
        client.PROVIDER = "ollama"  # a IA local só roda quando escolhida (AI_PROVIDER=ollama)

    def tearDown(self):
        ollama._post, ollama.available, client.PROVIDER = self._post, self._avail, self._prov

    def fake(self, *replies):
        replies = list(replies)

        def post(path, body):
            self.calls.append(body)
            return replies.pop(0)
        ollama._post = post

    def test_default_provider_is_local_and_free(self):
        self.assertEqual(client.provider(), "ollama")
        self.assertEqual(client.model_name(), ollama.MODEL)
        self.assertNotIn("orcamento_hoje", client.status())

    def test_json_with_schema(self):
        self.fake({"message": {"content": '{"ok": true}'}, "eval_count": 7})
        out = client.ask_json("sys", "pergunta local 1", {"type": "object"}, cache=False)
        self.assertEqual(out, {"ok": True})
        self.assertEqual(self.calls[0]["format"], {"type": "object"})
        self.assertFalse(self.calls[0]["think"])

    def test_bad_json_is_retried(self):
        self.fake({"message": {"content": "não é json"}}, {"message": {"content": '{"ok": 1}'}})
        self.assertEqual(client.ask_json("sys", "pergunta local 2", {"type": "object"}, cache=False), {"ok": 1})

    def test_local_plan_then_answer(self):
        plan = {"consultas": [{"nome": "tabela", "campeonato_id": "10", "partida_id": 0, "data": "", "nome_time": "", "busca": ""}]}
        self.fake({"message": {"content": json.dumps(plan)}}, {"message": {"content": '{"resposta": "Flamengo lidera com 76 pontos."}'}})
        seen = []
        out = assistant.answer("Quem lidera?", [], {"tabela": lambda campeonato_id: seen.append(campeonato_id) or [{"pos": 1, "time": "Flamengo", "pts": 76}]})
        self.assertEqual(out, {"resposta": "Flamengo lidera com 76 pontos.", "ferramentas": ["tabela"]})
        self.assertEqual(seen, [10])  # "10" (texto) virou 10 (inteiro), como pede o schema
        self.assertIn("Flamengo", self.calls[1]["messages"][-1]["content"])  # os dados foram para a resposta
        self.assertIn("format", self.calls[0])  # plano preso ao schema: sem divagação

    def test_busy_model_never_blocks_forever(self):
        ollama._post = self._post  # o _post de verdade (com a fila), sem rede: o modelo está "ocupado"
        old_wait = ollama.WAIT_INTERACTIVE
        ollama.WAIT_INTERACTIVE = 0.2
        ollama._one_at_a_time.acquire()
        try:
            with self.assertRaises(client.AIError) as cm:  # pergunta: espera pouco e avisa
                client.ask_json("sys", "pergunta ocupada", {"type": "object"}, cache=False)
            self.assertIn("ocupada", str(cm.exception))
            with self.assertRaises(client.AIError):  # segundo plano: não espera nada
                ollama.background(lambda: client.ask_json("sys", "tarefa de fundo", {"type": "object"}, cache=False))
        finally:
            ollama._one_at_a_time.release()
            ollama.WAIT_INTERACTIVE = old_wait

    def test_news_labeling_is_off_by_default_locally(self):
        self.assertFalse(client.background_news())

    def test_leaked_reasoning_is_removed(self):
        self.assertEqual(ollama._clean("pensando...</think>\n\nFlamengo."), "Flamengo.")

    def test_offline_is_friendly(self):
        def boom(path, body):
            raise ollama.OllamaError("fora do ar")
        ollama._post = boom
        with self.assertRaises(client.AIError):
            client.ask_json("sys", "pergunta local 3", {"type": "object"}, cache=False)


class GeminiTests(unittest.TestCase):
    """Gemini (Interactions API) com respostas falsas no lugar do Google."""

    def setUp(self):
        self.calls = []
        self._post = gemini._post
        os.environ["GEMINI_API_KEY"] = "teste"

    def tearDown(self):
        gemini._post = self._post
        os.environ.pop("GEMINI_API_KEY", None)

    def fake(self, *replies):
        replies = list(replies)

        def post(body):
            self.calls.append(body)
            r = replies.pop(0)
            if isinstance(r, Exception):
                raise r
            return r
        gemini._post = post

    @staticmethod
    def interaction(text):
        return {"id": "i1", "status": "completed", "steps": [{"type": "model_output", "content": [{"type": "text", "text": text}]}],
                "usage": {"total_input_tokens": 50, "total_output_tokens": 9}}

    def test_without_key_ai_is_off_and_local_never_starts_alone(self):
        os.environ.pop("GEMINI_API_KEY", None)
        self.assertEqual(client.provider(), "gemini")
        self.assertFalse(client.available())

    def test_json_request_shape(self):
        self.fake(self.interaction('{"ok": true}'))
        self.assertTrue(client.available())
        self.assertEqual(client.ask_json("sys", "pergunta gemini 1", {"type": "object"}, cache=False), {"ok": True})
        b = self.calls[0]
        self.assertEqual(b["model"], gemini.MODEL)
        self.assertEqual(b["system_instruction"], "sys")
        self.assertEqual(b["response_format"], {"type": "text", "mime_type": "application/json", "schema": {"type": "object"}})
        self.assertFalse(b["store"])

    def test_overloaded_everywhere_is_friendly(self):
        self.fake(*[gemini.GeminiBusy("503")] * (2 + len(gemini.FALLBACKS)))
        with self.assertRaises(client.AIError) as cm:
            client.ask_json("sys", "pergunta gemini 2", {"type": "object"}, cache=False)
        self.assertIn("Tente de novo", str(cm.exception))

    def test_overloaded_model_falls_back(self):
        self.fake(gemini.GeminiBusy("503"), gemini.GeminiBusy("503"), self.interaction('{"ok": 1}'))
        self.assertEqual(client.ask_json("sys", "pergunta gemini 3", {"type": "object"}, cache=False), {"ok": 1})
        self.assertEqual([c["model"] for c in self.calls], [gemini.MODEL, gemini.MODEL, gemini.FALLBACKS[0]])

    def test_assistant_flow(self):
        plan = {"consultas": [{"nome": "tabela", "campeonato_id": 10, "partida_id": 0, "data": "", "nome_time": "", "busca": ""}]}
        self.fake(self.interaction(json.dumps(plan)), self.interaction('{"resposta": "Flamengo, 76 pontos."}'))
        out = assistant.answer("Quem lidera?", [], {"tabela": lambda campeonato_id: [{"pos": 1, "time": "Flamengo", "pts": 76}]})
        self.assertEqual(out["resposta"], "Flamengo, 76 pontos.")


class NewsRulesTests(unittest.TestCase):
    def labels(self, titulo, resumo="", teams=None):
        return nf.rule_labels({"titulo": titulo, "resumo": resumo}, teams or {})

    def test_serie_b_is_not_serie_a(self):
        lab = self.labels("Goiás tem 10 jogadores pendurados para decisão", "pela última rodada do Brasileirão da Série B")
        self.assertIn(14, lab["competicoes"])
        self.assertNotIn(10, lab["competicoes"])

    def test_brasileirao(self):
        self.assertEqual(self.labels("Flamengo vence e abre vantagem no Brasileirão")["competicoes"], [10])

    def test_player_nickname_is_not_the_club(self):
        lab = self.labels("Oeirense anuncia zagueiro Léo Ceará, ex-Afogados", teams={"Ceará": 14})
        self.assertEqual(lab["inferidas"], [])

    def test_past_club_does_not_count(self):
        lab = self.labels("Sinop contrata Júnior Viçosa, atacante com passagens por Grêmio e Goiás", teams={"Grêmio": 10, "Goiás": 14})
        self.assertEqual(lab["inferidas"], [])

    def test_club_news_counts_for_its_league_not_for_cups(self):
        lab = self.labels("Arsenal monitora situação de Vini Jr. no Real Madrid", teams={"Arsenal": 101})
        self.assertTrue(nf.matches(lab, 101))
        self.assertFalse(nf.matches(lab, 106))

    def test_state_championship_and_other_sports(self):
        self.assertEqual(self.labels("Uesles aposta em virada do Atlético-PB após empate na Copa Paraíba", teams={"Atlético-PB": 14})["inferidas"], [])
        self.assertEqual(self.labels("Unifacisa sofre a sua 2ª derrota no NBB 2026/2027")["esporte"], "outro")

    def test_women_and_youth_stay_out(self):
        self.assertFalse(nf.matches(self.labels("Palmeiras feminino acerta contratação para o Brasileirão"), 10))
        self.assertFalse(nf.matches(self.labels("Flamengo sub-20 vence clássico"), 10))

    def test_ai_labels_win(self):
        rules = self.labels("Manchete qualquer")
        merged = nf.merge(rules, {"esporte": "futebol", "categoria": "profissional_masculino", "competicoes": [7], "times": ["Palmeiras"]})
        self.assertTrue(nf.matches(merged, 7))
        self.assertEqual(merged["origem"], "ia")

    def test_ai_news_refresh_stores_labels(self):
        out = {"noticias": [{"id": "n1", "esporte": "futebol", "categoria": "profissional_masculino", "competicoes": [10], "times": ["Flamengo"]}]}
        client.set_client(FakeAPI([text_msg(json.dumps(out))]))
        try:
            n = ai_news.refresh([{"noticia_id": "n1", "titulo": "Flamengo vence"}], {10: "Brasileirão"}, ["Flamengo"])
        finally:
            client.set_client(None)
        self.assertEqual(n, 1)
        self.assertEqual(ai_news.labels_for("n1")["competicoes"], [10])


if __name__ == "__main__":
    unittest.main()
