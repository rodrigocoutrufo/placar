"""IA nas notícias: rotula cada manchete (esporte, categoria, campeonatos e times) em lotes, em segundo plano.

O agendador chama refresh() com as notícias do momento; só as que ainda não têm rótulo vão para a IA
(30 por chamada, esforço baixo). Os rótulos ficam em disco e são lidos por labels_for(), que o filtro
de notícias (core/news_filter.py) usa no lugar das regras quando existe.
"""

import json
import threading

from .. import config
from . import client

LABELS_FILE = config.DATA_DIR / "ai" / "noticias_rotulos.json"
BATCH = 30
MAX_KEEP = 4000
_labels: dict[str, dict] | None = None
_lock = threading.Lock()

SYSTEM = """Você classifica manchetes de portais esportivos brasileiros para o app Placar.
Para cada notícia, devolva:
- esporte: "futebol", "basquete", "automobilismo" ou "outro";
- categoria: "profissional_masculino", "feminino", "base" (sub-20, Copinha, juniores) ou "outro";
- competicoes: ids dos campeonatos da lista abaixo de que a notícia trata. Use o campeonato citado ou inequívoco
  pelo contexto (jogo da rodada, tabela, rebaixamento, artilharia). Notícia de bastidor de um clube (contratação,
  técnico, lesão) sem campeonato citado conta só para a liga nacional do clube, nunca para copas. Série B, C ou D
  não é Brasileirão (Série A). Estaduais, ligas fora da lista e futebol feminino: lista vazia;
- times: nomes dos clubes citados, exatamente como aparecem na lista de times (vazio se nenhum).
Não invente: na dúvida, deixe a lista vazia."""


def _known_block(comps: dict[int, str], teams: list[str]) -> str:
    return ("Campeonatos (id: nome):\n" + "\n".join(f"{k}: {v}" for k, v in sorted(comps.items()))
            + "\n\nTimes conhecidos:\n" + ", ".join(sorted(set(teams))))


def _schema(comp_ids: list[int]) -> dict:
    return {"type": "object", "additionalProperties": False, "required": ["noticias"], "properties": {"noticias": {"type": "array", "items": {
        "type": "object", "additionalProperties": False, "required": ["id", "esporte", "categoria", "competicoes", "times"],
        "properties": {"id": {"type": "string"}, "esporte": {"type": "string", "enum": ["futebol", "basquete", "automobilismo", "outro"]},
                       "categoria": {"type": "string", "enum": ["profissional_masculino", "feminino", "base", "outro"]},
                       "competicoes": {"type": "array", "items": {"type": "integer", "enum": comp_ids}},
                       "times": {"type": "array", "items": {"type": "string"}}}}}}}


def _load() -> dict:
    global _labels
    if _labels is None:
        try:
            _labels = json.loads(LABELS_FILE.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _labels = {}
    return _labels


def labels_for(news_id: str) -> dict | None:
    return _load().get(news_id)


def refresh(items: list[dict], comps: dict[int, str], teams: list[str]) -> int:
    """Rotula as notícias que ainda não têm rótulo. Devolve quantas foram rotuladas."""
    if not client.available():
        return 0
    # modelo local no processador: lotes menores (respostas mais rápidas e JSON mais confiável)
    batch = 10 if client.provider() == "ollama" else BATCH
    with _lock:
        known = _load()
        todo = [n for n in items if n.get("noticia_id") and n["noticia_id"] not in known][:batch * 2]
    done = 0
    for i in range(0, len(todo), batch):
        chunk = todo[i:i + batch]
        # a lista de campeonatos e times vai no system (estável): reaproveitada pelo cache de prompt da API
        user = "Notícias:\n" + "\n".join(json.dumps({"id": n["noticia_id"], "titulo": n.get("titulo"), "resumo": (n.get("resumo") or "")[:300]},
                                                    ensure_ascii=False) for n in chunk)
        try:
            out = client.ask_json(SYSTEM + "\n\n" + _known_block(comps, teams), user, _schema(sorted(comps)), effort="low", ttl=7 * 86400)
        except client.AIError:
            break
        with _lock:
            valid_comps = set(comps)
            for x in out.get("noticias", []):
                if x.get("id") in {n["noticia_id"] for n in chunk} and x.get("esporte") and x.get("categoria"):
                    lab = {k: x.get(k) for k in ("esporte", "categoria", "competicoes", "times")}
                    lab["competicoes"] = [c for c in (lab["competicoes"] or []) if c in valid_comps]  # só ids reais
                    lab["times"] = [t for t in (lab["times"] or []) if isinstance(t, str)]
                    known[x["id"]] = lab
                    done += 1
            if len(known) > MAX_KEEP:
                for k in list(known)[: len(known) - MAX_KEEP]:
                    known.pop(k, None)
            LABELS_FILE.parent.mkdir(parents=True, exist_ok=True)
            LABELS_FILE.write_text(json.dumps(known, ensure_ascii=False), encoding="utf-8")
    return done
