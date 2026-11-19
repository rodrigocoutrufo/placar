// Card de placar para compartilhar (WhatsApp, Instagram): desenhado num canvas, sem bibliotecas.
// Os escudos passam pelo /api/img do próprio servidor: imagem de outro site "suja" o canvas e o navegador
// não deixa exportar o PNG.
import { barColors, isLive, liveLabel, parseDate, penScore, evMinute, fmtTime } from './format.js';

export const FORMATS = {
  story: { w: 1080, h: 1920, label: 'Story', hint: '9:16 · Instagram e WhatsApp' },
  post: { w: 1080, h: 1350, label: 'Post', hint: '4:5 · feed do Instagram' },
  square: { w: 1080, h: 1080, label: 'Quadrado', hint: '1:1 · grupos e X' },
};

const proxied = (url) => (!url ? null : url.startsWith('/') ? url : `/api/img?u=${encodeURIComponent(url.split('#')[0])}`);
const imgCache = new Map();
function loadImage(url) {
  if (!url) return Promise.resolve(null);
  if (imgCache.has(url)) return imgCache.get(url);
  const p = new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null); // sem escudo: o card sai sem ele, mas sai
    im.src = proxied(url);
  });
  imgCache.set(url, p);
  return p;
}

async function fontsReady() {
  if (!document.fonts) return;
  await Promise.all([
    document.fonts.load('italic 800 100px "Barlow Condensed"'), document.fonts.load('700 60px "Barlow Condensed"'),
    document.fonts.load('600 30px "Inter"'), document.fonts.load('500 30px "Inter"'),
  ]).catch(() => {});
}

// texto que encolhe até caber na largura
function fit(ctx, text, maxW, size, font) {
  let s = size;
  do { ctx.font = font(s); s -= 2; } while (ctx.measureText(text).width > maxW && s > 18);
  return ctx.font;
}
function drawContain(ctx, img, cx, cy, size) {
  if (!img) return;
  const r = Math.min(size / img.width, size / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, cx - w / 2, cy - h / 2, w, h);
}
const scorersOf = (p, side) => ((p.gols || {})[side] || []).slice().sort((x, y) => evMinute(x).key - evMinute(y).key)
  .map((g) => `${g.atleta ? g.atleta.nome_popular : 'Gol'} ${evMinute(g).label}${g.penalti ? ' (pên.)' : ''}${g.gol_contra ? ' (contra)' : ''}`);

