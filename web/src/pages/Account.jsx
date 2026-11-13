import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { account, setUser, syncPull, Taste, getFavs, store, useStoreVersion } from '../lib/store.js';
import { Panel, Head, Skel, Stagger, Item, ease } from '../components/ui.jsx';
import { Mark } from '../components/Shell.jsx';

async function authFetch(method, path, body) {
  const headers = { 'X-Requested-With': 'placar' };
  if (body) headers['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch('/api' + path, { method, headers, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }); } catch {
    throw new Error('Sem conexão com o servidor. Verifique a internet e tente de novo.');
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(d.message || `Erro ${r.status}`); e.campo = d.campo; e.status = r.status; throw e; }
  return d;
}

/* ---------- captcha: prova de trabalho (ou Cloudflare Turnstile, se configurado) ---------- */
async function solvePow(c, progress) {
  if (!(window.crypto && crypto.subtle)) throw new Error('Seu navegador não suporta a verificação. Use HTTPS ou atualize o navegador.');
  const target = new Uint8Array(c.challenge.match(/../g).map((h) => parseInt(h, 16)));
  const enc = new TextEncoder();
  for (let start = 0; start <= c.maxnumber; start += 2000) {
    const end = Math.min(c.maxnumber, start + 1999);
    const jobs = [];
    for (let n = start; n <= end; n++) jobs.push(crypto.subtle.digest('SHA-256', enc.encode(c.salt + n)));
    const hashes = await Promise.all(jobs);
    for (let i = 0; i < hashes.length; i++) { const h = new Uint8Array(hashes[i]); if (h.every((b, j) => b === target[j])) return start + i; }
    if (progress) progress(end / c.maxnumber);
  }
  throw new Error('Não foi possível concluir a verificação. Tente de novo.');
}
let tsLoading = null;
const loadTurnstile = () => (window.turnstile ? Promise.resolve() : tsLoading || (tsLoading = new Promise((ok, fail) => {
  const s = document.createElement('script');
  s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.async = true; s.onload = ok;
  s.onerror = () => { tsLoading = null; fail(new Error('Não foi possível carregar o captcha.')); };
  document.head.appendChild(s);
})));

function useCaptcha(cfg) {
  const [state, setState] = useState({ s: 'idle', p: 0, msg: 'Verificação de segurança' });
  const tok = useRef(null), pending = useRef(null), slot = useRef(null), tsId = useRef(null), tsResolve = useRef(null);
  const run = async () => {
    if (cfg && cfg.captcha === 'turnstile') {
      await loadTurnstile();
      return new Promise((ok) => {
        tsResolve.current = ok;
        if (tsId.current == null) tsId.current = window.turnstile.render(slot.current, { sitekey: cfg.turnstile_site_key, language: 'pt-br', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', callback: (t) => { tok.current = t; if (tsResolve.current) tsResolve.current(t); } });
      });
    }
    setState({ s: 'working', p: 0, msg: 'Verificando…' });
    const c = await authFetch('GET', '/auth/captcha');
    const number = await solvePow(c, (p) => setState({ s: 'working', p, msg: 'Verificando…' }));
    tok.current = btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, salt: c.salt, signature: c.signature, number }));
    setState({ s: 'ok', p: 1, msg: 'Verificado' });
    return tok.current;
  };
  const get = () => {
    if (tok.current) return Promise.resolve(tok.current);
    if (!pending.current) pending.current = run().catch((e) => { pending.current = null; setState({ s: 'error', p: 0, msg: e.message }); throw e; });
    return pending.current;
  };
  const reset = () => {
    tok.current = null; pending.current = null;
    if (tsId.current != null && window.turnstile) { window.turnstile.reset(tsId.current); return; }
    setState({ s: 'idle', p: 0, msg: 'Verificação de segurança' });
  };
  useEffect(() => { if (cfg && cfg.captcha === 'turnstile') get().catch(() => {}); }, [cfg]); // eslint-disable-line react-hooks/exhaustive-deps
  const el = cfg && cfg.captcha === 'turnstile' ? <div ref={slot} className="ts-slot" /> : (
    <button type="button" className={`captcha ${state.s}`} onClick={() => get().catch(() => {})} style={{ '--p': state.p }}>
      <span className="cap-box">{state.s === 'ok' && <motion.svg viewBox="0 0 24 24" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }}><motion.path d="M5 12l5 5 9-10" fill="none" stroke="currentColor" strokeWidth="3" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} /></motion.svg>}</span>
      <span className="cap-txt"><b>Não sou um robô</b><small>{state.msg}</small></span>
      <i className="cap-bar" />
    </button>
  );
  return { el, get, reset };
}

