"""Contas da Vyra: cadastro, login (usuário ou e-mail + senha, ou Google), sessões e segurança.

Só biblioteca padrão:
- SQLite (DATA_DIR/contas.db) para usuários, sessões e códigos de uso único;
- senhas com scrypt (sal aleatório por usuário), nunca guardadas em texto;
- sessão em cookie HttpOnly + SameSite=Lax (+ Secure em HTTPS); no banco fica só o hash do token;
- proteção CSRF: toda escrita exige o cabeçalho X-Requested-With e Origin do próprio site;
- captcha: prova de trabalho (o navegador resolve um desafio SHA-256 assinado com HMAC, de uso único)
  ou Cloudflare Turnstile, se TURNSTILE_SITE_KEY/TURNSTILE_SECRET estiverem configurados;
- limites por IP, bloqueio temporário da conta após tentativas erradas e mensagens que não revelam
  se um usuário/e-mail existe;
- login com Google (OAuth 2.0 + PKCE, GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET);
- confirmação de e-mail e redefinição de senha por link (SMTP_*; sem SMTP, o link vai para o log).
"""

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import smtplib
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from email.message import EmailMessage

from .. import config

DATA_DIR = config.DATA_DIR
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "contas.db"

GOOGLE_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
GOOGLE_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "").strip()
TURNSTILE_SITE = os.environ.get("TURNSTILE_SITE_KEY", "").strip()
TURNSTILE_SECRET = os.environ.get("TURNSTILE_SECRET", "").strip()
SMTP = {k: os.environ.get(f"SMTP_{k.upper()}", "").strip() for k in ("host", "port", "user", "password", "from")}
PUBLIC_URL = os.environ.get("PUBLIC_URL", "").strip().rstrip("/")

COOKIE = "placar_sid"
SESSION_DAYS = 30
MAX_SESSIONS = 10
POW_MAX = int(os.environ.get("CAPTCHA_DIFICULDADE", "60000"))  # média de ~30 mil hashes: 1–2 s no celular
LOCK_AFTER, LOCK_SECONDS = 5, 15 * 60
DATA_KEYS = re.compile(r"^placar\.(favs|palpites|alerts|theme|gostos|craque\.[\w.-]+|sim\.\d+|pen[\w.-]*|game\.[\w.-]+)$")
MAX_DATA = 200_000
RESERVED = {"admin", "administrador", "root", "placar", "suporte", "api", "sistema", "moderador", "oficial", "null", "undefined"}
COMMON = {"12345678", "123456789", "1234567890", "password", "senha123", "senha1234", "qwerty123", "11111111", "00000000",
          "abc12345", "12341234", "flamengo", "corinthians", "palmeiras", "vasco123", "brasil123", "futebol1", "iloveyou",
          "password1", "88888888", "87654321", "admin123", "qwertyui", "flamengo1", "flamengo123"}


def _secret() -> bytes:
    env = os.environ.get("SECRET_KEY", "").strip()
    if env:
        return env.encode()
    f = DATA_DIR / "secret.key"
    if not f.exists():
        f.write_text(secrets.token_hex(32))
        try:
            os.chmod(f, 0o600)
        except OSError:
            pass
    return f.read_text().strip().encode()


SECRET = _secret()

