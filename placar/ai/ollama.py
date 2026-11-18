"""Provedor de IA local e gratuito: Ollama (https://ollama.com), rodando no próprio computador.

Fala com o servidor do Ollama por HTTP (biblioteca padrão, sem SDK):
  POST /api/chat  com "format" = JSON Schema (resposta estruturada) ou "tools" (o modelo pede dados à Vyra).
Uma chamada por vez (num PC sem placa de vídeo, duas ao mesmo tempo só deixam as duas lentas).

Variáveis:
  OLLAMA_URL     endereço do Ollama (padrão http://localhost:11434)
  OLLAMA_MODEL   modelo (padrão qwen3:4b: bom em português, usa ferramentas e responde JSON; ~2,6 GB)
"""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request

URL = os.environ.get("OLLAMA_URL", "http://localhost:11434").rstrip("/")
MODEL = os.environ.get("OLLAMA_MODEL", "qwen3:4b")
TIMEOUT = int(os.environ.get("OLLAMA_TIMEOUT", "90"))   # teto de cada chamada ao modelo (segundos)
WAIT_INTERACTIVE = 30   # pergunta/análise espera no máximo isso pela vez; depois avisa que a IA está ocupada
NEWS_ENABLED = os.environ.get("OLLAMA_NEWS", "0") == "1"  # rótulos de notícias em segundo plano: pesado no processador
KEEP_ALIVE = os.environ.get("OLLAMA_KEEP_ALIVE", "30m")  # modelo fica carregado na memória entre as chamadas
# no processador, o que pesa é ler a entrada: contexto enxuto e respostas com teto
OPTIONS = {"temperature": 0.3, "num_ctx": int(os.environ.get("OLLAMA_NUM_CTX", "6144"))}
TOOL_RESULT_MAX = 3500  # caracteres de cada resposta de ferramenta enviados ao modelo local
_one_at_a_time = threading.Semaphore(1)
_probe = {"at": 0.0, "ok": False, "motivo": ""}


class OllamaError(Exception):
    pass


class OllamaBusy(OllamaError):
    """O modelo local está ocupado com outra resposta (uma por vez)."""


class OllamaTimeout(OllamaError):
    """O modelo local passou do tempo máximo de uma resposta."""


_busy = threading.local()


def background(fn):
    """Roda fn como tarefa de segundo plano: só usa o modelo se ele estiver livre agora (nunca faz fila)."""
    _busy.wait = 0
    try:
        return fn()
    finally:
        _busy.wait = None


def _post(path: str, body: dict) -> dict:
    wait = getattr(_busy, "wait", None)
    if not _one_at_a_time.acquire(timeout=WAIT_INTERACTIVE if wait is None else wait):
        raise OllamaBusy("o modelo local está ocupado com outra resposta")
    req = urllib.request.Request(URL + path, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise OllamaError(f"Ollama respondeu {e.code}: {e.read()[:200].decode('utf-8', 'replace')}") from e
    except TimeoutError as e:
        raise OllamaTimeout(f"o modelo local passou de {TIMEOUT} s") from e
    except (urllib.error.URLError, OSError) as e:
        if isinstance(getattr(e, "reason", None), TimeoutError):
            raise OllamaTimeout(f"o modelo local passou de {TIMEOUT} s") from e
        _probe["at"] = 0.0  # força checar de novo na próxima vez
        raise OllamaError(f"Ollama fora do ar ({e})") from e
    finally:
        _one_at_a_time.release()


def available() -> bool:
    """O Ollama está rodando e o modelo já foi baixado? (resposta guardada por 30 s)"""
    if time.time() - _probe["at"] < 30:
        return _probe["ok"]
    ok, why = False, ""
    try:
        with urllib.request.urlopen(URL + "/api/tags", timeout=2) as r:
            names = {m.get("name") for m in json.loads(r.read()).get("models", [])}
        want = MODEL if ":" in MODEL else f"{MODEL}:latest"
        ok = want in names or MODEL in names
        why = "" if ok else f"modelo {MODEL} não baixado (rode: ollama pull {MODEL})"
    except (urllib.error.URLError, TimeoutError, OSError, ValueError):
        why = "Ollama não está rodando"
    _probe.update(at=time.time(), ok=ok, motivo=why)
    return ok


def reason() -> str:
    available()
    return _probe["motivo"]


THINK_RX = re.compile(r"^.*?</think>\s*", re.S)


def _no_think(system: str) -> str:
    """Qwen3 raciocina por padrão e às vezes ignora "think": false (com ferramentas). "/no_think" é o
    interruptor oficial do modelo; no processador, raciocinar deixa cada resposta minutos mais lenta."""
    return f"{system}\n/no_think" if "qwen3" in MODEL.lower() else system


def _clean(text: str) -> str:
    """Tira um raciocínio que tenha vazado na resposta (<think>...</think>)."""
    return THINK_RX.sub("", text or "").strip() if "</think>" in (text or "") else (text or "").strip()


def _usage(stats, d):
    stats["tokens_entrada"] += d.get("prompt_eval_count") or 0
    stats["tokens_saida"] += d.get("eval_count") or 0


def ask_json(system: str, user: str, schema: dict, stats: dict) -> dict:
    """Resposta em JSON seguindo o schema (o Ollama restringe a saída ao formato pedido)."""
    body = {"model": MODEL, "stream": False, "think": False, "format": schema, "keep_alive": KEEP_ALIVE,
            "options": {**OPTIONS, "num_predict": 1200},
            "messages": [{"role": "system", "content": _no_think(system)}, {"role": "user", "content": user}]}
    last = None
    for _ in range(2):  # modelos pequenos às vezes escorregam no JSON: uma segunda tentativa resolve
        d = _post("/api/chat", body)
        _usage(stats, d)
        try:
            return json.loads(_clean((d.get("message") or {}).get("content")))
        except ValueError as e:
            last = e
    raise OllamaError("o modelo local devolveu um JSON inválido") from last


def run_tools(system: str, messages: list, tools: list, execute, stats: dict, max_steps: int = 6) -> tuple[str, list]:
    """Laço de ferramentas no formato do Ollama: o modelo pede tool_calls, a Vyra responde com role "tool"."""
    otools = [{"type": "function", "function": {"name": t["name"], "description": t["description"], "parameters": t["input_schema"]}} for t in tools]
    msgs = [{"role": "system", "content": _no_think(system)}] + [{"role": m["role"], "content": m["content"]} for m in messages]
    used = []
    for _ in range(max_steps):
        d = _post("/api/chat", {"model": MODEL, "stream": False, "think": False, "messages": msgs, "tools": otools,
                                "keep_alive": KEEP_ALIVE, "options": {**OPTIONS, "num_predict": 700}})
        _usage(stats, d)
        msg = d.get("message") or {}
        calls = msg.get("tool_calls") or []
        if not calls:
            return _clean(msg.get("content")), used
        msgs.append({"role": "assistant", "content": _clean(msg.get("content")), "tool_calls": calls})
        for c in calls:
            fn = c.get("function") or {}
            name, args = fn.get("name", ""), fn.get("arguments") or {}
            if isinstance(args, str):
                try:
                    args = json.loads(args)
                except ValueError:
                    args = {}
            used.append(name)
            try:
                out = execute(name, args)
            except Exception as e:  # noqa: BLE001 — erro da ferramenta vira texto para o modelo
                out = f"Erro: {e}"
            msgs.append({"role": "tool", "content": out[:TOOL_RESULT_MAX], "tool_name": name})
    raise OllamaError("a pergunta precisou de passos demais")
