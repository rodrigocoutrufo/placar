/* Placar — recursos de IA no site: análise da partida, "Seu dia no futebol" e o assistente "Pergunte ao Placar".
 * Só aparecem quando o servidor tem a IA ligada (GET /api/ia/status). Carregado antes do app.js. */
'use strict';

const AI_ICON = '<svg viewBox="0 0 24 24"><path d="M12 2l1.9 5.6 5.6 1.9-5.6 1.9L12 17l-1.9-5.6-5.6-1.9 5.6-1.9z"/><path d="M19 14l.8 2.2 2.2.8-2.2.8L19 20l-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
let aiStatusP = null;
const aiStatus = () => aiStatusP || (aiStatusP = fetch('/api/ia/status').then((r) => r.json()).catch(() => ({ ativo: false })));

// "Qwen3 4B, no seu computador" / "Claude"
const aiModelLabel = (st) => {
  if (!st) return 'IA';
  if (st.local) return `${String(st.modelo || 'modelo local').replace(/:/, ' ').toUpperCase()}, rodando no computador do servidor`;
  return st.provedor === 'gemini' ? 'Gemini, do Google' : 'Claude, da Anthropic';
};

// Pedido à IA com tempo máximo: nada de "carregando" para sempre (a IA local leva até ~1 min por etapa)
const AI_TIMEOUT_MS = 220000;
async function aiFetch(path, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try {
    const r = await fetch('/api' + path, { ...opts, signal: ctrl.signal, credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(d.message || `Erro ${r.status}`); e.status = r.status; throw e; }
    return d;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('A IA demorou demais para responder. Tente de novo em instantes ou faça uma pergunta mais direta.');
    if (e instanceof TypeError) throw new Error('Sem conexão com o servidor do Placar.');
    throw e;
  } finally { clearTimeout(timer); }
}
const aiGet = (path) => aiFetch(path);

// texto do modelo: escapado, com negrito e listas simples
function mdLite(s) {
  let html = '', inList = false;
  esc(s).split('\n').forEach((l) => {
    const m = l.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/);
    if (m) { if (!inList) { html += '<ul>'; inList = true; } html += `<li>${m[1]}</li>`; return; }
    if (inList) { html += '</ul>'; inList = false; }
    html += `${l}\n`;
  });
  if (inList) html += '</ul>';
  return html.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').trim();
}

