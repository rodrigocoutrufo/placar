/* Placar — contas: entrar, criar conta (usuário, e-mail e senha ou Google), captcha, recuperar senha,
 * página da conta e sincronização de favoritos, bolão, minijogos e preferências entre dispositivos.
 * Carregado antes do app.js; usa os helpers de lá (esc, toast, $app, ...) só em tempo de execução. */
'use strict';

const Auth = { user: null, config: null };
const SYNC_RX = /^placar\.(favs|palpites|alerts|theme|gostos|craque\.[\w.-]+|sim\.\d+|pen[\w.-]*|game\.[\w.-]+)$/;

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

/* ============ Estado do usuário ============ */
function initials(name) { return String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase(); }
function userAvatar(u, size = 32) {
  return u.avatar
    ? `<img class="u-av" src="${esc(u.avatar)}" alt="" width="${size}" height="${size}" referrerpolicy="no-referrer">`
    : `<span class="u-av" style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.4)}px">${esc(initials(u.nome))}</span>`;
}
function paintUserBtn() {
  const b = document.getElementById('user-btn');
  if (!b) return;
  const u = Auth.user;
  b.href = u ? '#/conta' : '#/entrar';
  b.title = u ? `Sua conta (@${u.usuario})` : 'Entrar ou criar conta';
  b.setAttribute('aria-label', b.title);
  b.classList.toggle('logged', !!u);
  b.innerHTML = u ? userAvatar(u, 30) : '<svg viewBox="0 0 24 24"><circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/></svg>';
}
function setUser(u) {
  const was = Auth.user && Auth.user.id;
  Auth.user = u || null;
  paintUserBtn();
  if (u && u.id !== was) syncPull();
}
Auth.ready = authFetch('GET', '/auth/eu').then((d) => setUser(d.usuario)).catch(() => {});
const authConfig = () => Auth.config || (Auth.config = authFetch('GET', '/auth/config').catch(() => ({ google: false, captcha: 'pow' })));

/* ============ Sincronização ============ */
function localData() {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!SYNC_RX.test(k)) continue;
      const v = localStorage.getItem(k);
      try { out[k] = JSON.parse(v); } catch { out[k] = v; } // o tema é texto puro
    }
  } catch { /* armazenamento indisponível */ }
  return out;
}
let syncTimer = null, syncing = false;
const syncState = { at: null, error: null };
async function syncPush() {
  if (!Auth.user || syncing) return;
  syncing = true;
  try { const d = await authFetch('POST', '/conta/dados', { dados: localData() }); syncState.at = d.atualizado_em; syncState.error = null; } catch (e) { syncState.error = e.message; } finally { syncing = false; }
}
async function syncPull() {
  let d;
  try { d = await authFetch('GET', '/conta/dados'); } catch { return; }
  const server = d.dados || {}, local = localData();
  let changed = false;
  Object.entries(server).forEach(([k, sv]) => {
    if (!SYNC_RX.test(k)) return;
    const lv = local[k];
    let v = lv;
    if (lv === undefined) v = sv;
    else if (sv && lv && typeof sv === 'object' && typeof lv === 'object' && !Array.isArray(sv)) v = { ...sv, ...lv }; // une favoritos, palpites...
    if (JSON.stringify(v) !== JSON.stringify(lv)) {
      changed = true;
      try { localStorage.setItem(k, typeof v === 'string' && k === 'placar.theme' ? v : JSON.stringify(v)); } catch { /* cheio */ }
    }
  });
  syncState.at = d.atualizado_em;
  await syncPush();
  if (changed) {
    if (window.Taste) Taste.reload();
    const t = localStorage.getItem('placar.theme');
    if (t === 'dark' || t === 'light') document.documentElement.dataset.theme = t;
    toast('Seus favoritos e jogos foram sincronizados com a conta.');
    if (typeof router === 'function') router();
  }
}
// chamado pelo store.set do app.js: qualquer mudança sincroniza em até 1,5 s
window.onStoreSet = (k) => {
  if (!Auth.user || !SYNC_RX.test(k)) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncPush, 1500);
};
window.addEventListener('pagehide', () => { if (syncTimer && Auth.user) { clearTimeout(syncTimer); syncPush(); } });

