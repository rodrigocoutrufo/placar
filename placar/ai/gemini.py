"""Provedor de IA na nuvem com plano grátis: Gemini (Google), pela Interactions API.

Biblioteca padrão, sem SDK:
  POST https://generativelanguage.googleapis.com/v1beta/interactions
  cabeçalhos x-goog-api-key e Api-Revision; corpo com model, system_instruction, input e
  response_format (JSON Schema) — a resposta vem em JSON garantido pelo schema.

Variáveis:
  GEMINI_API_KEY   chave grátis em https://aistudio.google.com/apikey
  GEMINI_MODEL     modelo (padrão gemini-4-hydrogen: tem plano grátis e é o recomendado para projetos novos)

No plano grátis o Google pode usar o que é enviado para melhorar os produtos dele. A Vyra só envia dados
públicos de futebol (tabelas, jogos, manchetes) e a pergunta da pessoa.
"""

import json
import os
import time
import urllib.error
import urllib.request

URL = "https://generativelanguage.googleapis.com/v1beta/interactions"
API_REVISION = "2026-05-20"
MODEL = os.environ.get("GEMINI_MODEL", "gemini-4-hydrogen")
# modelos reserva (também do plano grátis) para quando o principal estiver sobrecarregado (503) ou no limite (429)
FALLBACKS = [m.strip() for m in os.environ.get("GEMINI_FALLBACKS", "gemini-3.5-flash-lite,gemini-3.1-flash-lite").split(",") if m.strip()]
TIMEOUT = int(os.environ.get("GEMINI_TIMEOUT", "60"))


class GeminiError(Exception):
    pass


class GeminiBusy(GeminiError):
    """Limite de pedidos do plano (429) ou modelo sobrecarregado (503): vale tentar outro modelo."""


def key() -> str:
    return os.environ.get("GEMINI_API_KEY", "").strip()


def available() -> bool:
    return bool(key())


def _post(body: dict) -> dict:
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), method="POST", headers={
        "Content-Type": "application/json", "x-goog-api-key": key(), "Api-Revision": API_REVISION})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        detail = e.read()[:300].decode("utf-8", "replace")
        if e.code in (429, 500, 503):
            raise GeminiBusy(f"Gemini ocupado ({e.code}): {detail}") from e
        raise GeminiError(f"Gemini respondeu {e.code}: {detail}") from e
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise GeminiError(f"sem conexão com o Gemini ({e})") from e


def _text(d: dict) -> str:
    """Texto final: os itens de texto dos passos model_output."""
    if isinstance(d.get("output_text"), str):
        return d["output_text"]
    parts = []
    for step in d.get("steps") or []:
        if step.get("type") == "model_output":
            parts += [c.get("text", "") for c in step.get("content") or [] if c.get("type") == "text"]
    return "".join(parts).strip()


def ask_json(system: str, user: str, schema: dict, stats: dict) -> dict:
    """Tenta o modelo principal (com uma nova tentativa após uma pausa curta) e, se ele estiver sobrecarregado,
    os modelos reserva do plano grátis, em ordem."""
    base = {"system_instruction": system, "input": user, "store": False,
            "response_format": {"type": "text", "mime_type": "application/json", "schema": schema},
            "generation_config": {"thinking_level": "low", "max_output_tokens": 4096}}
    busy, last = None, None
    attempts = [(MODEL, 0), (MODEL, 1.5)] + [(m, 0) for m in FALLBACKS if m != MODEL]
    for model, pause in attempts:
        if pause:
            time.sleep(pause)
        try:
            d = _post({**base, "model": model})
        except GeminiBusy as e:
            busy = e
            stats["sobrecarga_gemini"] = stats.get("sobrecarga_gemini", 0) + 1
            continue
        u = d.get("usage") or {}
        stats["tokens_entrada"] += u.get("total_input_tokens") or 0
        stats["tokens_saida"] += u.get("total_output_tokens") or 0
        if model != MODEL:
            stats["respostas_modelo_reserva"] = stats.get("respostas_modelo_reserva", 0) + 1
        try:
            return json.loads(_text(d))
        except ValueError as e:
            last = e  # JSON quebrado: a próxima tentativa (ou modelo) resolve
    if busy:
        raise busy
    raise GeminiError("o Gemini devolveu um JSON inválido") from last
