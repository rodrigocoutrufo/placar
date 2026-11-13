"""Identidade única dos times entre as fontes.

O mesmo clube tem um ID em cada fonte: na Série B, o Novorizontino é 51 na API Futebol e 900018127 na
ESPN. Com dois IDs, o mesmo time aparecia duas vezes em "Seguindo", o jogo oficial não casava com o placar
ao vivo e a página do time gastava o plano diário. Aqui as respostas da API Futebol passam a usar o ID
canônico (o da ESPN, que o resto do Placar já usa), guardando o original em time_id_api_futebol.
"""

import re
import threading
import time
import unicodedata

CANON_MIN = 800_000_000          # IDs da football-data (800M+) e da ESPN (900M+) já são canônicos
api_to_canon: dict[int, dict] = {}  # ID da API Futebol -> time canônico (para redirecionar /times/{id})
_idx: dict[int, tuple[float, dict]] = {}
_lock = threading.Lock()


def norm(s: str | None) -> str:
    return re.sub(r"[^a-z0-9]", "", unicodedata.normalize("NFD", s or "").encode("ascii", "ignore").decode().lower())


def _index(cid: int, loader) -> dict:
    hit = _idx.get(cid)
    if hit and hit[0] > time.time():
        return hit[1]
    try:
        teams = loader(cid) or []
    except Exception:  # noqa: BLE001 — sem a lista, a resposta segue com os IDs originais
        teams = []
    idx = {norm(t["nome_popular"]): t for t in teams if t.get("nome_popular") and t.get("time_id")}
    with _lock:
        _idx[cid] = (time.time() + (6 * 3600 if idx else 300), idx)
    return idx


def find(name: str, idx: dict):
    """Casa um nome com a lista canônica: igual; senão um único que começa igual (6 letras); senão nada."""
    n = norm(name)
    if not n:
        return None
    if n in idx:
        return idx[n]
    cands = [t for k, t in idx.items() if k[:6] == n[:6]]
    if len(cands) == 1:
        return cands[0]
    cands = [t for k, t in idx.items() if k in n or n in k]
    return cands[0] if len(cands) == 1 else None


def canonicalize(obj, cid: int, loader):
    """Troca, em qualquer lugar do JSON, os times com ID da API Futebol pelo time canônico."""
    idx = _index(cid, loader)
    if not idx:
        return obj

    def walk(o):
        if isinstance(o, dict):
            tid = o.get("time_id")
            if isinstance(tid, int) and 0 < tid < CANON_MIN and "nome_popular" in o:
                t = find(o["nome_popular"], idx)
                if t:
                    api_to_canon[tid] = t
                    o.update({k: t[k] for k in ("time_id", "nome_popular", "sigla", "escudo", "escudo_escuro", "cor", "cor_secundaria") if t.get(k)},
                             time_id_api_futebol=tid)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)
    walk(obj)
    return obj