/* ============ Captcha ============ */
// Prova de trabalho: o servidor manda um desafio SHA-256 assinado; o navegador acha o número que o resolve.
// Custa ~1 s para uma pessoa e torna caro criar contas ou testar senhas em massa. Cada desafio vale uma vez.
async function solvePow(c, progress) {
  if (!(window.crypto && crypto.subtle)) throw new Error('Seu navegador não suporta a verificação. Use HTTPS ou atualize o navegador.');
  const target = new Uint8Array(c.challenge.match(/../g).map((h) => parseInt(h, 16)));
  const enc = new TextEncoder();
  const BATCH = 2000;
  for (let start = 0; start <= c.maxnumber; start += BATCH) {
    const end = Math.min(c.maxnumber, start + BATCH - 1);
    const jobs = [];
    for (let n = start; n <= end; n++) jobs.push(crypto.subtle.digest('SHA-256', enc.encode(c.salt + n)));
    const hashes = await Promise.all(jobs);
    for (let i = 0; i < hashes.length; i++) {
      const h = new Uint8Array(hashes[i]);
      if (h[0] === target[0] && h[1] === target[1] && h.every((b, j) => b === target[j])) return start + i;
    }
    if (progress) progress(end / c.maxnumber);
  }
  throw new Error('Não foi possível concluir a verificação. Tente de novo.');
}

let turnstileLoading = null;
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  return turnstileLoading || (turnstileLoading = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.onload = ok; s.onerror = () => { turnstileLoading = null; fail(new Error('Não foi possível carregar o captcha.')); };
    document.head.appendChild(s);
  }));
}

const CAPTCHA_HTML = `<div class="captcha" data-state="idle">
  <button type="button" class="cap-check" aria-label="Não sou um robô"><span class="cap-box"></span></button>
  <div class="cap-txt"><b>Não sou um robô</b><span>Verificação de segurança</span></div>
  <svg class="cap-shield" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8.3 7 10 4-1.7 7-5.5 7-10V6l-7-3Z"/><path d="m9 12 2 2 4-4"/></svg>
  <i class="cap-bar"></i></div>`;

// Liga o widget: get() devolve um token novo a cada envio (resolve sozinho se a pessoa não clicou).
function captchaController(root) {
  const box = root.querySelector('.captcha');
  let token = null, pending = null, tsId = null, tsResolve = null;
  const setState = (s, txt) => { box.dataset.state = s; if (txt) box.querySelector('.cap-txt span').textContent = txt; };
  const run = async () => {
    const cfg = await authConfig();
    if (cfg.captcha === 'turnstile') {
      await loadTurnstile();
      box.classList.add('ts');
      box.innerHTML = '<div class="ts-slot"></div>';
      return new Promise((ok) => {
        tsResolve = ok;
        tsId = turnstile.render(box.querySelector('.ts-slot'), { sitekey: cfg.turnstile_site_key, language: 'pt-br', theme: document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light',
          callback: (t) => { token = t; if (tsResolve) tsResolve(t); } });
      });
    }
    setState('working', 'Verificando…');
    const c = await authFetch('GET', '/auth/captcha');
    const number = await solvePow(c, (p) => box.style.setProperty('--p', p.toFixed(3)));
    token = btoa(JSON.stringify({ algorithm: c.algorithm, challenge: c.challenge, salt: c.salt, signature: c.signature, number }));
    setState('ok', 'Verificado');
    return token;
  };
  const start = () => {
    if (token) return Promise.resolve(token);
    if (!pending) pending = run().catch((e) => { pending = null; setState('error', e.message); throw e; });
    return pending;
  };
  const btn = box.querySelector('.cap-check');
  if (btn) btn.addEventListener('click', () => { start().catch(() => {}); });
  return {
    get: start,
    reset() { // cada token é de uso único
      token = null; pending = null;
      if (tsId != null && window.turnstile) { turnstile.reset(tsId); return; }
      setState('idle', 'Verificação de segurança');
      box.style.removeProperty('--p');
    },
  };
}

/* ============ Formulários ============ */
const EYE = '<svg viewBox="0 0 24 24"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const GOOGLE_LOGO = '<svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>';

