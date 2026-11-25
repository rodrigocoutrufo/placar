"""Cliente de IA da Vyra: um só lugar para provedor, modelo, limite, cache e erros.

Três provedores, mesma interface (ask_json e run_tools):
  gemini     nuvem, plano grátis (ai/gemini.py) — escolhido quando há GEMINI_API_KEY.
  anthropic  Claude pela API (pago por uso), com fallback automático quando o modelo recusa.
  ollama     local, grátis (ai/ollama.py) — só com AI_PROVIDER=ollama: pesa no computador.

Sem provedor disponível (sem chave, ou AI_ENABLED=0), available() devolve False e o resto da Vyra
segue com as regras normais (heurísticas). Nada quebra.

Variáveis:
  AI_PROVIDER         gemini | anthropic | ollama (padrão: anthropic se houver ANTHROPIC_API_KEY, senão gemini)
  GEMINI_API_KEY      chave grátis do Google AI Studio — ver ai/gemini.py
  ANTHROPIC_API_KEY   chave da API da Anthropic (console.anthropic.com)
  AI_MODEL            modelo da Anthropic (padrão claude-opus-5-5)
  AI_DAILY_REQUESTS   teto diário de chamadas à nuvem (padrão 400): protege o custo (Anthropic) e a cota grátis (Gemini)
  AI_ENABLED          0 desliga a IA
"""

import hashlib
import json
import os
import sys
import threading
import time
from datetime import datetime

from .. import config
from . import gemini, ollama

