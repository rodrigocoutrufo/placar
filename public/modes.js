/* Placar — "modos": cada esporte e cada campeonato muda a cara do site inteiro.
 * Ao entrar na F1, na NBA ou num campeonato, o topo, o fundo, as cores de destaque e a tipografia
 * se transformam, com uma vinheta de entrada (luzes de largada na F1, bola quicando na NBA,
 * abertura com o logo nos campeonatos). Respeita "reduzir movimento" do sistema.
 * Carregado antes do app.js; usa os helpers de lá (api, esc, norm, dark) só em tempo de execução. */
'use strict';

// Paletas próprias por campeonato: m1/m2 = fundo profundo, acc/acc2 = destaque, accL = destaque legível em fundo claro,
// ink = cor do texto sobre o destaque, pat = textura do fundo
const COMP_THEMES = [
  { re: /champions/, m1: '#030828', m2: '#0a1c6b', acc: '#4c86ff', acc2: '#00d9ff', accL: '#1f4fd8', ink: '#fff', pat: 'stars' },
  { re: /premier/, m1: '#1a0020', m2: '#3d0049', acc: '#ff2882', acc2: '#04f5ff', accL: '#c4006a', ink: '#fff', pat: 'diag' },
  { re: /la ?liga/, m1: '#1c0605', m2: '#4d0e0a', acc: '#ff4b44', acc2: '#ff9a3c', accL: '#d42a22', ink: '#fff', pat: 'diag' },
  { re: /^serie a$/, m1: '#001232', m2: '#00306b', acc: '#1aa3ff', acc2: '#3be8ff', accL: '#0068c9', ink: '#fff', pat: 'hex' },
  { re: /bundesliga/, m1: '#190003', m2: '#4a0008', acc: '#ff2433', acc2: '#ff7a3d', accL: '#d20515', ink: '#fff', pat: 'dots' },
  { re: /ligue 1/, m1: '#060e1d', m2: '#14233f', acc: '#d7ff3a', acc2: '#5dffb0', accL: '#4c7a00', ink: '#0a1200', pat: 'diag' },
  { re: /portugal/, m1: '#03112a', m2: '#0b2c63', acc: '#ff6b3d', acc2: '#ffc14d', accL: '#d94a1c', ink: '#fff', pat: 'dots' },
  { re: /eredivisie/, m1: '#071134', m2: '#13277a', acc: '#ff8a1f', acc2: '#ffc23d', accL: '#c45e00', ink: '#1a0d00', pat: 'hex' },
  { re: /libertadores/, m1: '#0b0904', m2: '#2b220b', acc: '#e8c45a', acc2: '#fff0b0', accL: '#8f700d', ink: '#1a1300', pat: 'stars' },
  { re: /sul-?americana/, m1: '#04122f', m2: '#08306b', acc: '#2ea8ff', acc2: '#7ef0ff', accL: '#0b6fc4', ink: '#fff', pat: 'diag' },
  { re: /copa do brasil/, m1: '#04153a', m2: '#0b2f78', acc: '#ffd23f', acc2: '#3ee08a', accL: '#957000', ink: '#1a1400', pat: 'stars' },
  { re: /serie b/, m1: '#04182a', m2: '#0b3a57', acc: '#2fd4c4', acc2: '#8af7d0', accL: '#0b8a7e', ink: '#02201c', pat: 'dots' },
  { re: /brasileir/, m1: '#021c0d', m2: '#07502a', acc: '#ffd400', acc2: '#3ee08a', accL: '#0a8a43', ink: '#1a1500', pat: 'diag' },
];
const SPORT_THEMES = {
  nba: { m1: '#070b1a', m2: '#17306e', acc: '#ff7a1a', acc2: '#ffb347', accL: '#cf540a', ink: '#1a0a00', pat: 'court' },
  f1: { m1: '#060607', m2: '#2a0303', acc: '#ff1e1e', acc2: '#ff6a3d', accL: '#cf0000', ink: '#fff', pat: 'carbon' },
};
const DEFAULT_COMP = { m1: '#04170c', m2: '#0b3d22', acc: '#2fd47c', acc2: '#64f0a6', accL: '#0a8a43', ink: '#04140a', pat: 'diag' };
function compTheme(c) {
  const n = norm(c && (c.nome_popular || c.nome));
  return COMP_THEMES.find((t) => t.re.test(n)) || DEFAULT_COMP;
}