const field = (name, label, type = 'text', attrs = '', hint = '') => `<label class="fld" data-f="${name}">
  <span class="fld-l">${label}</span>
  <span class="fld-in">${type === 'password' ? `<input name="${name}" type="password" ${attrs}><button type="button" class="eye" aria-label="Mostrar senha" tabindex="-1">${EYE}</button>` : `<input name="${name}" type="${type}" ${attrs}>`}</span>
  ${hint ? `<span class="fld-hint">${hint}</span>` : ''}<span class="fld-err" hidden></span></label>`;

function passwordScore(pw, user = '', email = '') {
  if (!pw) return { s: 0, t: '' };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
  if (/\d/.test(pw)) s++;
  if (/[^\w\s]/.test(pw)) s++;
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

function wireForm(form) {
  form.querySelectorAll('.eye').forEach((b) => b.addEventListener('click', () => {
    const i = b.previousElementSibling;
    i.type = i.type === 'password' ? 'text' : 'password';
    b.classList.toggle('on', i.type === 'text');
  }));
  form.querySelectorAll('input').forEach((i) => i.addEventListener('input', () => setFieldError(form, i.name, null)));
}
function setFieldError(form, name, msg) {
  const f = form.querySelector(`[data-f="${name}"]`);
  if (!f) return false;
  f.classList.toggle('bad', !!msg);
  const e = f.querySelector('.fld-err');
  e.hidden = !msg; e.textContent = msg || '';
  return true;
}
function formError(form, msg) {
  const b = form.querySelector('.form-msg');
  b.hidden = !msg; b.className = 'form-msg err'; b.textContent = msg || '';
}
function formOk(form, msg) {
  const b = form.querySelector('.form-msg');
  b.hidden = !msg; b.className = 'form-msg ok'; b.textContent = msg || '';
}
async function submitting(form, fn) {
  const btn = form.querySelector('[type=submit]');
  if (btn.disabled) return;
  const label = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = '<span class="spin"></span>';
  formError(form, null);
  try { await fn(); } catch (e) {
    if (!(e.campo && setFieldError(form, e.campo, e.message))) formError(form, e.message);
    if (e.campo) { const i = form.querySelector(`[name="${e.campo}"]`); if (i) i.focus(); }
  } finally { btn.disabled = false; btn.innerHTML = label; }
}

const GOOGLE_ERRORS = {
  google_cancelado: 'O login com Google foi cancelado.', google_estado: 'A sessão de login expirou. Tente de novo.',
  google_falhou: 'Não foi possível entrar com o Google agora. Tente de novo.', google_email: 'Seu e-mail do Google não está confirmado.',
};
const safeNext = (n) => (n && /^[a-z0-9/_-]+$/i.test(n) ? `#/${n.replace(/^\/+/, '')}` : '#/conta');

/* ============ Telas ============ */
async function viewAuth(mode, ok, params) {
  await Auth.ready;
  if (!ok()) return;
  const next = safeNext(params.get('next'));
  if (Auth.user) { location.replace(next); return; }
  const cfg = await authConfig();
  if (!ok()) return;
  const signup = mode === 'cadastro';
  const gErr = GOOGLE_ERRORS[params.get('erro')];
  $app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    <div class="auth-head"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="7"/><circle cx="16" cy="16" r="8.5" fill="none" stroke="#fff" stroke-width="2.4"/><circle cx="16" cy="16" r="2.6" fill="#fff"/></svg>
      <h1>${signup ? 'Crie sua conta' : 'Entre no Placar'}</h1>
      <p>${signup ? 'Salve seus times, palpites do bolão e recordes dos minijogos em qualquer aparelho.' : 'Seus favoritos e palpites em todos os seus aparelhos.'}</p></div>
    <div class="seg auth-seg"><a href="#/entrar${params.get('next') ? `?next=${esc(params.get('next'))}` : ''}" class="${signup ? '' : 'active'}">Entrar</a><a href="#/cadastro${params.get('next') ? `?next=${esc(params.get('next'))}` : ''}" class="${signup ? 'active' : ''}">Criar conta</a></div>
    ${cfg.google ? `<a class="btn btn-google" href="/api/auth/google?next=${encodeURIComponent('/' + next)}">${GOOGLE_LOGO}<span>${signup ? 'Criar conta com Google' : 'Continuar com Google'}</span></a><div class="or"><span>ou com e-mail</span></div>` : ''}
    <form class="auth-form" novalidate>
      <div class="form-msg ${gErr ? 'err' : ''}" ${gErr ? '' : 'hidden'} role="alert">${gErr ? esc(gErr) : ''}</div>
      ${signup
        ? `${field('nome', 'Nome <em>(opcional)</em>', 'text', 'autocomplete="name" maxlength="60"')}
           ${field('usuario', 'Nome de usuário', 'text', 'autocomplete="username" required minlength="3" maxlength="20" autocapitalize="off" spellcheck="false" pattern="[A-Za-z0-9_][A-Za-z0-9_.]{2,19}"', 'De 3 a 20 letras, números, _ ou ponto. Aparece no ranking do bolão.')}
           ${field('email', 'E-mail', 'email', 'autocomplete="email" required maxlength="254" inputmode="email"')}
           ${field('senha', 'Senha', 'password', 'autocomplete="new-password" required minlength="8" maxlength="128"')}
           <div class="pw-meter" data-s="0"><i></i><i></i><i></i><i></i><span></span></div>`
        : `${field('login', 'Usuário ou e-mail', 'text', 'autocomplete="username" required maxlength="254" autocapitalize="off" spellcheck="false"')}
           ${field('senha', 'Senha', 'password', 'autocomplete="current-password" required maxlength="128"')}
           <a class="small link-right" href="#/esqueci">Esqueci minha senha</a>`}
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${CAPTCHA_HTML}
      ${signup ? '<label class="chk"><input type="checkbox" name="termos" required> <span>Li e aceito os <a href="#/sobre">termos de uso e a política de privacidade</a>.</span></label><span class="fld-err" data-err="termos" hidden></span>' : ''}
      <button class="btn btn-primary btn-block" type="submit">${signup ? 'Criar conta' : 'Entrar'}</button>
    </form>
    <p class="auth-foot small muted">${signup ? 'Já tem conta? <a href="#/entrar">Entrar</a>' : 'Ainda não tem conta? <a href="#/cadastro">Criar conta grátis</a>'}</p>
  </div>
  <div class="auth-side small muted"><b>Sua conta é protegida</b><ul><li>Senha guardada com criptografia (scrypt), nunca em texto</li><li>Bloqueio automático após tentativas erradas</li><li>Verificação contra robôs em cada acesso</li><li>Você pode sair de todos os aparelhos ou excluir a conta quando quiser</li></ul></div></div>`;

  const form = $app.querySelector('.auth-form');
  wireForm(form);
  const cap = captchaController(form);
  const v = (n) => (form.elements[n] ? form.elements[n].value.trim() : '');
  if (signup) {
    const meter = form.querySelector('.pw-meter');
    form.elements.senha.addEventListener('input', () => { const r = passwordScore(form.elements.senha.value, v('usuario')); meter.dataset.s = r.s; meter.querySelector('span').textContent = r.t; });
  }
  (form.elements.nome || form.elements.login).focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      let bad = false;
      const req = signup ? ['usuario', 'email', 'senha'] : ['login', 'senha'];
      req.forEach((n) => { if (!form.elements[n].value) { setFieldError(form, n, 'Preencha este campo.'); bad = true; } });
      if (signup) {
        if (v('usuario') && !/^[A-Za-z0-9_][A-Za-z0-9_.]{2,19}$/.test(v('usuario'))) { setFieldError(form, 'usuario', 'Use de 3 a 20 letras, números, _ ou ponto.'); bad = true; }
        if (v('email') && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(v('email'))) { setFieldError(form, 'email', 'E-mail inválido.'); bad = true; }
        const p = form.elements.senha.value && passwordProblem(form.elements.senha.value, v('usuario'), v('email'));
        if (p) { setFieldError(form, 'senha', p); bad = true; }
        const t = form.querySelector('[data-err=termos]');
        t.hidden = form.elements.termos.checked; t.textContent = 'Você precisa aceitar os termos.';
        if (!form.elements.termos.checked) bad = true;
      }
      if (bad) { const f = form.querySelector('.fld.bad input'); if (f) f.focus(); return; }
      const captcha = await cap.get();
      try {
        const body = signup
          ? { nome: v('nome'), usuario: v('usuario'), email: v('email'), senha: form.elements.senha.value, website: form.elements.website.value, captcha }
          : { login: v('login'), senha: form.elements.senha.value, website: form.elements.website.value, captcha };
        const d = await authFetch('POST', signup ? '/auth/cadastro' : '/auth/entrar', body);
        setUser(d.usuario);
        toast(signup ? `Conta criada! Bem-vindo, ${esc(d.usuario.nome)}.` : `Olá, ${esc(d.usuario.nome)}!`);
        location.hash = signup ? '#/conta?novo=1' : next;
      } finally { cap.reset(); }
    });
  });
}

async function viewForgot(ok) {
  $app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    <div class="auth-head"><h1>Recuperar senha</h1><p>Informe o e-mail da conta. Enviaremos um link para criar uma senha nova.</p></div>
    <form class="auth-form" novalidate><div class="form-msg" hidden role="alert"></div>
      ${field('email', 'E-mail', 'email', 'autocomplete="email" required maxlength="254" inputmode="email"')}
      <input type="text" name="website" class="hp" tabindex="-1" autocomplete="off" aria-hidden="true">
      ${CAPTCHA_HTML}<button class="btn btn-primary btn-block" type="submit">Enviar link</button></form>
    <p class="auth-foot small muted"><a href="#/entrar">Voltar para o login</a></p></div></div>`;
  const form = $app.querySelector('.auth-form');
  wireForm(form);
  const cap = captchaController(form);
  form.elements.email.focus();
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      const email = form.elements.email.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { setFieldError(form, 'email', 'E-mail inválido.'); return; }
      try {
        const d = await authFetch('POST', '/auth/esqueci', { email, website: form.elements.website.value, captcha: await cap.get() });
        formOk(form, d.mensagem);
        form.querySelector('[type=submit]').textContent = 'Enviar de novo';
      } finally { cap.reset(); }
    });
  });
  void ok;
}