# ---------------------------------------------------------------- banco
_db = sqlite3.connect(DB_PATH, check_same_thread=False, isolation_level=None)
_db.row_factory = sqlite3.Row
_lock = threading.RLock()
with _lock:
    _db.execute("PRAGMA journal_mode=WAL")
    _db.execute("PRAGMA foreign_keys=ON")
    _db.executescript("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      name TEXT, pw TEXT, google_sub TEXT UNIQUE, avatar TEXT, verified INTEGER NOT NULL DEFAULT 0,
      created REAL NOT NULL, last_login REAL, failed INTEGER NOT NULL DEFAULT 0, locked_until REAL NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '{}', data_at REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created REAL NOT NULL, expires REAL NOT NULL, last_seen REAL NOT NULL, ip TEXT, ua TEXT);
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS tokens (
      id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS pow_used (sig TEXT PRIMARY KEY, expires REAL NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_states (id TEXT PRIMARY KEY, verifier TEXT NOT NULL, next TEXT, expires REAL NOT NULL);
    """)


def q(sql, args=(), one=False):
    with _lock:
        cur = _db.execute(sql, args)
        rows = cur.fetchall()
    return (rows[0] if rows else None) if one else rows


def x(sql, args=()):
    with _lock:
        return _db.execute(sql, args)


def cleanup():
    now = time.time()
    with _lock:
        for t in ("sessions", "tokens", "pow_used", "oauth_states"):
            _db.execute(f"DELETE FROM {t} WHERE expires < ?", (now,))


# ---------------------------------------------------------------- utilidades
def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _b64url(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    d = hashlib.scrypt(pw.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return f"scrypt$16384$8$1${salt.hex()}${d.hex()}"


def check_password(pw: str, stored: str | None) -> bool:
    if not stored:
        hashlib.scrypt(b"x", salt=b"0" * 16, n=2 ** 14, r=8, p=1, dklen=32)  # mesmo tempo com ou sem usuário
        return False
    try:
        _, n, r, p, salt, d = stored.split("$")
        got = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), dklen=len(d) // 2)
        return hmac.compare_digest(got.hex(), d)
    except (ValueError, TypeError):
        return False


USER_RX = re.compile(r"^[a-zA-Z0-9_][a-zA-Z0-9_.]{2,19}$")
EMAIL_RX = re.compile(r"^[^@\s]{1,64}@[^@\s]+\.[a-zA-Z]{2,}$")


def password_problem(pw: str, username="", email="") -> str | None:
    if len(pw) < 8:
        return "A senha precisa ter pelo menos 8 caracteres."
    if len(pw) > 128:
        return "A senha pode ter no máximo 128 caracteres."
    low = pw.lower()
    if low in COMMON or len(set(pw)) < 4:
        return "Essa senha é muito fácil de adivinhar. Escolha outra."
    if username and username.lower() in low or email and email.split("@")[0].lower() in low and len(email.split("@")[0]) > 3:
        return "A senha não pode conter seu usuário ou e-mail."
    if not (re.search(r"[A-Za-z]", pw) and re.search(r"[\d\W_]", pw)):
        return "Use letras e pelo menos um número ou símbolo."
    return None


class Limiter:
    def __init__(self):
        self.hits: dict[str, list[float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str, limit: int, window: int) -> bool:
        now = time.time()
        with self.lock:
            h = [t for t in self.hits.get(key, []) if now - t < window]
            ok = len(h) < limit
            if ok:
                h.append(now)
            self.hits[key] = h
            if len(self.hits) > 50_000:
                self.hits.clear()
            return ok


LIMIT = Limiter()


class Err(Exception):
    def __init__(self, status, message, **extra):
        super().__init__(message)
        self.status, self.message, self.extra = status, message, extra


# ---------------------------------------------------------------- captcha
def captcha_challenge() -> dict:
    if TURNSTILE_SITE and TURNSTILE_SECRET:
        return {"tipo": "turnstile", "site_key": TURNSTILE_SITE}
    salt = f"{secrets.token_hex(12)}?expires={int(time.time()) + 900}"
    number = secrets.randbelow(POW_MAX)
    challenge = _h(salt + str(number))
    sig = hmac.new(SECRET, challenge.encode(), hashlib.sha256).hexdigest()
    return {"tipo": "pow", "algorithm": "SHA-256", "challenge": challenge, "salt": salt, "maxnumber": POW_MAX, "signature": sig}


def verify_captcha(token, ip: str) -> bool:
    if not token or not isinstance(token, str) or len(token) > 4096:
        return False
    if TURNSTILE_SITE and TURNSTILE_SECRET:
        try:
            data = urllib.parse.urlencode({"secret": TURNSTILE_SECRET, "response": token, "remoteip": ip}).encode()
            with urllib.request.urlopen("https://challenges.cloudflare.com/turnstile/v0/siteverify", data, timeout=10) as r:
                return bool(json.loads(r.read()).get("success"))
        except Exception:  # noqa: BLE001
            return False
    try:
        p = json.loads(base64.b64decode(token))
        salt, number, challenge, sig = str(p["salt"]), int(p["number"]), str(p["challenge"]), str(p["signature"])
    except Exception:  # noqa: BLE001
        return False
    m = re.search(r"expires=(\d+)", salt)
    if not m or int(m.group(1)) < time.time():
        return False
    if not hmac.compare_digest(hmac.new(SECRET, challenge.encode(), hashlib.sha256).hexdigest(), sig):
        return False
    if not hmac.compare_digest(_h(salt + str(number)), challenge):
        return False
    try:  # cada desafio vale uma vez só
        x("INSERT INTO pow_used(sig, expires) VALUES (?, ?)", (sig, int(m.group(1))))
    except sqlite3.IntegrityError:
        return False
    return True


# ---------------------------------------------------------------- e-mail
def base_url(ctx) -> str:
    if PUBLIC_URL:
        return PUBLIC_URL
    host = ctx.get("host", "")
    if re.fullmatch(r"(localhost|127\.0\.0\.1|\[::1\])(:\d+)?", host):
        return f"http://{host}"
    return f"{ctx.get('proto', 'https')}://{host}"


def send_mail(to: str, subject: str, text: str):
    def run():
        if not SMTP["host"]:
            sys.stderr.write(f"[e-mail não enviado: configure SMTP_HOST] para {to}: {subject}\n{text}\n")
            return
        try:
            msg = EmailMessage()
            msg["From"] = SMTP["from"] or SMTP["user"]
            msg["To"], msg["Subject"] = to, subject
            msg.set_content(text)
            port = int(SMTP["port"] or 587)
            if port == 465:
                s = smtplib.SMTP_SSL(SMTP["host"], port, timeout=20)
            else:
                s = smtplib.SMTP(SMTP["host"], port, timeout=20)
                s.starttls()
            with s:
                if SMTP["user"]:
                    s.login(SMTP["user"], SMTP["password"])
                s.send_message(msg)
        except Exception as e:  # noqa: BLE001
            sys.stderr.write(f"e-mail falhou para {to}: {e!r}\n")
    threading.Thread(target=run, daemon=True).start()


def _new_token(user_id: int, kind: str, ttl: int) -> str:
    tok = secrets.token_urlsafe(32)
    x("DELETE FROM tokens WHERE user_id=? AND kind=?", (user_id, kind))
    x("INSERT INTO tokens(id, user_id, kind, expires) VALUES (?,?,?,?)", (_h(tok), user_id, kind, time.time() + ttl))
    return tok


def _use_token(tok: str, kind: str):
    if not tok or len(tok) > 200:
        return None
    row = q("SELECT * FROM tokens WHERE id=? AND kind=?", (_h(tok), kind), one=True)
    if not row:
        return None
    x("DELETE FROM tokens WHERE id=?", (row["id"],))
    return row["user_id"] if row["expires"] > time.time() else None


def send_verification(u, ctx):
    tok = _new_token(u["id"], "verify", 48 * 3600)
    link = f"{base_url(ctx)}/api/auth/verificar?token={tok}"
    send_mail(u["email"], "Confirme seu e-mail na Vyra",
              f"Olá, {u['name'] or u['username']}!\n\nConfirme seu e-mail para proteger sua conta na Vyra:\n{link}\n\n"
              "O link vale por 48 horas. Se você não criou esta conta, ignore esta mensagem.")


# ---------------------------------------------------------------- sessões
def public_user(u) -> dict:
    return {"id": u["id"], "usuario": u["username"], "email": u["email"], "nome": u["name"] or u["username"],
            "avatar": u["avatar"], "verificado": bool(u["verified"]), "google": bool(u["google_sub"]),
            "tem_senha": bool(u["pw"]), "criado_em": int(u["created"])}


def _cookie(name, value, ctx, max_age):
    c = f"{name}={value}; Path=/; Max-Age={max_age}; HttpOnly; SameSite=Lax"
    return c + ("; Secure" if ctx.get("proto") == "https" else "")


def start_session(user_id: int, ctx) -> list:
    tok = secrets.token_urlsafe(32)
    now = time.time()
    x("INSERT INTO sessions(id, user_id, created, expires, last_seen, ip, ua) VALUES (?,?,?,?,?,?,?)",
      (_h(tok), user_id, now, now + SESSION_DAYS * 86400, now, ctx.get("ip", ""), (ctx.get("ua") or "")[:200]))
    old = q("SELECT id FROM sessions WHERE user_id=? ORDER BY last_seen DESC LIMIT -1 OFFSET ?", (user_id, MAX_SESSIONS))
    for r in old:
        x("DELETE FROM sessions WHERE id=?", (r["id"],))
    x("UPDATE users SET last_login=?, failed=0, locked_until=0 WHERE id=?", (now, user_id))
    return [("Set-Cookie", _cookie(COOKIE, tok, ctx, SESSION_DAYS * 86400))]


def current(ctx):
    """(usuário, id da sessão) a partir do cookie, ou (None, None)."""
    tok = (ctx.get("cookies") or {}).get(COOKIE)
    if not tok or len(tok) > 100:
        return None, None
    sid = _h(tok)
    s = q("SELECT * FROM sessions WHERE id=?", (sid,), one=True)
    if not s or s["expires"] < time.time():
        return None, None
    if time.time() - s["last_seen"] > 300:
        x("UPDATE sessions SET last_seen=?, ip=? WHERE id=?", (time.time(), ctx.get("ip", ""), sid))
    u = q("SELECT * FROM users WHERE id=?", (s["user_id"],), one=True)
    return (u, sid) if u else (None, None)


def _need_user(ctx):
    u, sid = current(ctx)
    if not u:
        raise Err(401, "Entre na sua conta para continuar.")
    return u, sid


def _unique_username(base: str) -> str:
    base = re.sub(r"[^a-zA-Z0-9_]", "", base)[:16] or "torcedor"
    if len(base) < 3:
        base = (base + "fc").ljust(3, "0")
    name, n = base, 1
    while name.lower() in RESERVED or q("SELECT 1 FROM users WHERE username=?", (name,), one=True):
        n += 1
        name = f"{base[:16]}{n}"
    return name


# ---------------------------------------------------------------- Google
def google_start(query, ctx):
    if not (GOOGLE_ID and GOOGLE_SECRET):
        raise Err(404, "Login com Google não configurado.")
    state, verifier = secrets.token_urlsafe(24), secrets.token_urlsafe(48)
    nxt = query.get("next") or "/#/conta"
    if not nxt.startswith("/#/"):
        nxt = "/#/conta"
    x("INSERT INTO oauth_states(id, verifier, next, expires) VALUES (?,?,?,?)", (_h(state), verifier, nxt, time.time() + 600))
    params = {"client_id": GOOGLE_ID, "redirect_uri": f"{base_url(ctx)}/api/auth/google/retorno", "response_type": "code",
              "scope": "openid email profile", "state": state, "prompt": "select_account",
              "code_challenge": _b64url(hashlib.sha256(verifier.encode()).digest()), "code_challenge_method": "S256"}
    return 302, None, [("Location", "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)),
                       ("Set-Cookie", _cookie("placar_oauth", state, ctx, 600))]


def google_callback(query, ctx):
    fail = lambda code: (302, None, [("Location", f"/#/entrar?erro={code}"), ("Set-Cookie", _cookie("placar_oauth", "", ctx, 0))])  # noqa: E731
    state = query.get("state") or ""
    if not state or not hmac.compare_digest(state, (ctx.get("cookies") or {}).get("placar_oauth", "")):
        return fail("google_estado")
    row = q("SELECT * FROM oauth_states WHERE id=?", (_h(state),), one=True)
    x("DELETE FROM oauth_states WHERE id=?", (_h(state),))
    if not row or row["expires"] < time.time() or query.get("error") or not query.get("code"):
        return fail("google_cancelado")
    try:
        data = urllib.parse.urlencode({"code": query["code"], "client_id": GOOGLE_ID, "client_secret": GOOGLE_SECRET,
                                       "redirect_uri": f"{base_url(ctx)}/api/auth/google/retorno", "grant_type": "authorization_code",
                                       "code_verifier": row["verifier"]}).encode()
        with urllib.request.urlopen("https://oauth2.googleapis.com/token", data, timeout=15) as r:
            tok = json.loads(r.read())
        # o id_token veio direto do Google por HTTPS (troca autenticada com o client secret): basta conferir os campos
        payload = tok["id_token"].split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"google oauth: {e!r}\n")
        return fail("google_falhou")
    if claims.get("aud") != GOOGLE_ID or claims.get("iss") not in ("accounts.google.com", "https://accounts.google.com") \
            or claims.get("exp", 0) < time.time() or not claims.get("sub") or not claims.get("email"):
        return fail("google_falhou")
    sub, email = str(claims["sub"]), claims["email"].lower()
    verified = bool(claims.get("email_verified"))
    u = q("SELECT * FROM users WHERE google_sub=?", (sub,), one=True)
    if not u:
        u = q("SELECT * FROM users WHERE email=?", (email,), one=True)
        if u:
            if not verified:
                return fail("google_email")
            # vincula à conta existente. Se o e-mail dela nunca foi confirmado, a senha antiga pode ter sido
            # criada por outra pessoa com este e-mail: ela é descartada (o dono pode criar outra na conta).
            x("UPDATE users SET google_sub=?, avatar=COALESCE(avatar, ?), verified=1, pw=CASE WHEN verified=1 THEN pw ELSE NULL END WHERE id=?",
              (sub, claims.get("picture"), u["id"]))
            if not u["verified"]:
                x("DELETE FROM sessions WHERE user_id=?", (u["id"],))
        else:
            uname = _unique_username(email.split("@")[0])
            x("INSERT INTO users(username, email, name, google_sub, avatar, verified, created) VALUES (?,?,?,?,?,?,?)",
              (uname, email, (claims.get("name") or "")[:60] or None, sub, claims.get("picture"), int(verified), time.time()))
        u = q("SELECT * FROM users WHERE google_sub=?", (sub,), one=True)
    return 302, None, [("Location", row["next"] or "/#/conta"), ("Set-Cookie", _cookie("placar_oauth", "", ctx, 0)),
                       *start_session(u["id"], ctx)]


# ---------------------------------------------------------------- rotas
def config() -> dict:
    return {"google": bool(GOOGLE_ID and GOOGLE_SECRET), "captcha": "turnstile" if TURNSTILE_SITE and TURNSTILE_SECRET else "pow",
            "turnstile_site_key": TURNSTILE_SITE or None, "email": bool(SMTP["host"])}


def _str(body, k, maxlen=200):
    v = body.get(k)
    return v.strip()[:maxlen] if isinstance(v, str) else ""


def _captcha(body, ctx):
    if body.get("website"):  # campo-armadilha invisível: só robôs preenchem
        raise Err(400, "Não foi possível concluir. Tente de novo.")
    if not verify_captcha(body.get("captcha"), ctx.get("ip", "")):
        raise Err(400, "Confirme que você não é um robô.", campo="captcha")


def register(body, ctx):
    ip = ctx.get("ip", "")
    if not LIMIT.allow(f"reg:{ip}", 5, 3600):
        raise Err(429, "Muitas contas criadas a partir desta conexão. Tente mais tarde.")
    _captcha(body, ctx)
    username, email, pw = _str(body, "usuario", 40), _str(body, "email", 254).lower(), body.get("senha") if isinstance(body.get("senha"), str) else ""
    name = _str(body, "nome", 60)
    if not USER_RX.match(username) or username.lower() in RESERVED:
        raise Err(400, "Usuário inválido: use de 3 a 20 letras, números, _ ou ponto.", campo="usuario")
    if not EMAIL_RX.match(email) or len(email) > 254:
        raise Err(400, "E-mail inválido.", campo="email")
    prob = password_problem(pw, username, email)
    if prob:
        raise Err(400, prob, campo="senha")
    if q("SELECT 1 FROM users WHERE username=?", (username,), one=True):
        raise Err(409, "Esse nome de usuário já está em uso.", campo="usuario")
    if q("SELECT 1 FROM users WHERE email=?", (email,), one=True):
        raise Err(409, "Já existe uma conta com esse e-mail. Entre ou recupere a senha.", campo="email")
    try:
        cur = x("INSERT INTO users(username, email, name, pw, created) VALUES (?,?,?,?,?)",
                (username, email, name or None, hash_password(pw), time.time()))
    except sqlite3.IntegrityError:
        raise Err(409, "Usuário ou e-mail já cadastrado.")
    u = q("SELECT * FROM users WHERE id=?", (cur.lastrowid,), one=True)
    send_verification(u, ctx)
    return 201, {"usuario": public_user(u)}, start_session(u["id"], ctx)


def login(body, ctx):
    ip = ctx.get("ip", "")
    ident, pw = _str(body, "login", 254), body.get("senha") if isinstance(body.get("senha"), str) else ""
    if not LIMIT.allow(f"login:{ip}", 20, 600):
        raise Err(429, "Muitas tentativas. Aguarde alguns minutos.")
    _captcha(body, ctx)
    u = q("SELECT * FROM users WHERE username=? OR email=?", (ident, ident.lower()), one=True)
    if u and u["locked_until"] > time.time():
        check_password(pw, None)
        mins = max(1, int((u["locked_until"] - time.time()) // 60) + 1)
        raise Err(429, f"Conta bloqueada por segurança após várias tentativas. Tente em {mins} min ou redefina a senha.")
    if not u or not check_password(pw, u["pw"] if u else None):
        if u:
            failed = u["failed"] + 1
            x("UPDATE users SET failed=?, locked_until=? WHERE id=?", (failed, time.time() + LOCK_SECONDS if failed >= LOCK_AFTER else 0, u["id"]))
        raise Err(401, "Usuário ou senha incorretos. Se você criou a conta com o Google, use o botão do Google.")
    return 200, {"usuario": public_user(u)}, start_session(u["id"], ctx)


def forgot(body, ctx):
    ip = ctx.get("ip", "")
    if not LIMIT.allow(f"forgot:{ip}", 5, 3600):
        raise Err(429, "Muitos pedidos. Tente mais tarde.")
    _captcha(body, ctx)
    email = _str(body, "email", 254).lower()
    u = q("SELECT * FROM users WHERE email=?", (email,), one=True) if EMAIL_RX.match(email) else None
    if u and LIMIT.allow(f"forgot:{email}", 3, 3600):
        tok = _new_token(u["id"], "reset", 3600)
        send_mail(u["email"], "Redefinir sua senha da Vyra",
                  f"Recebemos um pedido para redefinir a senha da conta {u['username']}.\n\n"
                  f"Crie uma senha nova por este link (vale por 1 hora):\n{base_url(ctx)}/#/redefinir?token={tok}\n\n"
                  "Se não foi você, ignore este e-mail: sua senha continua a mesma.")
    # mesma resposta exista ou não a conta: não revela quem está cadastrado
    return 200, {"ok": True, "mensagem": "Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha."}, []


def reset(body, ctx):
    if not LIMIT.allow(f"reset:{ctx.get('ip', '')}", 10, 3600):
        raise Err(429, "Muitas tentativas. Tente mais tarde.")
    pw = body.get("senha") if isinstance(body.get("senha"), str) else ""
    row = q("SELECT * FROM tokens WHERE id=? AND kind='reset'", (_h(_str(body, "token", 200)),), one=True)
    if not row or row["expires"] < time.time():
        raise Err(400, "Link inválido ou expirado. Peça um novo.")
    u = q("SELECT * FROM users WHERE id=?", (row["user_id"],), one=True)
    prob = password_problem(pw, u["username"], u["email"])
    if prob:
        raise Err(400, prob, campo="senha")
    _use_token(_str(body, "token", 200), "reset")
    x("UPDATE users SET pw=?, failed=0, locked_until=0, verified=1 WHERE id=?", (hash_password(pw), u["id"]))  # o link provou o e-mail
    x("DELETE FROM sessions WHERE user_id=?", (u["id"],))  # derruba todas as sessões antigas
    return 200, {"usuario": public_user(q("SELECT * FROM users WHERE id=?", (u["id"],), one=True))}, start_session(u["id"], ctx)


def verify_email(query, ctx):
    uid = _use_token(query.get("token") or "", "verify")
    if not uid:
        return 302, None, [("Location", "/#/conta?verificado=0")]
    x("UPDATE users SET verified=1 WHERE id=?", (uid,))
    return 302, None, [("Location", "/#/conta?verificado=1")]


def _data_clean(data) -> str:
    if not isinstance(data, dict):
        raise Err(400, "Dados inválidos.")
    clean = {k: v for k, v in data.items() if isinstance(k, str) and DATA_KEYS.match(k)}
    raw = json.dumps(clean, ensure_ascii=False, separators=(",", ":"))
    if len(raw) > MAX_DATA:
        raise Err(413, "Dados grandes demais para sincronizar.")
    return raw


def handle(method: str, path: str, query: dict, body: dict, ctx: dict):
    """Devolve (status, objeto JSON ou None, [(cabeçalho, valor)])."""
    try:
        if method == "POST":
            # CSRF: cabeçalho próprio (formulários de outros sites não conseguem enviá-lo) + origem do próprio site
            origin = ctx.get("origin") or ""
            if ctx.get("xrw") != "placar" or (origin and urllib.parse.urlsplit(origin).netloc != ctx.get("host")):
                raise Err(403, "Requisição bloqueada por segurança. Recarregue a página.")
        if not LIMIT.allow(f"auth:{ctx.get('ip', '')}", 120, 60):
            raise Err(429, "Muitas requisições. Aguarde um instante.")
        r = (method, path)
        if r == ("GET", "/auth/config"):
            return 200, config(), []
        if r == ("GET", "/auth/captcha"):
            if not LIMIT.allow(f"cap:{ctx.get('ip', '')}", 30, 60):
                raise Err(429, "Muitas requisições. Aguarde um instante.")
            return 200, captcha_challenge(), []
        if r == ("GET", "/auth/eu"):
            u, _ = current(ctx)
            return 200, {"usuario": public_user(u) if u else None}, []
        if r == ("POST", "/auth/cadastro"):
            return register(body, ctx)
        if r == ("POST", "/auth/entrar"):
            return login(body, ctx)
        if r == ("POST", "/auth/sair"):
            _, sid = current(ctx)
            if sid:
                x("DELETE FROM sessions WHERE id=?", (sid,))
            return 200, {"ok": True}, [("Set-Cookie", _cookie(COOKIE, "", ctx, 0))]
        if r == ("POST", "/auth/esqueci"):
            return forgot(body, ctx)
        if r == ("POST", "/auth/redefinir"):
            return reset(body, ctx)
        if r == ("GET", "/auth/verificar"):
            return verify_email(query, ctx)
        if r == ("GET", "/auth/google"):
            return google_start(query, ctx)
        if r == ("GET", "/auth/google/retorno"):
            return google_callback(query, ctx)

        u, sid = _need_user(ctx)
        if r == ("POST", "/auth/reenviar"):
            if u["verified"]:
                return 200, {"ok": True, "mensagem": "Seu e-mail já está confirmado."}, []
            if not LIMIT.allow(f"verify:{u['id']}", 3, 3600):
                raise Err(429, "Você já pediu vários e-mails. Tente mais tarde.")
            send_verification(u, ctx)
            return 200, {"ok": True, "mensagem": f"Enviamos um novo link para {u['email']}."}, []
        if r == ("GET", "/conta/dados"):
            return 200, {"dados": json.loads(u["data"] or "{}"), "atualizado_em": u["data_at"]}, []
        if r == ("POST", "/conta/dados"):
            raw = _data_clean(body.get("dados"))
            now = time.time()
            x("UPDATE users SET data=?, data_at=? WHERE id=?", (raw, now, u["id"]))
            return 200, {"ok": True, "atualizado_em": now}, []
        if r == ("POST", "/conta/perfil"):
            name, uname = _str(body, "nome", 60), _str(body, "usuario", 40)
            if uname and uname.lower() != u["username"].lower():
                if not USER_RX.match(uname) or uname.lower() in RESERVED:
                    raise Err(400, "Usuário inválido: use de 3 a 20 letras, números, _ ou ponto.", campo="usuario")
                if q("SELECT 1 FROM users WHERE username=? AND id<>?", (uname, u["id"]), one=True):
                    raise Err(409, "Esse nome de usuário já está em uso.", campo="usuario")
            x("UPDATE users SET name=?, username=? WHERE id=?", (name or None, uname or u["username"], u["id"]))
            return 200, {"usuario": public_user(q("SELECT * FROM users WHERE id=?", (u["id"],), one=True))}, []
        if r == ("POST", "/conta/senha"):
            if not LIMIT.allow(f"pw:{u['id']}", 5, 900):
                raise Err(429, "Muitas tentativas. Aguarde alguns minutos.")
            cur_pw, new = body.get("atual") or "", body.get("nova") or ""
            if u["pw"] and not check_password(str(cur_pw), u["pw"]):
                raise Err(400, "Senha atual incorreta.", campo="atual")
            prob = password_problem(str(new), u["username"], u["email"])
            if prob:
                raise Err(400, prob, campo="nova")
            x("UPDATE users SET pw=? WHERE id=?", (hash_password(str(new)), u["id"]))
            x("DELETE FROM sessions WHERE user_id=? AND id<>?", (u["id"], sid))  # outras sessões saem
            return 200, {"ok": True, "mensagem": "Senha alterada. As outras sessões foram encerradas."}, []
        if r == ("GET", "/conta/sessoes"):
            rows = q("SELECT id, created, last_seen, ip, ua FROM sessions WHERE user_id=? AND expires>? ORDER BY last_seen DESC", (u["id"], time.time()))
            return 200, {"sessoes": [{"atual": s["id"] == sid, "criada_em": int(s["created"]), "visto_em": int(s["last_seen"]),
                                      "ip": s["ip"], "dispositivo": s["ua"]} for s in rows]}, []
        if r == ("POST", "/conta/sair-todas"):
            x("DELETE FROM sessions WHERE user_id=? AND id<>?", (u["id"], sid))
            return 200, {"ok": True, "mensagem": "As outras sessões foram encerradas."}, []
        if r == ("POST", "/conta/excluir"):
            if u["pw"]:
                if not check_password(str(body.get("senha") or ""), u["pw"]):
                    raise Err(400, "Senha incorreta.", campo="senha")
            elif _str(body, "confirmar", 40).lower() != u["username"].lower():
                raise Err(400, "Digite seu nome de usuário para confirmar.", campo="confirmar")
            x("DELETE FROM users WHERE id=?", (u["id"],))
            return 200, {"ok": True}, [("Set-Cookie", _cookie(COOKIE, "", ctx, 0))]
        raise Err(404, "Rota não encontrada.")
    except Err as e:
        return e.status, {"message": e.message, **e.extra}, []