/* ============ Análise da partida ============ */
const aiInsightMemo = new Map();
const aiInsightSlot = () => '<div id="ai-insight"></div>';
async function loadAiInsight(p, ok) {
  const el = document.getElementById('ai-insight');
  if (!el) return;
  const st = await aiStatus();
  if (!st.ativo || !ok() || !el.isConnected) { el.innerHTML = ''; return; }
  const key = `${p.partida_id}:${p.status}:${p.placar_mandante}-${p.placar_visitante}:${Math.floor((p.cronometro || 0) / 15)}`;
  let d = aiInsightMemo.get(key);
  if (!d) {
    el.innerHTML = `<div class="card ai-card"><div class="card-title"><span class="ai-badge">${AI_ICON} Análise IA</span><span class="more">${st.local ? 'analisando… (IA local, pode levar até 1 minuto)' : 'analisando os dados…'}</span></div>
      <div class="ai-body"><div class="ai-skel" style="width:70%;height:18px"></div><div class="ai-skel"></div><div class="ai-skel" style="width:85%"></div><div class="ai-skel" style="width:60%"></div></div></div>`;
    try { d = await aiGet(`/ia/partida/${p.partida_id}`); aiInsightMemo.set(key, d); } catch (e) {
      const cur = document.getElementById('ai-insight');
      if (cur && ok()) cur.innerHTML = e.status === 503 ? '' : `<div class="card ai-card"><div class="card-body small muted">${esc(e.message)}</div></div>`;
      return;
    }
  }
  const cur = document.getElementById('ai-insight');
  if (!cur || !ok()) return;
  const a = d.analise;
  const label = { andamento: 'Ao vivo', finalizado: 'Resumo do jogo' }[d.status] || 'Prévia';
  const pal = a.palpite || {};
  cur.innerHTML = `<div class="card ai-card"><div class="card-title"><span class="ai-badge">${AI_ICON} Análise IA</span><span class="more">${label}</span></div>
    <div class="ai-body"><div class="ai-title">${esc(a.titulo)}</div><p>${esc(a.resumo)}</p>
      ${(a.pontos || []).length ? `<ul class="ai-points">${a.pontos.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="ai-tip"><span class="ai-chip">${d.status === 'finalizado' ? 'Final' : 'Palpite'} <b>${esc(p.time_mandante.sigla || '')} ${pal.mandante ?? '–'} × ${pal.visitante ?? '–'} ${esc(p.time_visitante.sigla || '')}</b></span><span class="small muted">${esc(pal.comentario || '')}</span></div>
      ${a.fique_de_olho ? `<p class="small"><b>Fique de olho:</b> ${esc(a.fique_de_olho)}</p>` : ''}</div>
    <div class="ai-foot">Escrito por IA (${esc(aiModelLabel(st))}) só com os dados do Placar: tabela, forma, probabilidades e lances. Pode errar.</div></div>`;
}

/* ============ Seu dia no futebol (início) ============ */
let aiDayHtml = '';
async function loadAiDay(ok) {
  const st = await aiStatus();
  if (!st.ativo || !ok()) return;
  const teams = [...new Set([...Object.values(getFavs()).map((t) => t.nome_popular), ...Taste.top('t', 8).map((x) => x.m && x.m.n).filter(Boolean)])].slice(0, 8);
  const comps = Taste.top('c', 4).map((x) => x.id).filter((x) => /^\d+$/.test(x));
  if (!teams.length && !comps.length) return;
  const qs = new URLSearchParams({ times: teams.join(','), campeonatos: comps.join(',') });
  const cacheKey = `placar.iadia.${qs}`;
  let d = null;
  try { const c = JSON.parse(sessionStorage.getItem(cacheKey) || 'null'); if (c && c.exp > Date.now()) d = c.d; } catch { /* sem sessão */ }
  if (!d) {
    try { d = await aiGet(`/ia/para-voce?${qs}`); } catch { return; }
    try { sessionStorage.setItem(cacheKey, JSON.stringify({ exp: Date.now() + 30 * 60e3, d })); } catch { /* cheio */ }
  }
  if (!d || !d.resumo || !ok()) return;
  const ico = { jogo: '⚽', noticia: '📰', tabela: '📊', outro: '✦' };
  const item = (it) => {
    const inner = `<span class="ai-day-ico">${ico[it.tipo] || '✦'}</span><span>${esc(it.texto)}</span>`;
    if (it.tipo === 'jogo' && /^\d+$/.test(it.ref || '')) return `<a class="ai-day-item" href="#/partida/${it.ref}">${inner}</a>`;
    if (/^https?:\/\//.test(it.ref || '')) return `<a class="ai-day-item" href="${esc(it.ref)}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    return `<div class="ai-day-item">${inner}</div>`;
  };
  aiDayHtml = `<div class="card ai-card"><div class="card-title"><span class="ai-badge">${AI_ICON} Seu dia</span>${esc(d.resumo.titulo)}</div>
    ${d.resumo.itens.map(item).join('')}<div class="ai-foot">Resumo por IA a partir dos times e campeonatos que você acompanha.</div></div>`;
  const el = document.getElementById('ai-day');
  if (el) el.innerHTML = aiDayHtml;
}

/* ============ Pergunte ao Placar ============ */
const ASK_SUGS = ['Quais jogos tem hoje?', 'Quem lidera o Brasileirão?', 'Quais as chances do meu time ser campeão?', 'Quando é o próximo GP de F1?'];
const askState = { open: false, history: [], busy: false };
try { askState.history = JSON.parse(sessionStorage.getItem('placar.ask') || '[]'); } catch { /* sem sessão */ }