async function viewReset(ok, params) {
  const token = params.get('token') || '';
  $app.innerHTML = `<div class="auth-wrap"><div class="card auth-card">
    <div class="auth-head"><h1>Criar senha nova</h1><p>Depois de salvar, você entra automaticamente e as sessões antigas são encerradas.</p></div>
    <form class="auth-form" novalidate><div class="form-msg" hidden role="alert"></div>
      ${field('senha', 'Senha nova', 'password', 'autocomplete="new-password" required minlength="8" maxlength="128"')}
      <div class="pw-meter" data-s="0"><i></i><i></i><i></i><i></i><span></span></div>
      <button class="btn btn-primary btn-block" type="submit">Salvar senha</button></form></div></div>`;
  const form = $app.querySelector('.auth-form');
  wireForm(form);
  if (!token) formError(form, 'Link incompleto. Abra o link do e-mail de novo ou peça outro.');
  const meter = form.querySelector('.pw-meter');
  form.elements.senha.addEventListener('input', () => { const r = passwordScore(form.elements.senha.value); meter.dataset.s = r.s; meter.querySelector('span').textContent = r.t; });
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submitting(form, async () => {
      const p = passwordProblem(form.elements.senha.value);
      if (p) { setFieldError(form, 'senha', p); return; }
      const d = await authFetch('POST', '/auth/redefinir', { token, senha: form.elements.senha.value });
      setUser(d.usuario);
      toast('Senha alterada. Você já está conectado.');
      location.hash = '#/conta';
    });
  });
  void ok;
}