/* ---------- campos ---------- */
function Field({ name, label, type = 'text', err, hint, ...p }) {
  const [show, setShow] = useState(false);
  return (
    <label className={`fld ${err ? 'bad' : ''}`}>
      <span className="fld-l">{label}</span>
      <span className="fld-in">
        <input name={name} type={type === 'password' && show ? 'text' : type} {...p} />
        {type === 'password' && <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label="Mostrar senha" tabIndex={-1}>{show ? 'Ocultar' : 'Mostrar'}</button>}
      </span>
      {hint && !err && <span className="fld-hint">{hint}</span>}
      <AnimatePresence>{err && <motion.span className="fld-err" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{err}</motion.span>}</AnimatePresence>
    </label>
  );
}
function passwordScore(pw, user = '') {
  if (!pw) return { s: 0, t: '' };
  let s = 0;
  if (pw.length >= 8) s++; if (pw.length >= 12) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w\s]/.test(pw)) s++;
  const low = pw.toLowerCase();
  if (pw.length < 8 || new Set(pw).size < 4 || /^(?:123|abc|qwe|senha|password|flamengo|corinthians|palmeiras)/.test(low) || (user && low.includes(user.toLowerCase()))) s = Math.min(s, 1);
  s = Math.min(4, Math.max(1, s - (pw.length < 10 ? 1 : 0)));
  return { s, t: ['', 'Fraca', 'Razoável', 'Boa', 'Forte'][s] };
}
function passwordProblem(pw, user = '', email = '') {
  if (pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (new Set(pw).size < 4) return 'Essa senha é muito fácil de adivinhar.';
  if (!(/[A-Za-z]/.test(pw) && /[\d\W_]/.test(pw))) return 'Use letras e pelo menos um número ou símbolo.';
  if (user && pw.toLowerCase().includes(user.toLowerCase())) return 'A senha não pode conter seu usuário.';
  const local = (email || '').split('@')[0];
  if (local.length > 3 && pw.toLowerCase().includes(local.toLowerCase())) return 'A senha não pode conter seu e-mail.';
  return null;
}
const Meter = ({ pw, user }) => { const r = passwordScore(pw, user); return <div className="pw-meter" data-s={r.s}>{[1, 2, 3, 4].map((i) => <motion.i key={i} animate={{ opacity: r.s >= i ? 1 : 0.25 }} />)}<span>{r.t}</span></div>; };
const FormMsg = ({ msg }) => <AnimatePresence>{msg && <motion.div className={`form-msg ${msg.ok ? 'ok' : 'err'}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} role="alert">{msg.text}</motion.div>}</AnimatePresence>;
const GOOGLE = <svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>;
const GOOGLE_ERRORS = { google_cancelado: 'O login com Google foi cancelado.', google_estado: 'A sessão de login expirou. Tente de novo.', google_falhou: 'Não foi possível entrar com o Google agora. Tente de novo.', google_email: 'Seu e-mail do Google não está confirmado.' };
const safeNext = (n) => (n && /^[a-z0-9/_-]+$/i.test(n) ? `/${n.replace(/^\/+/, '')}` : '/conta');

function AuthShell({ children, side }) {
  return (
    <div className="auth-wrap">
      <motion.div className="auth-card panel" initial={{ opacity: 0, y: 24, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease }}>{children}</motion.div>
      {side}
    </div>
  );
}

/* ---------- Entrar / Criar conta ---------- */
export function Auth() {
  const { pathname } = useLocation();
  const signup = pathname.startsWith('/cadastro');
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const next = safeNext(params.get('next'));
  const { data: cfg } = useApi('/auth/config', { ttl: 3_600_000 });
  const cap = useCaptcha(cfg);
  const [v, setV] = useState({ nome: '', usuario: '', email: '', senha: '', login: '', website: '', termos: false });
  const [errs, setErrs] = useState({});
  const [msg, setMsg] = useState(GOOGLE_ERRORS[params.get('erro')] ? { text: GOOGLE_ERRORS[params.get('erro')] } : null);
  const [busy, setBusy] = useState(false);
  useStoreVersion();
  useEffect(() => { if (account.user) navigate(next, { replace: true }); }, [account.user]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (k) => (e) => { setV((o) => ({ ...o, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value })); setErrs((o) => ({ ...o, [k]: null })); };
  const submit = async (e) => {
    e.preventDefault();
    if (busy) return;
    const E = {};
    (signup ? ['usuario', 'email', 'senha'] : ['login', 'senha']).forEach((n) => { if (!v[n]) E[n] = 'Preencha este campo.'; });
    if (signup) {
      if (v.usuario && !/^[A-Za-z0-9_][A-Za-z0-9_.]{2,19}$/.test(v.usuario)) E.usuario = 'Use de 3 a 20 letras, números, _ ou ponto.';
      if (v.email && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v.email)) E.email = 'E-mail inválido.';
      const p = v.senha && passwordProblem(v.senha, v.usuario, v.email); if (p) E.senha = p;
      if (!v.termos) E.termos = 'Você precisa aceitar os termos.';
    }
    setErrs(E);
    if (Object.values(E).some(Boolean)) return;
    setBusy(true); setMsg(null);
    try {
      const captcha = await cap.get();
      const body = signup ? { nome: v.nome.trim(), usuario: v.usuario.trim(), email: v.email.trim(), senha: v.senha, website: v.website, captcha } : { login: v.login.trim(), senha: v.senha, website: v.website, captcha };
      const d = await authFetch('POST', signup ? '/auth/cadastro' : '/auth/entrar', body);
      setUser(d.usuario);
      navigate(signup ? '/conta?novo=1' : next, { replace: true });
    } catch (err) {
      if (err.campo) setErrs((o) => ({ ...o, [err.campo]: err.message })); else setMsg({ text: err.message });
    } finally { cap.reset(); setBusy(false); }
  };
  const q = params.get('next') ? `?next=${encodeURIComponent(params.get('next'))}` : '';
  return (
    <AuthShell side={(
      <motion.div className="auth-side" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
        <b>Sua conta é protegida</b>
        <ul><li>Senha guardada com criptografia (scrypt), nunca em texto</li><li>Bloqueio automático após tentativas erradas</li><li>Verificação contra robôs em cada acesso</li><li>Você pode sair de todos os aparelhos ou excluir a conta quando quiser</li></ul>
      </motion.div>
    )}>
      <div className="auth-head"><Mark /><h1>{signup ? 'Crie sua conta' : 'Entre no Placar'}</h1><p>{signup ? 'Salve seus times, palpites do bolão e recordes dos minijogos em qualquer aparelho.' : 'Seus favoritos e palpites em todos os seus aparelhos.'}</p></div>
      <div className="seg auth-seg">
        <Link to={`/entrar${q}`} className={signup ? '' : 'on'} replace>Entrar{!signup && <motion.span layoutId="seg-auth" className="seg-ind" />}</Link>
        <Link to={`/cadastro${q}`} className={signup ? 'on' : ''} replace>Criar conta{signup && <motion.span layoutId="seg-auth" className="seg-ind" />}</Link>
      </div>
      {cfg && cfg.google && <><a className="btn btn-google" href={`/api/auth/google?next=${encodeURIComponent('/#' + next)}`}>{GOOGLE}<span>{signup ? 'Criar conta com Google' : 'Continuar com Google'}</span></a><div className="or"><span>ou com e-mail</span></div></>}
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormMsg msg={msg} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={signup ? 's' : 'l'} className="auth-fields" initial={{ opacity: 0, x: signup ? 30 : -30 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: signup ? -30 : 30 }} transition={{ duration: 0.3, ease }}>
            {signup ? (
              <>
                <Field name="nome" label="Nome (opcional)" value={v.nome} onChange={set('nome')} autoComplete="name" maxLength={60} />
                <Field name="usuario" label="Nome de usuário" value={v.usuario} onChange={set('usuario')} err={errs.usuario} autoComplete="username" maxLength={20} autoCapitalize="off" spellCheck={false} hint="De 3 a 20 letras, números, _ ou ponto. Aparece no ranking do bolão." />
                <Field name="email" label="E-mail" type="email" value={v.email} onChange={set('email')} err={errs.email} autoComplete="email" maxLength={254} inputMode="email" />
                <Field name="senha" label="Senha" type="password" value={v.senha} onChange={set('senha')} err={errs.senha} autoComplete="new-password" maxLength={128} />
                <Meter pw={v.senha} user={v.usuario} />
              </>
            ) : (
              <>
                <Field name="login" label="Usuário ou e-mail" value={v.login} onChange={set('login')} err={errs.login} autoComplete="username" maxLength={254} autoCapitalize="off" spellCheck={false} autoFocus />
                <Field name="senha" label="Senha" type="password" value={v.senha} onChange={set('senha')} err={errs.senha} autoComplete="current-password" maxLength={128} />
                <Link className="link-right" to="/esqueci">Esqueci minha senha</Link>
              </>
            )}
          </motion.div>
        </AnimatePresence>
        <input type="text" name="website" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={v.website} onChange={set('website')} />
        {cap.el}
        {signup && <label className="chk"><input type="checkbox" checked={v.termos} onChange={set('termos')} /> <span>Li e aceito os <Link to="/sobre">termos de uso e a política de privacidade</Link>.</span></label>}
        {errs.termos && <span className="fld-err">{errs.termos}</span>}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? <span className="spin" /> : signup ? 'Criar conta' : 'Entrar'}</button>
      </form>
      <p className="auth-foot">{signup ? <>Já tem conta? <Link to={`/entrar${q}`}>Entrar</Link></> : <>Ainda não tem conta? <Link to={`/cadastro${q}`}>Criar conta grátis</Link></>}</p>
    </AuthShell>
  );
}

/* ---------- Esqueci a senha ---------- */
export function Forgot() {
  const { data: cfg } = useApi('/auth/config', { ttl: 3_600_000 });
  const cap = useCaptcha(cfg);
  const [email, setEmail] = useState(''); const [hp, setHp] = useState('');
  const [err, setErr] = useState(null); const [msg, setMsg] = useState(null); const [busy, setBusy] = useState(false); const [sent, setSent] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) { setErr('E-mail inválido.'); return; }
    setBusy(true); setMsg(null);
    try { const d = await authFetch('POST', '/auth/esqueci', { email: email.trim(), website: hp, captcha: await cap.get() }); setMsg({ ok: true, text: d.mensagem }); setSent(true); }
    catch (x) { setMsg({ text: x.message }); } finally { cap.reset(); setBusy(false); }
  };
  return (
    <AuthShell>
      <div className="auth-head"><Mark /><h1>Recuperar senha</h1><p>Informe o e-mail da conta. Enviaremos um link para criar uma senha nova.</p></div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormMsg msg={msg} />
        <Field name="email" label="E-mail" type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(null); }} err={err} autoComplete="email" autoFocus />
        <input type="text" className="hp" tabIndex={-1} autoComplete="off" aria-hidden="true" value={hp} onChange={(e) => setHp(e.target.value)} />
        {cap.el}
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? <span className="spin" /> : sent ? 'Enviar de novo' : 'Enviar link'}</button>
      </form>
      <p className="auth-foot"><Link to="/entrar">Voltar para o login</Link></p>
    </AuthShell>
  );
}

/* ---------- Criar senha nova (link do e-mail) ---------- */
export function Reset() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';
  const [pw, setPw] = useState(''); const [err, setErr] = useState(null);
  const [msg, setMsg] = useState(token ? null : { text: 'Link incompleto. Abra o link do e-mail de novo ou peça outro.' });
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const p = passwordProblem(pw); if (p) { setErr(p); return; }
    setBusy(true);
    try { const d = await authFetch('POST', '/auth/redefinir', { token, senha: pw }); setUser(d.usuario); navigate('/conta', { replace: true }); }
    catch (x) { setMsg({ text: x.message }); } finally { setBusy(false); }
  };
  return (
    <AuthShell>
      <div className="auth-head"><Mark /><h1>Criar senha nova</h1><p>Depois de salvar, você entra automaticamente e as sessões antigas são encerradas.</p></div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormMsg msg={msg} />
        <Field name="senha" label="Senha nova" type="password" value={pw} onChange={(e) => { setPw(e.target.value); setErr(null); }} err={err} autoComplete="new-password" autoFocus />
        <Meter pw={pw} />
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>{busy ? <span className="spin" /> : 'Salvar senha'}</button>
      </form>
    </AuthShell>
  );
}

/* ---------- Minha conta ---------- */
function deviceName(ua = '') {
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${br} no ${os}` : os;
}
const fmtWhen = (s) => new Date(s * 1000).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const ago = (s) => { const d = Math.max(0, Date.now() / 1000 - s); return d < 60 ? 'agora' : d < 3600 ? `há ${Math.round(d / 60)} min` : d < 86400 ? `há ${Math.round(d / 3600)} h` : `em ${new Date(s * 1000).toLocaleDateString('pt-BR')}`; };

export function AccountPage() {
  useStoreVersion();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const u = account.user;
  const [sess, setSess] = useState(null);
  const [note, setNote] = useState(params.get('verificado') === '1' ? 'E-mail confirmado. Obrigado!' : params.get('verificado') === '0' ? 'Link de confirmação inválido ou expirado.' : null);
  useEffect(() => { if (u) authFetch('GET', '/conta/sessoes').then(setSess).catch(() => setSess({ sessoes: [] })); }, [u && u.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (account.loaded && !u) navigate('/entrar?next=conta', { replace: true }); }, [account.loaded, u]); // eslint-disable-line react-hooks/exhaustive-deps
  const [prof, setProf] = useState(null);
  const [pw, setPw] = useState({ atual: '', nova: '' });
  const [del, setDel] = useState('');
  const [msgs, setMsgs] = useState({});
  if (!u) return <Skel h={400} />;
  const P = prof || { nome: u.nome === u.usuario ? '' : u.nome, usuario: u.usuario };
  const favN = Object.keys(getFavs()).length;
  const palpN = Object.keys(store.get('placar.palpites', {})).length;
  const others = sess ? sess.sessoes.filter((s) => !s.atual).length : 0;
  const act = (k, fn) => async (e) => { if (e && e.preventDefault) e.preventDefault(); setMsgs((m) => ({ ...m, [k]: null })); try { const text = await fn(); if (text) setMsgs((m) => ({ ...m, [k]: { ok: true, text } })); } catch (x) { setMsgs((m) => ({ ...m, [k]: { text: x.message } })); } };
  return (
    <>
      <section className="acc-hero">
        <motion.div className="acc-av" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 18 }}>
          {u.avatar ? <img src={u.avatar} alt="" referrerPolicy="no-referrer" /> : <span>{String(u.nome || '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase()}</span>}
        </motion.div>
        <div><h1>{u.nome}</h1><p>@{u.usuario} · {u.email}</p>
          <div className="to-meta">{u.verificado ? <span>✓ E-mail confirmado</span> : <span className="warn">E-mail não confirmado</span>}{u.google && <span>Google conectado</span>}<span>Membro desde {new Date(u.criado_em * 1000).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span></div></div>
        <button className="btn" onClick={act('top', async () => { await authFetch('POST', '/auth/sair').catch(() => {}); setUser(null); navigate('/'); })}>Sair</button>
      </section>
      {note && <Panel className="intro-note"><span>{note}</span></Panel>}
      {!u.verificado && <Panel className="intro-note warn"><span>Confirme seu e-mail para conseguir recuperar a conta se esquecer a senha.{params.get('novo') ? ' Enviamos um link agora para você.' : ''}</span>
        <button className="btn" onClick={act('top', async () => (await authFetch('POST', '/auth/reenviar')).mensagem)}>Reenviar e-mail</button><FormMsg msg={msgs.top} /></Panel>}
      <div className="grid-main">
        <div className="col">
          <Panel>
            <Head sub={account.syncedAt ? `salvo ${ago(account.syncedAt)}` : ''}>Sincronização</Head>
            <div className="kpi-grid"><div><b>{favN}</b><span>Times favoritos</span></div><div><b>{palpN}</b><span>Palpites no bolão</span></div><div><b>{Taste.top('t', 50).length}</b><span>Interesses aprendidos</span></div></div>
            <div className="pad small muted">Favoritos, palpites, simulações, recordes dos minijogos e tema ficam salvos na sua conta.
              <button className="btn" style={{ marginLeft: 10 }} onClick={act('sync', async () => { await syncPull(); return 'Sincronizado agora.'; })}>Sincronizar agora</button></div>
            <div className="pad"><FormMsg msg={msgs.sync} /></div>
          </Panel>
          <Panel><Head>Perfil</Head>
            <form className="acc-form" onSubmit={act('prof', async () => { const d = await authFetch('POST', '/conta/perfil', { nome: P.nome.trim(), usuario: P.usuario.trim() }); setUser(d.usuario); return 'Perfil salvo.'; })}>
              <FormMsg msg={msgs.prof} />
              <div className="grid-2"><Field name="nome" label="Nome" value={P.nome} onChange={(e) => setProf({ ...P, nome: e.target.value })} maxLength={60} /><Field name="usuario" label="Nome de usuário" value={P.usuario} onChange={(e) => setProf({ ...P, usuario: e.target.value })} maxLength={20} /></div>
              <button className="btn btn-primary" type="submit">Salvar perfil</button>
            </form></Panel>
          <Panel><Head>{u.tem_senha ? 'Trocar senha' : 'Criar senha'}</Head>
            <form className="acc-form" onSubmit={act('pw', async () => {
              const p = passwordProblem(pw.nova, u.usuario, u.email); if (p) throw new Error(p);
              const d = await authFetch('POST', '/conta/senha', { atual: pw.atual, nova: pw.nova }); setPw({ atual: '', nova: '' });
              if (!u.tem_senha) { const r = await authFetch('GET', '/auth/eu'); setUser(r.usuario); }
              return d.mensagem;
            })}>
              <FormMsg msg={msgs.pw} />
              {!u.tem_senha && <p className="small muted">Sua conta usa o login com Google. Crie uma senha para também entrar com usuário e senha.</p>}
              <div className="grid-2">{u.tem_senha && <Field name="atual" label="Senha atual" type="password" value={pw.atual} onChange={(e) => setPw({ ...pw, atual: e.target.value })} autoComplete="current-password" />}
                <Field name="nova" label="Senha nova" type="password" value={pw.nova} onChange={(e) => setPw({ ...pw, nova: e.target.value })} autoComplete="new-password" /></div>
              <Meter pw={pw.nova} user={u.usuario} />
              <button className="btn btn-primary" type="submit">{u.tem_senha ? 'Trocar senha' : 'Criar senha'}</button>
            </form></Panel>
          <Panel><Head right={others ? <button className="phead-more" onClick={act('sess', async () => { const d = await authFetch('POST', '/conta/sair-todas'); setSess(await authFetch('GET', '/conta/sessoes')); return d.mensagem; })}>Sair dos outros {others}</button> : null}>Onde você está conectado</Head>
            <FormMsg msg={msgs.sess} />
            {!sess ? <div className="pad"><Skel h={80} /></div> : <Stagger className="list">{sess.sessoes.map((s, i) => <Item key={i} className="li"><span className="sess-ico">{/Android|iPhone|iPad/.test(s.dispositivo) ? '📱' : '💻'}</span><span style={{ flex: 1 }}><b>{deviceName(s.dispositivo)}</b>{s.atual && <span className="tag" style={{ marginLeft: 8 }}>Este aparelho</span>}<small className="muted" style={{ display: 'block' }}>Último acesso {fmtWhen(s.visto_em)} · IP {s.ip || '–'}</small></span></Item>)}</Stagger>}
          </Panel>
          <Panel className="danger"><Head>Excluir conta</Head>
            <form className="acc-form" onSubmit={act('del', async () => {
              if (!window.confirm('Excluir sua conta para sempre? Essa ação não pode ser desfeita.')) return null;
              await authFetch('POST', '/conta/excluir', { senha: u.tem_senha ? del : '', confirmar: u.tem_senha ? '' : del });
              setUser(null); navigate('/'); return null;
            })}>
              <FormMsg msg={msgs.del} />
              <p className="small muted">Apaga sua conta e os dados salvos nela, para sempre. O que está neste aparelho continua aqui.</p>
              {u.tem_senha ? <Field name="senha" label="Confirme sua senha" type="password" value={del} onChange={(e) => setDel(e.target.value)} autoComplete="current-password" />
                : <Field name="confirmar" label={`Digite ${u.usuario} para confirmar`} value={del} onChange={(e) => setDel(e.target.value)} />}
              <button className="btn btn-danger" type="submit">Excluir minha conta</button>
            </form></Panel>
        </div>
        <aside className="col side">
          <Panel><Head right={<button className="phead-more" onClick={() => { if (window.confirm('Limpar o que o Placar aprendeu sobre seus interesses? Seus times seguidos continuam.')) Taste.reset(); }}>Limpar</button>}>Seus interesses</Head>
            <div className="pad fy-chips">{Taste.top('t', 12).filter((x) => x.m && x.m.n).map((x) => <span key={x.id} className="fchip">{x.m.e && <img src={x.m.e} alt="" width="16" />}{x.m.n}</span>)}
              {Taste.top('c', 6).filter((x) => x.m && x.m.n).map((x) => <Link key={x.id} className="fchip" to={`/campeonato/${x.id}`}>{x.m.n}</Link>)}</div></Panel>
        </aside>
      </div>
    </>
  );
}