function mountAssistant() {
  aiStatus().then((st) => {
    if (!st.ativo || document.getElementById('ask-fab')) return;
    document.body.insertAdjacentHTML('beforeend', `<button class="ask-fab" id="ask-fab" aria-label="Pergunte ao Placar">${AI_ICON}<span>Pergunte ao Placar</span></button>`);
    document.getElementById('ask-fab').addEventListener('click', () => (askState.open ? closeAsk() : openAsk()));
  });
}
function closeAsk() { askState.open = false; const p = document.getElementById('ask-panel'); if (p) p.remove(); }
function askBubble(m) {
  if (m.role === 'user') return `<div class="ask-msg me">${esc(m.content)}</div>`;
  return `<div class="ask-msg bot ${m.err ? 'err' : ''}">${m.html || mdLite(m.content)}${m.src && m.src.length ? `<span class="src">Consultou: ${esc(m.src.join(', '))}</span>` : ''}</div>`;
}
function renderAsk() {
  const log = document.getElementById('ask-log');
  if (!log) return;
  const intro = `<div class="ask-msg bot">Oi! Pergunte sobre jogos, tabelas, chances de título, notícias, NBA ou F1. Eu consulto os dados do Placar na hora.
    <div class="ask-sugs" style="margin-top:8px">${ASK_SUGS.map((s) => `<button data-sug="${esc(s)}">${esc(s)}</button>`).join('')}</div></div>`;
  log.innerHTML = intro + askState.history.map(askBubble).join('')
    + (askState.busy ? `<div class="ask-msg bot"><span class="ask-typing"><i></i><i></i><i></i></span> <span class="small muted" id="ask-elapsed">consultando os dados…</span></div>` : '');
  log.scrollTop = log.scrollHeight;
  log.querySelectorAll('[data-sug]').forEach((b) => b.addEventListener('click', () => sendAsk(b.dataset.sug)));
}
function openAsk() {
  askState.open = true;
  document.body.insertAdjacentHTML('beforeend', `<div class="ask-panel" id="ask-panel" role="dialog" aria-label="Pergunte ao Placar">
    <div class="ask-head">${AI_ICON.replace('<svg', '<svg width="22" height="22" style="fill:#fff;stroke:none"')}<div><b>Pergunte ao Placar</b><small>IA com os dados do Placar em tempo real</small></div><button id="ask-close" aria-label="Fechar">×</button></div>
    <div class="ask-log" id="ask-log"></div>
    <form class="ask-form" id="ask-form"><input id="ask-in" maxlength="500" placeholder="Ex.: o Palmeiras ainda pode ser campeão?" autocomplete="off"><button aria-label="Enviar"><svg viewBox="0 0 24 24"><path d="M4 12l16-8-6 16-2-7z" fill="currentColor" stroke="none"/></svg></button></form></div>`);
  document.getElementById('ask-close').addEventListener('click', closeAsk);
  document.getElementById('ask-form').addEventListener('submit', (e) => { e.preventDefault(); const i = document.getElementById('ask-in'); sendAsk(i.value); i.value = ''; });
  renderAsk();
  document.getElementById('ask-in').focus();
}
async function sendAsk(q) {
  q = (q || '').trim();
  if (!q || askState.busy) return;
  if (!Auth.user) {
    askState.history.push({ role: 'user', content: q }, { role: 'assistant', content: '', html: 'Para usar o assistente, <a href="#/entrar" style="color:var(--brand);font-weight:700">entre na sua conta</a> (é grátis). Assim cada pessoa tem sua cota de perguntas.' });
    renderAsk();
    return;
  }
  const hist = askState.history.filter((m) => !m.err && !m.html).map((m) => ({ role: m.role, content: m.content })).slice(-6);
  askState.history.push({ role: 'user', content: q });
  askState.busy = true; renderAsk();
  // contador visível: a IA local leva de 30 s a 1 min; a pessoa vê que está andando
  const started = Date.now();
  const local = (await aiStatus()).local;
  const tick = setInterval(() => {
    const el = document.getElementById('ask-elapsed');
    const s = Math.round((Date.now() - started) / 1000);
    if (el) el.textContent = `${s < 8 ? 'consultando os dados' : 'escrevendo a resposta'}… ${s} s${local ? ' (IA local: até ~1 min)' : ''}`;
  }, 1000);
  try {
    const d = await aiFetch('/ia/perguntar', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'placar' },
      body: JSON.stringify({ pergunta: q, historico: hist }) });
    askState.history.push({ role: 'assistant', content: d.resposta || 'Não consegui montar uma resposta agora.', src: d.ferramentas });
  } catch (e) {
    askState.history.push({ role: 'assistant', content: e.message, err: true });
  } finally {
    clearInterval(tick);
    askState.busy = false;
    askState.history = askState.history.slice(-20);
    try { sessionStorage.setItem('placar.ask', JSON.stringify(askState.history)); } catch { /* sem sessão */ }
    renderAsk();
  }
}
mountAssistant();