const Modes = (() => {
  let key = '';
  const root = document.documentElement;
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const VARS = ['--m1', '--m2', '--acc', '--acc2', '--accL', '--acc-ink'];

  function badge(html, href) {
    let b = document.getElementById('mode-badge');
    if (!html) { if (b) b.remove(); return; }
    if (!b) {
      b = document.createElement('a');
      b.id = 'mode-badge'; b.className = 'mode-badge';
      document.querySelector('.brand').after(b);
    }
    b.href = href; b.innerHTML = html;
  }

  function apply(k, kind, theme, info = {}) {
    key = k;
    if (!kind) {
      delete root.dataset.mode; delete root.dataset.pat;
      VARS.forEach((v) => root.style.removeProperty(v));
      badge('');
      return;
    }
    root.dataset.mode = kind;
    root.dataset.pat = theme.pat;
    root.style.setProperty('--m1', theme.m1); root.style.setProperty('--m2', theme.m2);
    root.style.setProperty('--acc', theme.acc); root.style.setProperty('--acc2', theme.acc2);
    root.style.setProperty('--accL', theme.accL); root.style.setProperty('--acc-ink', theme.ink);
    badge(info.badge, info.href);
  }

  // vinheta de entrada: cobre a tela durante o carregamento e sai sozinha (toque/clique pula)
  function intro(kind, info = {}) {
    if (reduced()) return;
    document.querySelectorAll('.intro').forEach((x) => x.remove());
    const el = document.createElement('div');
    el.className = `intro intro-${kind}`;
    el.setAttribute('aria-hidden', 'true');
    let total = 1500;
    if (kind === 'f1') {
      total = 2300;
      el.innerHTML = `<div class="i-carbon"></div><div class="i-lights">${'<div class="pod"><i></i><i></i></div>'.repeat(5)}</div>
        <div class="i-title"><span>Fórmula 1</span><small>${esc(info.sub || 'Luzes apagadas. Lá vamos nós.')}</small></div><div class="i-streak"></div>`;
      const pods = () => el.querySelectorAll('.pod');
      [0, 1, 2, 3, 4].forEach((i) => setTimeout(() => pods()[i] && pods()[i].classList.add('on'), 180 + i * 230));
      setTimeout(() => el.classList.add('out-lights'), 180 + 5 * 230 + 260);
    } else if (kind === 'nba') {
      total = 1700;
      el.innerHTML = `<div class="i-court"></div><div class="i-ball"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/><path d="M4 50h92M50 4v92M17 17c18 18 18 48 0 66M83 17c-18 18-18 48 0 66"/></svg></div>
        <div class="i-title"><span>NBA</span><small>${esc(info.sub || 'Hora do jogo')}</small></div>`;
    } else {
      total = 1600;
      el.innerHTML = `<div class="i-pat"></div><div class="i-glow"></div>
        <div class="i-logo">${info.logo ? `<img src="${esc(info.logo)}" alt="">` : ''}</div>
        <div class="i-title"><span>${esc(info.name || '')}</span><small>${esc(info.sub || '')}</small></div><div class="i-sweep"></div>`;
    }
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    const leave = () => { if (el.classList.contains('leave')) return; el.classList.add('leave'); setTimeout(() => el.remove(), 650); };
    el.addEventListener('click', leave);
    setTimeout(leave, total);
  }

  return {
    get key() { return key; },
    clear() { if (key) apply('', null); },
    sport(kind, { intro: withIntro = true } = {}) {
      const k = kind;
      if (key === k) return;
      const label = { nba: 'NBA', f1: 'Fórmula 1' }[kind];
      apply(k, kind, SPORT_THEMES[kind], { badge: `${SPORT_ICON[kind]}<span>${label}</span>`, href: `#/${kind}` });
      if (withIntro) intro(kind);
    },
    comp(c, { intro: withIntro = true } = {}) {
      if (!c || !c.campeonato_id) return;
      const k = `c${c.campeonato_id}`;
      if (key === k) return;
      const lg = c.logo_escuro || c.logo;
      apply(k, 'comp', compTheme(c), { badge: `${lg ? `<img src="${esc(lg)}" alt="">` : ''}<span>${esc(c.nome_popular || c.nome)}</span>`, href: `#/campeonato/${c.campeonato_id}` });
      if (withIntro) intro('comp', { logo: lg, name: c.nome_popular || c.nome, sub: c.edicao_atual ? c.edicao_atual.nome : '' });
    },
  };
})();

// chamado pelo roteador antes de cada tela
async function routeMode(parts) {
  const p0 = parts[0];
  if (p0 === 'nba' || p0 === 'f1') return Modes.sport(p0);
  if (p0 === 'campeonato') {
    const id = +parts[1];
    if (Modes.key === `c${id}`) return;
    const comps = await soft(api('/campeonatos', 600000)) || [];
    const c = comps.find((x) => x.campeonato_id === id);
    if (c) Modes.comp(c); else Modes.clear();
    return;
  }
  if (p0 === 'partida') return; // a tela da partida aplica o tema do campeonato dela quando carrega
  Modes.clear();
}
