"""Notificações com o Vyra fechado (Web Push), só com a biblioteca padrão.

Como funciona: o navegador da pessoa se inscreve no serviço de push dele (Google, Mozilla, Apple, Microsoft) e nos
manda um endereço + duas chaves. Quando sai um gol que ela segue, o servidor cifra a mensagem para aquelas chaves
(RFC 8291, aes128gcm) e assina o pedido com as chaves VAPID do Vyra (RFC 8292); o serviço entrega ao aparelho e o
service worker (web/public/sw.js) mostra a notificação, mesmo com o site fechado.

A criptografia (curva P-256, ECDH, ECDSA e AES-128-GCM) está aqui em Python puro, conferida com o exemplo oficial da
RFC 8291 (tests/test_webpush.py). É lenta para volume grande, mas sobra para algumas centenas de avisos por gol.

Inscrições ficam em DATA_DIR/push.db (sem conta: a chave é o endereço do push), com as preferências de aviso da pessoa
(campeonatos, times, NBA, F1), para o servidor decidir quem recebe cada lance.
"""

import base64
import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import struct
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

from .. import config

# ================================================================ base64url
def b64e(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def b64d(s: str) -> bytes:
    s = "".join(s.split())
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


# ================================================================ curva P-256 (secp256r1)
P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
     0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5)


def _jdouble(p):
    x, y, z = p
    if not y:
        return (0, 0, 0)
    ysq = y * y % P
    s = 4 * x * ysq % P
    m = (3 * (x - z * z) * (x + z * z)) % P  # a = -3
    nx = (m * m - 2 * s) % P
    ny = (m * (s - nx) - 8 * ysq * ysq) % P
    nz = 2 * y * z % P
    return (nx, ny, nz)


def _jadd(p, q):
    if not p[2]:
        return q
    if not q[2]:
        return p
    x1, y1, z1 = p
    x2, y2, z2 = q
    z1s, z2s = z1 * z1 % P, z2 * z2 % P
    u1, u2 = x1 * z2s % P, x2 * z1s % P
    s1, s2 = y1 * z2s * z2 % P, y2 * z1s * z1 % P
    if u1 == u2:
        return _jdouble(p) if s1 == s2 else (0, 0, 0)
    h, r = (u2 - u1) % P, (s2 - s1) % P
    h2 = h * h % P
    h3 = h * h2 % P
    u1h2 = u1 * h2 % P
    nx = (r * r - h3 - 2 * u1h2) % P
    ny = (r * (u1h2 - nx) - s1 * h3) % P
    nz = h * z1 * z2 % P
    return (nx, ny, nz)


def _affine(p):
    if not p[2]:
        raise ValueError("ponto no infinito")
    zi = pow(p[2], -1, P)
    zi2 = zi * zi % P
    return (p[0] * zi2 % P, p[1] * zi2 * zi % P)


def _mul(k: int, pt) -> tuple:
    r, q = (0, 0, 0), (pt[0], pt[1], 1)
    while k:
        if k & 1:
            r = _jadd(r, q)
        q = _jdouble(q)
        k >>= 1
    return _affine(r)


def _on_curve(pt) -> bool:
    x, y = pt
    return 0 <= x < P and 0 <= y < P and (y * y - (x * x * x + A * x + B)) % P == 0


def pub_bytes(pt) -> bytes:  # forma não comprimida (0x04 || X || Y)
    return b"\x04" + pt[0].to_bytes(32, "big") + pt[1].to_bytes(32, "big")


def pub_point(b: bytes):
    if len(b) != 65 or b[0] != 4:
        raise ValueError("chave pública inválida")
    pt = (int.from_bytes(b[1:33], "big"), int.from_bytes(b[33:], "big"))
    if not _on_curve(pt):
        raise ValueError("chave fora da curva")
    return pt


def new_key() -> tuple[int, bytes]:
    d = secrets.randbelow(N - 1) + 1
    return d, pub_bytes(_mul(d, G))


def ecdh(d: int, peer: bytes) -> bytes:
    return _mul(d, pub_point(peer))[0].to_bytes(32, "big")