function deviceName(ua) {
  ua = ua || '';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Dispositivo';
  const br = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
  return br ? `${br} no ${os}` : os;
}
const fmtWhen = (s) => new Date(s * 1000).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

async function viewAccount(ok, params) {
  await Auth.ready;
  if (!ok()) return;
  if (!Auth.user) { location.replace('#/entrar?next=conta'); return; }
  if (params.get('verificado') === '1') toast('E-mail confirmado. Obrigado!');
  if (params.get('verificado') === '0') toast('Link de confirmação inválido ou expirado.');
  const [sess, data] = await Promise.all([authFetch('GET', '/conta/sessoes').catch(() => ({ sessoes: [] })), authFetch('GET', '/conta/dados').catch(() => null)]);
  if (!ok()) return;
  const u = Auth.user;
  const local = localData();
  const favN = Object.keys(local['placar.favs'] || {}).length;
  const palpN = Object.keys(local['placar.palpites'] || {}).length;
  const simN = Object.keys(local).filter((k) => k.startsWith('placar.sim.')).length;
  const others = sess.sessoes.filter((s) => !s.atual).length;
  $app.innerHTML = `<div class="cols-2"><div class="stack">
    <div class="card"><div class="page-head acc-head">${userAvatar(u, 64)}
      <div><h1>${esc(u.nome)}</h1><div class="sub">@${esc(u.usuario)} · ${esc(u.email)}</div>
      <div class="facts">${u.verificado ? '<span class="badge ok">✓ E-mail confirmado</span>' : '<span class="badge warn">E-mail não confirmado</span>'}${u.google ? '<span class="badge">Google conectado</span>' : ''}<span>Membro desde ${new Date(u.criado_em * 1000).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })}</span></div></div>
      <button class="btn acc-logout" id="logout">Sair</button></div>
      ${!u.verificado ? `<div class="acc-alert"><span>Confirme seu e-mail para conseguir recuperar a conta se esquecer a senha. ${params.get('novo') ? 'Enviamos um link agora para você.' : ''}</span><button class="btn" id="resend">Reenviar e-mail</button></div>` : ''}
    </div>

    <div class="card"><div class="card-title">Sincronização<span class="more" id="sync-at">${data && data.atualizado_em ? `salvo ${esc(timeAgoSec(data.atualizado_em))}` : ''}</span></div>
      <div class="kv"><div><b>${favN}</b><span>Times favoritos</span></div><div><b>${palpN}</b><span>Palpites no bolão</span></div><div><b>${simN}</b><span>Simulações</span></div></div>
      <div class="card-body small muted">Favoritos, palpites, simulações, recordes dos minijogos, alertas e tema ficam salvos na sua conta e aparecem em qualquer aparelho em que você entrar. <button class="btn" id="sync-now" style="margin-left:8px">Sincronizar agora</button></div></div>

    ${interestsCard()}

    <div class="card"><div class="card-title">Perfil</div>
      <form class="acc-form" id="f-profile" novalidate><div class="form-msg" hidden role="alert"></div>
        <div class="grid-2">${field('nome', 'Nome', 'text', `maxlength="60" value="${esc(u.nome === u.usuario ? '' : u.nome)}" autocomplete="name"`)}
        ${field('usuario', 'Nome de usuário', 'text', `maxlength="20" value="${esc(u.usuario)}" autocapitalize="off" spellcheck="false"`)}</div>
        <button class="btn btn-primary" type="submit">Salvar perfil</button></form></div>

    <div class="card"><div class="card-title">${u.tem_senha ? 'Trocar senha' : 'Criar senha'}</div>
      <form class="acc-form" id="f-pass" novalidate><div class="form-msg" hidden role="alert"></div>
        ${u.tem_senha ? '' : '<p class="small muted" style="margin:0 0 10px">Sua conta usa o login com Google. Crie uma senha para também poder entrar com usuário e senha.</p>'}
        <div class="grid-2">${u.tem_senha ? field('atual', 'Senha atual', 'password', 'autocomplete="current-password" maxlength="128"') : ''}
        ${field('nova', 'Senha nova', 'password', 'autocomplete="new-password" minlength="8" maxlength="128"')}</div>
        <div class="pw-meter" data-s="0"><i></i><i></i><i></i><i></i><span></span></div>
        <button class="btn btn-primary" type="submit">${u.tem_senha ? 'Trocar senha' : 'Criar senha'}</button></form></div>

    <div class="card"><div class="card-title">Onde você está conectado${others ? `<button class="more linkish" id="out-all">Sair dos outros ${others}</button>` : ''}</div>
      ${sess.sessoes.map((s) => `<div class="list-row sess"><span class="sess-ico">${/Android|iPhone|iPad/.test(s.dispositivo) ? '📱' : '💻'}</span><div><div style="font-weight:600">${esc(deviceName(s.dispositivo))}${s.atual ? ' <span class="badge ok">Este aparelho</span>' : ''}</div><div class="small muted">Último acesso ${esc(fmtWhen(s.visto_em))} · IP ${esc(s.ip || '–')}</div></div></div>`).join('')}</div>

    <div class="card danger"><div class="card-title">Excluir conta</div>
      <form class="acc-form" id="f-del" novalidate><div class="form-msg" hidden role="alert"></div>
        <p class="small muted" style="margin:0 0 10px">Apaga sua conta e os dados salvos nela, para sempre. O que está neste aparelho continua aqui.</p>
        ${u.tem_senha ? field('senha', 'Confirme sua senha', 'password', 'autocomplete="current-password" maxlength="128"') : field('confirmar', `Digite <b>${esc(u.usuario)}</b> para confirmar`, 'text', 'autocapitalize="off" spellcheck="false"')}
        <button class="btn btn-danger" type="submit">Excluir minha conta</button></form></div>
  </div><aside class="side">${favNav()}</aside></div>`;

  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on('logout', 'click', async () => { await authFetch('POST', '/auth/sair').catch(() => {}); setUser(null); toast('Você saiu da conta.'); location.hash = '#/'; });
  on('resend', 'click', async (e) => { e.target.disabled = true; try { const d = await authFetch('POST', '/auth/reenviar'); toast(esc(d.mensagem)); } catch (err) { toast(esc(err.message)); e.target.disabled = false; } });
  on('sync-now', 'click', async (e) => { e.target.disabled = true; await syncPull(); await syncPush(); e.target.disabled = false; const s = document.getElementById('sync-at'); if (s) s.textContent = syncState.error ? syncState.error : 'salvo agora'; });
  on('taste-reset', 'click', () => { if (confirm('Limpar o que o Placar aprendeu sobre seus interesses? Seus times seguidos continuam.')) { Taste.reset(); router(); } });
  on('out-all', 'click', async () => { try { const d = await authFetch('POST', '/conta/sair-todas'); toast(esc(d.mensagem)); router(); } catch (err) { toast(esc(err.message)); } });

  const fp = document.getElementById('f-profile');
  wireForm(fp);
  fp.addEventListener('submit', (e) => { e.preventDefault(); submitting(fp, async () => {
    const d = await authFetch('POST', '/conta/perfil', { nome: fp.elements.nome.value.trim(), usuario: fp.elements.usuario.value.trim() });
    setUser(d.usuario); formOk(fp, 'Perfil salvo.');
  }); });

  const fw = document.getElementById('f-pass');
  wireForm(fw);
  const meter = fw.querySelector('.pw-meter');
  fw.elements.nova.addEventListener('input', () => { const r = passwordScore(fw.elements.nova.value, u.usuario); meter.dataset.s = r.s; meter.querySelector('span').textContent = r.t; });
  fw.addEventListener('submit', (e) => { e.preventDefault(); submitting(fw, async () => {
    const p = passwordProblem(fw.elements.nova.value, u.usuario, u.email);
    if (p) { setFieldError(fw, 'nova', p); return; }
    const d = await authFetch('POST', '/conta/senha', { atual: fw.elements.atual ? fw.elements.atual.value : '', nova: fw.elements.nova.value });
    fw.reset(); meter.dataset.s = 0; formOk(fw, d.mensagem);
    if (!u.tem_senha) { const r = await authFetch('GET', '/auth/eu'); setUser(r.usuario); }
  }); });

  const fd = document.getElementById('f-del');
  wireForm(fd);
  fd.addEventListener('submit', (e) => { e.preventDefault(); submitting(fd, async () => {
    if (!confirm('Excluir sua conta para sempre? Essa ação não pode ser desfeita.')) return;
    await authFetch('POST', '/conta/excluir', { senha: fd.elements.senha ? fd.elements.senha.value : '', confirmar: fd.elements.confirmar ? fd.elements.confirmar.value : '' });
    setUser(null); toast('Sua conta foi excluída.'); location.hash = '#/';
  }); });
}

function timeAgoSec(s) {
  const d = Math.max(0, Date.now() / 1000 - s);
  if (d < 60) return 'agora';
  if (d < 3600) return `há ${Math.round(d / 60)} min`;
  if (d < 86400) return `há ${Math.round(d / 3600)} h`;
  return `em ${new Date(s * 1000).toLocaleDateString('pt-BR')}`;
}