MODEL = os.environ.get("AI_MODEL", "claude-opus-5-5")
PROVIDER = os.environ.get("AI_PROVIDER") or ("anthropic" if (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")) else "gemini")
DAILY_LIMIT = int(os.environ.get("AI_DAILY_REQUESTS", "400"))
CACHE_DIR = config.DATA_DIR / "ai"
BUDGET_FILE = config.DATA_DIR / "ai_orcamento.json"
FALLBACK_BETA = "server-side-fallback-2026-07-01"  # se o modelo recusar, a API refaz no modelo reserva

stats = {"chamadas": 0, "do_cache": 0, "erros": 0, "recusas": 0, "bloqueadas_pelo_limite": 0,
         "tokens_entrada": 0, "tokens_saida": 0, "ultimo_erro": None}
_client = None
_lock = threading.Lock()


class AIError(Exception):
    """A IA não respondeu (desligada, limite do dia, recusa ou erro da API)."""


def set_client(client):
    """Troca o cliente (testes usam um falso; nada vai para a rede)."""
    global _client
    _client = client


def provider() -> str:
    return "anthropic" if _client is not None else PROVIDER


def model_name() -> str:
    return {"ollama": ollama.MODEL, "gemini": gemini.MODEL}.get(provider(), MODEL)


def available() -> bool:
    if os.environ.get("AI_ENABLED", "1") == "0":
        return False
    if _client is not None:
        return True
    if provider() == "ollama":
        return ollama.available()
    if provider() == "gemini":
        return gemini.available()
    if not (os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN")):
        return False
    try:
        import anthropic
        return bool(anthropic.Anthropic)
    except ImportError:
        return False


def _get_client():
    global _client
    with _lock:
        if _client is None:
            import anthropic
            _client = anthropic.Anthropic(max_retries=2, timeout=90)
        return _client


# ---------------------------------------------------------------- limite diário
def _today():
    return datetime.now(config.BRT).strftime("%Y-%m-%d")


def _used() -> int:
    try:
        b = json.loads(BUDGET_FILE.read_text(encoding="utf-8"))
        return b["usadas"] if b.get("dia") == _today() else 0
    except (OSError, ValueError, KeyError):
        return 0


def _spend():
    with _lock:
        n = _used() + 1
        BUDGET_FILE.write_text(json.dumps({"dia": _today(), "usadas": n}), encoding="utf-8")


def budget() -> dict:
    return {"usadas": _used(), "limite": DAILY_LIMIT, "restantes": max(0, DAILY_LIMIT - _used())}


# ---------------------------------------------------------------- cache em disco
def _key(*parts) -> str:
    return hashlib.sha256(json.dumps(parts, sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:40]


def cache_get(key: str):
    f = CACHE_DIR / f"{key}.json"
    try:
        d = json.loads(f.read_text(encoding="utf-8"))
        if d["exp"] > time.time():
            stats["do_cache"] += 1
            return d["data"]
    except (OSError, ValueError, KeyError):
        pass
    return None


def cache_put(key: str, data, ttl: float):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    (CACHE_DIR / f"{key}.json").write_text(json.dumps({"exp": time.time() + ttl, "data": data}, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------- chamadas
def _call(**params):
    """Uma chamada à API, com limite diário, fallback na recusa e contabilidade de tokens."""
    if not available():
        raise AIError("IA desligada (configure ANTHROPIC_API_KEY no .env).")
    if _used() >= DAILY_LIMIT:
        stats["bloqueadas_pelo_limite"] += 1
        raise AIError("Limite diário da IA atingido. Volta amanhã.")
    import anthropic
    _spend()
    stats["chamadas"] += 1
    try:
        resp = _get_client().beta.messages.create(model=MODEL, betas=[FALLBACK_BETA], fallbacks="default", **params)
    except anthropic.RateLimitError as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = "limite de requisições da API"
        raise AIError("A IA está ocupada agora. Tente em instantes.") from e
    except anthropic.APIStatusError as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = f"{e.status_code}: {getattr(e, 'message', e)}"[:300]
        sys.stderr.write(f"IA: erro {stats['ultimo_erro']}\n")
        raise AIError("A IA não respondeu agora.") from e
    except anthropic.APIConnectionError as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = "sem conexão com a API"
        raise AIError("Sem conexão com a IA agora.") from e
    usage = getattr(resp, "usage", None)
    if usage is not None:
        stats["tokens_entrada"] += getattr(usage, "input_tokens", 0) or 0
        stats["tokens_saida"] += getattr(usage, "output_tokens", 0) or 0
    if resp.stop_reason == "refusal":
        stats["recusas"] += 1
        raise AIError("A IA preferiu não responder a isso.")
    return resp


def _text(resp) -> str:
    return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text").strip()


def ask_json(system: str, user: str, schema: dict, *, effort: str = "low", ttl: float = 86400, cache: bool = True) -> dict:
    """Pergunta com resposta em JSON garantido pelo schema (structured outputs). Cacheada por conteúdo."""
    key = _key("json", model_name(), system, user, schema)
    if cache:
        hit = cache_get(key)
        if hit is not None:
            return hit
    if provider() in ("ollama", "gemini"):
        data = _local(lambda: ollama.ask_json(system, user, schema, stats)) if provider() == "ollama" \
            else _gemini(lambda: gemini.ask_json(system, user, schema, stats, thinking={"high": "high", "medium": "medium"}.get(effort, "low")))
        if cache:
            cache_put(key, data, ttl)
        return data
    resp = _call(max_tokens=16000,
                 system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                 messages=[{"role": "user", "content": user}],
                 output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}})
    if resp.stop_reason == "max_tokens":
        raise AIError("Resposta da IA incompleta.")
    try:
        data = json.loads(_text(resp))
    except ValueError as e:
        raise AIError("Resposta da IA em formato inesperado.") from e
    if cache:
        cache_put(key, data, ttl)
    return data


def run_tools(system: str, messages: list, tools: list, execute, *, effort: str = "medium", max_steps: int = 6) -> tuple[str, list]:
    """Laço de ferramentas: o modelo pede dados (tools), a Vyra busca (execute) e devolve até a resposta final.
    execute(nome, entrada) -> str (JSON). Devolve (texto final, ferramentas usadas)."""
    if provider() == "ollama":
        return _local(lambda: ollama.run_tools(system, messages, tools, execute, stats, max_steps))
    msgs = list(messages)
    used = []
    for _ in range(max_steps):
        resp = _call(max_tokens=16000, system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                     messages=msgs, tools=tools, output_config={"effort": effort})
        if resp.stop_reason == "pause_turn":
            msgs.append({"role": "assistant", "content": resp.content})
            continue
        calls = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
        if resp.stop_reason != "tool_use" or not calls:
            return _text(resp), used
        msgs.append({"role": "assistant", "content": resp.content})
        results = []
        for c in calls:  # todas as respostas das ferramentas voltam numa única mensagem
            used.append(c.name)
            try:
                out, err = execute(c.name, dict(c.input or {})), False
            except Exception as e:  # noqa: BLE001 — ferramenta com problema vira erro para o modelo, não para o site
                out, err = f"Erro: {e}", True
            results.append({"type": "tool_result", "tool_use_id": c.id, "content": out, **({"is_error": True} if err else {})})
        msgs.append({"role": "user", "content": results})
    raise AIError("A pergunta precisou de passos demais. Tente algo mais direto.")


def _local(fn):
    """Chamada ao Ollama (grátis: não conta no teto diário), com os erros traduzidos para AIError."""
    if not available():
        raise AIError("IA local desligada: " + (ollama.reason() or "Ollama indisponível"))
    stats["chamadas"] += 1
    try:
        return fn()
    except ollama.OllamaBusy as e:
        raise AIError("A IA está ocupada respondendo outra pergunta. Tente de novo em um minuto.") from e
    except ollama.OllamaTimeout as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = str(e)[:300]
        raise AIError("A IA local demorou demais para responder. Tente uma pergunta mais direta.") from e
    except ollama.OllamaError as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = str(e)[:300]
        sys.stderr.write(f"IA local: {e}\n")
        raise AIError("A IA local não respondeu agora (o Ollama está aberto?).") from e


def _gemini(fn):
    """Chamada ao Gemini: conta no teto diário (protege a cota grátis), erros viram AIError."""
    if not available():
        raise AIError("IA desligada (configure GEMINI_API_KEY no .env).")
    if _used() >= DAILY_LIMIT:
        stats["bloqueadas_pelo_limite"] += 1
        raise AIError("Limite diário da IA atingido. Volta amanhã.")
    _spend()
    stats["chamadas"] += 1
    try:
        return fn()
    except gemini.GeminiBusy as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = "limite de pedidos do plano grátis (429)"
        raise AIError("Muita gente usando a IA agora. Tente de novo em um minuto.") from e
    except gemini.GeminiError as e:
        stats["erros"] += 1
        stats["ultimo_erro"] = str(e)[:300]
        sys.stderr.write(f"IA (Gemini): {e}\n")
        raise AIError("A IA não respondeu agora. Tente de novo em instantes.") from e


def background_news() -> bool:
    """Rotular notícias em segundo plano? Com Claude, sim. Com a IA local, só se OLLAMA_NEWS=1: no processador,
    cada lote leva minutos e deixaria as perguntas das pessoas esperando."""
    return available() and (provider() != "ollama" or ollama.NEWS_ENABLED)


def status() -> dict:
    out = {"ativo": available(), "provedor": provider(), "modelo": model_name(), **stats}
    if provider() == "gemini" and not available():
        out["motivo"] = "configure GEMINI_API_KEY no .env"
    if provider() == "ollama":
        out["motivo"] = ollama.reason() or None
    else:
        out["orcamento_hoje"] = budget()
    return out