def ecdsa_sign(d: int, msg: bytes) -> bytes:
    """ES256: assinatura r || s (64 bytes) do SHA-256 da mensagem."""
    z = int.from_bytes(hashlib.sha256(msg).digest(), "big")
    while True:
        k = secrets.randbelow(N - 1) + 1
        r = _mul(k, G)[0] % N
        if not r:
            continue
        s = pow(k, -1, N) * (z + r * d) % N
        if s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def ecdsa_verify(pub: bytes, msg: bytes, sig: bytes) -> bool:
    r, s = int.from_bytes(sig[:32], "big"), int.from_bytes(sig[32:], "big")
    if not (0 < r < N and 0 < s < N):
        return False
    z = int.from_bytes(hashlib.sha256(msg).digest(), "big")
    w = pow(s, -1, N)
    q = pub_point(pub)
    p1, p2 = _mul(z * w % N, G), _mul(r * w % N, q)
    pt = _affine(_jadd((p1[0], p1[1], 1), (p2[0], p2[1], 1)))
    return pt[0] % N == r


# ================================================================ AES-128 e GCM
_SBOX = []


def _init_sbox():
    # S-box do AES calculada (inverso em GF(2^8) + transformação afim)
    p = q = 1
    sbox = [0] * 256
    while True:
        p = p ^ ((p << 1) & 0xFF) ^ (0x1B if p & 0x80 else 0)
        q ^= q << 1
        q ^= q << 2
        q ^= q << 4
        q &= 0xFF
        if q & 0x80:
            q ^= 0x09
        x = q ^ (((q << 1) | (q >> 7)) & 0xFF) ^ (((q << 2) | (q >> 6)) & 0xFF) ^ (((q << 3) | (q >> 5)) & 0xFF) ^ (((q << 4) | (q >> 4)) & 0xFF)
        sbox[p] = x ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    _SBOX.extend(sbox)


_init_sbox()


def _xt(a):
    return ((a << 1) ^ 0x1B) & 0xFF if a & 0x80 else a << 1


def _expand(key: bytes) -> list:
    w = [list(key[i:i + 4]) for i in range(0, 16, 4)]
    rcon = 1
    for i in range(4, 44):
        t = list(w[i - 1])
        if i % 4 == 0:
            t = [_SBOX[b] for b in t[1:] + t[:1]]
            t[0] ^= rcon
            rcon = _xt(rcon)
        w.append([a ^ b for a, b in zip(w[i - 4], t)])
    return [sum(w[r * 4:r * 4 + 4], []) for r in range(11)]


def _aes_block(rk: list, block: bytes) -> bytes:
    s = [b ^ k for b, k in zip(block, rk[0])]
    for rnd in range(1, 11):
        s = [_SBOX[b] for b in s]
        s = [s[(c * 4 + r + r * 4) % 16] for c in range(4) for r in range(4)]  # ShiftRows (coluna c, linha r)
        if rnd < 10:
            out = []
            for c in range(4):
                a = s[c * 4:c * 4 + 4]
                t = a[0] ^ a[1] ^ a[2] ^ a[3]
                out += [a[i] ^ t ^ _xt(a[i] ^ a[(i + 1) % 4]) for i in range(4)]
            s = out
        s = [b ^ k for b, k in zip(s, rk[rnd])]
    return bytes(s)


def _gmul(x: int, y: int) -> int:
    r = 0
    R = 0xE1 << 120
    for i in range(127, -1, -1):
        if (y >> i) & 1:
            r ^= x
        x = (x >> 1) ^ R if x & 1 else x >> 1
    return r