export async function drawCard(canvas, p, camp, fmt = 'story') {
  const { w: W, h: H } = FORMATS[fmt];
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  await fontsReady();
  const Hm = p.time_mandante, Am = p.time_visitante;
  const [ch, ca] = barColors(Hm, Am);
  const [ih, ia, il] = await Promise.all([loadImage(Hm.escudo || Hm.escudo_escuro), loadImage(Am.escudo || Am.escudo_escuro), loadImage(camp && (camp.logo_escuro || camp.logo))]);
  const tall = fmt === 'story', sq = fmt === 'square';
  const live = isLive(p), done = p.status === 'finalizado';

  // fundo: preto de transmissão com as cores dos dois times entrando pelas laterais
  ctx.fillStyle = '#0b0c0e'; ctx.fillRect(0, 0, W, H);
  const slab = (color, left) => {
    const g = ctx.createLinearGradient(left ? 0 : W, 0, W / 2, 0);
    g.addColorStop(0, color); g.addColorStop(1, 'rgba(11,12,14,0)');
    ctx.save(); ctx.globalAlpha = 0.85; ctx.fillStyle = g;
    ctx.beginPath();
    if (left) { ctx.moveTo(0, 0); ctx.lineTo(W * 0.62, 0); ctx.lineTo(W * 0.42, H); ctx.lineTo(0, H); }
    else { ctx.moveTo(W, 0); ctx.lineTo(W * 0.58, 0); ctx.lineTo(W * 0.38, H); ctx.lineTo(W, H); }
    ctx.closePath(); ctx.fill(); ctx.restore();
  };
  slab(ch, true); slab(ca, false);
  // listras diagonais e vinheta
  ctx.save(); ctx.globalAlpha = 0.05; ctx.strokeStyle = '#fff'; ctx.lineWidth = 3;
  for (let x = -H; x < W + H; x += 34) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + H * 0.47, H); ctx.stroke(); }
  ctx.restore();
  const vg = ctx.createRadialGradient(W / 2, H / 2, W * 0.2, W / 2, H / 2, H * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  const Y = (f) => H * f;
  const L = tall ? { comp: 0.1, crest: 0.33, name: 0.445, score: 0.585, status: 0.665, scorers: 0.72, foot: 0.93, crestS: 300 }
    : sq ? { comp: 0.1, crest: 0.33, name: 0.5, score: 0.33, status: 0.62, scorers: 0.7, foot: 0.91, crestS: 200 }
      : { comp: 0.085, crest: 0.3, name: 0.44, score: 0.3, status: 0.555, scorers: 0.62, foot: 0.925, crestS: 220 };

  // topo: campeonato
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const compName = ((camp && (camp.nome_popular || camp.nome)) || '').toUpperCase();
  const sub = [p.rodada, p.fase && !/fase única/i.test(p.fase.nome || '') && p.fase.nome].filter(Boolean)[0] || '';
  if (il) {
    const mono = String((camp && (camp.logo_escuro || camp.logo)) || '').endsWith('#mono'); // sem versão escura: branco
    ctx.save(); if (mono) ctx.filter = 'brightness(0) invert(1)';
    drawContain(ctx, il, W / 2, Y(L.comp) - 34, 90); ctx.restore();
  }
  ctx.fillStyle = '#fff'; ctx.font = fit(ctx, compName, W - 160, 46, (s) => `700 ${s}px "Barlow Condensed"`);
  ctx.fillText(compName, W / 2, Y(L.comp) + 40);
  if (sub) { ctx.fillStyle = 'rgba(255,255,255,.65)'; ctx.font = '600 28px "Inter"'; ctx.fillText(String(sub).toUpperCase(), W / 2, Y(L.comp) + 84); }

  // escudos (com um halo claro atrás: escudo escuro aparece no fundo preto)
  const cx = [W * (tall ? 0.27 : 0.17), W * (tall ? 0.73 : 0.83)];
  [[ih, cx[0]], [ia, cx[1]]].forEach(([im, x]) => {
    const halo = ctx.createRadialGradient(x, Y(L.crest), 10, x, Y(L.crest), L.crestS * 0.75);
    halo.addColorStop(0, 'rgba(255,255,255,.28)'); halo.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = halo; ctx.fillRect(x - L.crestS, Y(L.crest) - L.crestS, L.crestS * 2, L.crestS * 2);
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 40; ctx.shadowOffsetY = 16;
    drawContain(ctx, im, x, Y(L.crest), L.crestS); ctx.restore();
  });
  // nomes
  const w = winnerSide(p);
  [[Hm, cx[0], 'h'], [Am, cx[1], 'a']].forEach(([t, x, s]) => {
    const name = String(t.nome_popular || '').toUpperCase();
    ctx.fillStyle = w && w !== s ? 'rgba(255,255,255,.6)' : '#fff';
    ctx.font = fit(ctx, name, (tall ? W * 0.42 : W * 0.34), tall ? 72 : 60, (sz) => `italic 800 ${sz}px "Barlow Condensed"`);
    ctx.fillText(name, x, Y(L.name));
  });

  // placar (ou horário do jogo)
  ctx.fillStyle = '#fff';
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 30;
  if (live || done) {
    const txt = `${p.placar_mandante ?? 0}  :  ${p.placar_visitante ?? 0}`;
    ctx.font = `italic 800 ${tall ? 250 : sq ? 165 : 185}px "Barlow Condensed"`;
    ctx.fillText(txt, W / 2, Y(L.score));
  } else {
    ctx.font = `italic 800 ${tall ? 170 : 130}px "Barlow Condensed"`;
    ctx.fillText(fmtTime(p), W / 2, Y(L.score));
  }
  ctx.restore();
  const pen = penScore(p);
  // selo de status
  const d = parseDate(p);
  const status = live ? `AO VIVO · ${liveLabel(p)}` : done ? (pen ? `FIM · PÊNALTIS ${pen[0]}–${pen[1]}` : 'FIM DE JOGO')
    : d ? d.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).toUpperCase() : 'EM BREVE';
  ctx.font = '700 40px "Barlow Condensed"';
  const sw = ctx.measureText(status).width + 64;
  ctx.fillStyle = live ? '#ff2b2b' : 'rgba(255,255,255,.14)';
  roundRect(ctx, W / 2 - sw / 2, Y(L.status) - 34, sw, 68, 8); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.fillText(status, W / 2, Y(L.status) + 2);

  // autores dos gols
  if (live || done) {
    const lines = [scorersOf(p, 'mandante'), scorersOf(p, 'visitante')];
    const max = tall ? 6 : sq ? 3 : 4;
    ctx.font = '500 30px "Inter"'; ctx.fillStyle = 'rgba(255,255,255,.85)';
    lines.forEach((ls, i) => {
      ctx.textAlign = i ? 'right' : 'left';
      const x = i ? W - 90 : 90;
      ls.slice(0, max).forEach((t, k) => ctx.fillText(t.slice(0, 32), x, Y(L.scorers) + k * 46));
      if (ls.length > max) ctx.fillText(`+${ls.length - max}`, x, Y(L.scorers) + max * 46);
    });
    ctx.textAlign = 'center';
  }

  // rodapé: marca e local
  const fy = Y(L.foot);
  ctx.fillStyle = 'rgba(255,255,255,.12)'; ctx.fillRect(90, fy - 70, W - 180, 2);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#19d36b'; roundRect(ctx, 90, fy - 34, 64, 64, 12); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(122, fy - 2, 17, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(122, fy - 2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'italic 800 56px "Barlow Condensed"'; ctx.fillText('VYRA', 172, fy);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,.6)'; ctx.font = '500 26px "Inter"';
  const where = [d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '', p.estadio && p.estadio.nome_popular].filter(Boolean).join(' · ');
  ctx.fillText(where.slice(0, 48), W - 90, fy);
  return canvas;
}

function winnerSide(p) {
  if (p.status !== 'finalizado' || p.placar_mandante == null) return null;
  if (p.placar_mandante !== p.placar_visitante) return p.placar_mandante > p.placar_visitante ? 'h' : 'a';
  const pen = penScore(p);
  return pen ? (pen[0] > pen[1] ? 'h' : 'a') : null;
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

export const cardFileName = (p) => `placar-${String(p.time_mandante.nome_popular)}-${String(p.time_visitante.nome_popular)}`
  .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '.png';