def aes128gcm_encrypt(key: bytes, nonce: bytes, plaintext: bytes) -> bytes:
    """AES-128-GCM sem dados adicionais: texto cifrado || tag de 16 bytes."""
    rk = _expand(key)
    h = int.from_bytes(_aes_block(rk, b"\x00" * 16), "big")
    j0 = nonce + b"\x00\x00\x00\x01"
    out = bytearray()
    for i in range(0, len(plaintext), 16):
        ctr = nonce + struct.pack(">I", 2 + i // 16)
        ks = _aes_block(rk, ctr)
        out += bytes(a ^ b for a, b in zip(plaintext[i:i + 16], ks))
    y = 0
    for i in range(0, len(out), 16):
        blk = bytes(out[i:i + 16]).ljust(16, b"\x00")
        y = _gmul(y ^ int.from_bytes(blk, "big"), h)
    y = _gmul(y ^ ((0 << 64) | (len(out) * 8)), h)
    tag = bytes(a ^ b for a, b in zip(y.to_bytes(16, "big"), _aes_block(rk, j0)))
    return bytes(out) + tag


# ================================================================ RFC 8291 (cifra da mensagem)
def _hkdf_expand(prk: bytes, info: bytes, n: int) -> bytes:
    return hmac.new(prk, info + b"\x01", hashlib.sha256).digest()[:n]


def encrypt(ua_public: bytes, auth: bytes, plaintext: bytes, as_key: tuple[int, bytes] | None = None, salt: bytes | None = None) -> bytes:
    d, as_public = as_key or new_key()
    salt = salt or secrets.token_bytes(16)
    secret = ecdh(d, ua_public)
    prk_key = hmac.new(auth, secret, hashlib.sha256).digest()
    ikm = _hkdf_expand(prk_key, b"WebPush: info\x00" + ua_public + as_public, 32)
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    cek = _hkdf_expand(prk, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf_expand(prk, b"Content-Encoding: nonce\x00", 12)
    body = aes128gcm_encrypt(cek, nonce, plaintext + b"\x02")
    return salt + struct.pack(">I", 4096) + bytes([len(as_public)]) + as_public + body


# ================================================================ chaves VAPID do Vyra
KEY_FILE = config.DATA_DIR / "vapid.json"
SUBJECT = os.environ.get("VAPID_SUBJECT", "").strip() or "mailto:avisos@vyra.invalid"  # contato do responsável (defina no .env)
_vapid: dict = {}
_vlock = threading.Lock()


def vapid() -> dict:
    """Par de chaves do servidor, gerado na primeira vez e guardado em DATA_DIR (trocar invalida as inscrições)."""
    with _vlock:
        if not _vapid:
            try:
                k = json.loads(KEY_FILE.read_text(encoding="utf-8"))
                _vapid.update(d=int(k["d"]), pub=b64d(k["pub"]))
            except (OSError, ValueError, KeyError):
                d, pub = new_key()
                KEY_FILE.write_text(json.dumps({"d": str(d), "pub": b64e(pub)}), encoding="utf-8")
                _vapid.update(d=d, pub=pub)
        return _vapid


def public_key() -> str:
    return b64e(vapid()["pub"])


_jwt_cache: dict[str, tuple[float, str]] = {}


def _jwt(aud: str) -> str:
    hit = _jwt_cache.get(aud)
    if hit and hit[0] > time.time() + 600:
        return hit[1]
    exp = int(time.time()) + 12 * 3600
    head = b64e(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    body = b64e(json.dumps({"aud": aud, "exp": exp, "sub": SUBJECT}, separators=(",", ":")).encode())
    sig = b64e(ecdsa_sign(vapid()["d"], f"{head}.{body}".encode()))
    tok = f"{head}.{body}.{sig}"
    _jwt_cache[aud] = (exp, tok)
    return tok


# ================================================================ inscrições
DB = config.DATA_DIR / "push.db"
# só os serviços de push dos navegadores: o servidor nunca faz pedido a um endereço qualquer mandado pelo visitante
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com",
              ".notify.windows.com", "push.apple.com")
_db_lock = threading.Lock()


def _conn():
    c = sqlite3.connect(DB, timeout=10)
    c.execute("""CREATE TABLE IF NOT EXISTS inscricoes (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL,
                 prefs TEXT NOT NULL DEFAULT '{}', criada REAL, atualizada REAL, falhas INTEGER DEFAULT 0)""")
    return c


def valid_endpoint(url: str) -> bool:
    try:
        u = urllib.parse.urlsplit(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and len(url) < 1000 and any(host == h.lstrip(".") or host.endswith(h if h.startswith(".") else "." + h) or host == h for h in PUSH_HOSTS)


def subscribe(sub: dict, prefs: dict) -> None:
    ep, keys = sub.get("endpoint") or "", sub.get("keys") or {}
    if not valid_endpoint(ep):
        raise ValueError("serviço de push não reconhecido")
    pub_point(b64d(keys.get("p256dh", "")))  # chave válida na curva
    if len(b64d(keys.get("auth", ""))) != 16:
        raise ValueError("chave auth inválida")
    now = time.time()
    with _db_lock, _conn() as c:
        c.execute("""INSERT INTO inscricoes (endpoint, p256dh, auth, prefs, criada, atualizada) VALUES (?,?,?,?,?,?)
                     ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, prefs=excluded.prefs,
                     atualizada=excluded.atualizada, falhas=0""",
                  (ep, keys["p256dh"], keys["auth"], json.dumps(clean_prefs(prefs)), now, now))


def unsubscribe(endpoint: str) -> None:
    with _db_lock, _conn() as c:
        c.execute("DELETE FROM inscricoes WHERE endpoint=?", (endpoint,))


def count() -> int:
    with _db_lock, _conn() as c:
        return c.execute("SELECT COUNT(*) FROM inscricoes").fetchone()[0]


def _norm(s) -> str:
    return " ".join(unicodedata.normalize("NFD", str(s or "")).encode("ascii", "ignore").decode().lower().split())


# tipos de aviso de futebol (os mesmos interruptores do painel de notificações)
TIPOS = ("gol", "inicio", "intervalo", "fim", "vermelho", "penalti", "anulado", "em_breve", "escalacao")


def clean_prefs(p: dict) -> dict:
    """Só o que decide quem recebe cada aviso (o navegador manda; nada mais é guardado)."""
    p = p if isinstance(p, dict) else {}
    ints = lambda v: [int(x) for x in (v or [])[:200] if str(x).lstrip("-").isdigit()]  # noqa: E731
    strs = lambda v: [str(x)[:60] for x in (v or [])[:100]]  # noqa: E731
    tipos = p.get("tipos") or {}
    return {"comps": ints(p.get("comps")), "times": ints(p.get("times")), "nomes": [_norm(x) for x in strs(p.get("nomes"))],
            "tipos": {k: bool(tipos.get(k)) for k in TIPOS},
            "nbaTodos": bool(p.get("nbaTodos")), "nbaTimes": ints(p.get("nbaTimes")),
            "f1": bool(p.get("f1")), "f1Pilotos": strs(p.get("f1Pilotos")), "f1Equipes": strs(p.get("f1Equipes"))}


# ================================================================ quem recebe cada evento
def _team_in(t, pr) -> bool:
    if not t:
        return False
    return int(t.get("time_id") or 0) in pr["times"] or _norm(t.get("nome_popular")) in pr["nomes"]


def wants(event: str, data: dict, pr: dict) -> bool:
    if event in ("gol", "periodo", "lance"):
        p = data.get("partida") or {}
        kind = "gol" if event == "gol" else data.get("tipo") if event == "lance" else \
            {"Começou": "inicio", "Intervalo": "intervalo", "Fim de jogo": "fim"}.get(data.get("texto"))
        if not kind or not pr["tipos"].get(kind):
            return False
        cid = int(((p.get("campeonato") or {}).get("campeonato_id")) or 0)
        return cid in pr["comps"] or _team_in(p.get("time_mandante"), pr) or _team_in(p.get("time_visitante"), pr)
    if event == "nba":
        g = data.get("jogo") or {}
        kind = data.get("tipo")
        if kind != "gol" and kind and not pr["tipos"].get(kind):
            return False
        ids = {int((g.get("casa") or {}).get("id") or 0), int((g.get("fora") or {}).get("id") or 0)}
        return pr["nbaTodos"] or bool(ids & set(pr["nbaTimes"]))
    if event == "f1":
        if pr["f1"]:
            return True
        if data.get("texto") == "Começou":
            return bool(pr["f1Pilotos"] or pr["f1Equipes"])
        return any(x.get("id") in pr["f1Pilotos"] or x.get("equipe") in pr["f1Equipes"] for x in data.get("ordem") or [])
    return False


def message(event: str, data: dict, pr: dict | None = None) -> dict | None:
    """Título, texto, ícone e link da notificação (o service worker só exibe)."""
    if event == "gol":
        p, t = data["partida"], data["time"]
        a = data.get("autor") or {}
        placar = f"{p['time_mandante']['nome_popular']} {p.get('placar_mandante') or 0} × {p.get('placar_visitante') or 0} {p['time_visitante']['nome_popular']}"
        quem = " · ".join(x for x in (a.get("minuto"), a.get("nome")) if x)
        return {"title": f"⚽ Gol do {t['nome_popular']}!", "body": placar + (f"\n{quem}" if quem else ""), "icon": t.get("escudo"),
                "tag": f"jogo-{p['partida_id']}", "url": f"/#/partida/{p['partida_id']}"}
    if event == "periodo":
        p = data["partida"]
        placar = f"{p['time_mandante']['nome_popular']} {p.get('placar_mandante') or 0} × {p.get('placar_visitante') or 0} {p['time_visitante']['nome_popular']}"
        camp = (p.get("campeonato") or {}).get("nome_popular") or ""
        return {"title": f"{data['texto']} · {camp}".strip(" ·"), "body": placar, "icon": (p.get("time_mandante") or {}).get("escudo"),
                "tag": f"jogo-{p['partida_id']}", "url": f"/#/partida/{p['partida_id']}"}
    if event == "lance":
        p, t = data["partida"], data.get("time") or {}
        placar = f"{p['time_mandante']['nome_popular']} {p.get('placar_mandante') or 0} × {p.get('placar_visitante') or 0} {p['time_visitante']['nome_popular']}"
        a = data.get("autor") or {}
        quem = " · ".join(x for x in (a.get("minuto"), a.get("nome"), data.get("detalhe")) if x)
        camp = (p.get("campeonato") or {}).get("nome_popular") or ""
        jogo = f"{p['time_mandante']['nome_popular']} × {p['time_visitante']['nome_popular']}"
        title, body = {
            "vermelho": (f"🟥 Cartão vermelho · {t.get('nome_popular', '')}", f"{placar}\n{quem}"),
            "penalti": (f"Pênalti {'defendido' if data.get('detalhe') == 'Defendido' else 'perdido'} · {t.get('nome_popular', '')}", f"{placar}\n{quem}"),
            "anulado": (f"Gol anulado · {t.get('nome_popular', '')}", placar),
            "em_breve": (f"Começa em {data.get('minutos') or 15} min", f"{jogo}\n{camp}".strip()),
            "escalacao": ("Escalações confirmadas", f"{jogo}\n{camp}".strip()),
        }.get(data.get("tipo"), (None, None))
        if not title:
            return None
        return {"title": title.strip(" ·"), "body": body.strip(), "icon": t.get("escudo") or (p.get("time_mandante") or {}).get("escudo"),
                "tag": f"jogo-{p['partida_id']}-{data.get('tipo')}", "url": f"/#/partida/{p['partida_id']}{'/escalacoes' if data.get('tipo') == 'escalacao' else ''}"}
    if event == "nba":
        g = data["jogo"]
        return {"title": f"NBA · {data.get('texto')}", "body": f"{g['fora'].get('curto')} {g['fora'].get('placar') or 0} × {g['casa'].get('placar') or 0} {g['casa'].get('curto')}",
                "icon": g["casa"].get("logo"), "tag": f"nba-{g['id']}", "url": f"/#/nba/jogo/{g['id']}"}
    if event == "f1":
        mine = [x for x in data.get("ordem") or [] if pr and (x.get("id") in pr["f1Pilotos"] or x.get("equipe") in pr["f1Equipes"])]
        top = mine or (data.get("top") or [])
        linha = " · ".join(f"{x['pos']}º {str(x['nome']).split(' ')[-1]}" for x in top[:5])
        verbo = "começou" if data.get("texto") == "Começou" else "terminou"
        return {"title": f"F1 · {data.get('sessao')} {verbo}", "body": " — ".join(x for x in (data.get("gp"), linha) if x), "tag": f"f1-{data.get('sessao')}", "url": "/#/f1"}
    return None


# ================================================================ envio
stats = {"enviados": 0, "falhas": 0, "removidas": 0}
_pool = ThreadPoolExecutor(4, thread_name_prefix="push")


def send_one(endpoint: str, p256dh: str, auth: str, msg: dict, ttl: int = 600) -> int:
    """Manda uma notificação; devolve o status HTTP do serviço de push (201 = aceito)."""
    if not valid_endpoint(endpoint):
        return 400
    body = encrypt(b64d(p256dh), b64d(auth), json.dumps(msg, ensure_ascii=False).encode())
    u = urllib.parse.urlsplit(endpoint)
    aud = f"{u.scheme}://{u.netloc}"
    req = urllib.request.Request(endpoint, data=body, method="POST", headers={
        "TTL": str(ttl), "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "Urgency": "high",
        "Authorization": f"vapid t={_jwt(aud)}, k={public_key()}"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, TimeoutError, OSError):
        return 0


def _deliver(rows, event, data):
    for ep, k, a, prefs in rows:
        pr = json.loads(prefs)
        msg = message(event, data, pr)
        if not msg:
            continue
        st = send_one(ep, k, a, msg)
        if st in (200, 201, 202):
            stats["enviados"] += 1
        elif st in (404, 410):  # a pessoa saiu/desinstalou: a inscrição não vale mais
            stats["removidas"] += 1
            unsubscribe(ep)
        else:
            stats["falhas"] += 1
            with _db_lock, _conn() as c:
                c.execute("UPDATE inscricoes SET falhas=falhas+1 WHERE endpoint=?", (ep,))
                c.execute("DELETE FROM inscricoes WHERE endpoint=? AND falhas>=20", (ep,))


def dispatch(event: str, data: dict) -> None:
    """Chamado a cada evento ao vivo: escolhe quem segue aquilo e envia em segundo plano (não trava o ao vivo)."""
    if event not in ("gol", "periodo", "lance", "nba", "f1"):
        return
    try:
        with _db_lock, _conn() as c:
            rows = c.execute("SELECT endpoint, p256dh, auth, prefs FROM inscricoes").fetchall()
    except sqlite3.Error:
        return
    chosen = [r for r in rows if wants(event, data, json.loads(r[3]))]
    for i in range(0, len(chosen), 25):
        _pool.submit(_deliver, chosen[i:i + 25], event, data)
