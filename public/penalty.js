/* Placar — Disputa de pênaltis.
 * Cobrando: toque onde quer chutar e pare a barra de força na faixa verde (forte demais sobe, fraco o goleiro pega).
 * Defendendo: o cobrador corre para a bola e você tem um instante para escolher onde pular.
 * A força de cada time vem da posição na tabela; os cobradores e goleiros são os do elenco real. */
'use strict';

const PEN = {
  goal: { l: 90, r: 310, t: 62, b: 172 }, spot: { x: 200, y: 262 }, keeper: { x: 200, y: 172 },
  levels: { facil: { read: 0.22, reach: 0.86, mine: 1.22, window: 2400, label: 'Fácil' }, normal: { read: 0.38, reach: 1, mine: 1, window: 1900, label: 'Normal' },
            dificil: { read: 0.55, reach: 1.12, mine: 0.86, window: 1450, label: 'Difícil' } },
};
const penStats = () => store.get('placar.pen', { v: 0, d: 0 });

async function gamePenalties(ok) {
  $app.innerHTML = gameShell('Disputa de pênaltis', skel(460));
  const comps = await api('/campeonatos', 600000);
  const tables = await Promise.all(comps.filter((c) => c.tipo === 'Pontos Corridos').slice(0, 8).map((c) =>
    soft(api(`/campeonatos/${c.campeonato_id}/tabela`, 600000)).then((t) => {
      const rows = flattenTable(t || []).flatMap((g) => g.rows);
      return { c, teams: rows.map((r, i) => ({ ...r.time, forca: rows.length > 1 ? 1 - i / (rows.length - 1) : 0.5 })) };
    })));
  if (!ok()) return;
  const leagues = tables.filter((x) => x.teams.length);
  const all = leagues.flatMap((x) => x.teams);
  if (all.length < 2) { $app.innerHTML = gameShell('Disputa de pênaltis', `<div class="card">${empty('Sem times disponíveis agora. Tente de novo em instantes.')}</div>`); return; }
  const fav = Object.values(getFavs())[0];
  let me = all.find((t) => fav && +t.time_id === +fav.time_id) || leagues[0].teams[0];
  let cpu = leagues[0].teams.find((t) => t.time_id !== me.time_id && t.forca > 0.6) || all.find((t) => t.time_id !== me.time_id);
  let level = store.get('placar.pen.nivel', 'normal');

  const stars = (f) => `<span class="pen-stars" title="Força pela posição na tabela">${[0.2, 0.4, 0.6, 0.8, 1].map((s) => `<i class="${f >= s - 0.1 ? 'on' : ''}">★</i>`).join('')}</span>`;
  const select = (id, sel) => `<select id="${id}" class="pen-sel">${leagues.map((l) => `<optgroup label="${esc(l.c.nome_popular)}">${l.teams.map((t) => `<option value="${t.time_id}" ${t.time_id === sel.time_id ? 'selected' : ''}>${esc(t.nome_popular)}</option>`).join('')}</optgroup>`).join('')}</select>`;
  const side = () => {
    const s = penStats();
    const conv = s.chutes ? Math.round((s.gols / s.chutes) * 100) : 0, def = s.defTot ? Math.round((s.defesas / s.defTot) * 100) : 0;
    return `<div class="card"><div class="card-title">Seu histórico</div><div class="kv"><div><b>${s.v}</b><span>Vitórias</span></div><div><b>${s.d}</b><span>Derrotas</span></div>
      <div><b>${conv}%</b><span>Conversão</span></div><div><b>${def}%</b><span>Defesas</span></div><div><b>${s.melhorSeq || 0}</b><span>Melhor sequência</span></div></div></div>
      <div class="card"><div class="card-title">Como jogar</div><div class="pen-how">
        <div><b>1</b><span><strong>Mire.</strong> Toque no gol onde quer chutar. Cantos são mais difíceis para o goleiro, mas a bola pode ir para fora.</span></div>
        <div><b>2</b><span><strong>Força.</strong> Pare a barra na faixa verde. Forte demais a bola sobe; fraca, o goleiro chega.</span></div>
        <div><b>3</b><span><strong>Defenda.</strong> Quando o adversário correr para a bola, toque onde você vai pular.</span></div></div></div>`;
  };

  const setup = () => {
    $app.innerHTML = gameShell('Disputa de pênaltis', `<div class="card pen-setup-card">
      <div class="pen-setup">
        <div class="pen-pick"><span class="eyebrow">Seu time</span><div class="pen-crest" style="--kit:${kitColor(me)}">${crest(me, 84)}</div>${select('pen-me', me)}${stars(me.forca)}</div>
        <div class="pen-vs">VS</div>
        <div class="pen-pick"><span class="eyebrow">Adversário</span><div class="pen-crest" style="--kit:${kitColor(cpu)}">${crest(cpu, 84)}</div>${select('pen-cpu', cpu)}${stars(cpu.forca)}</div>
      </div>
      <div class="pen-level"><span class="small muted">Dificuldade</span><div class="seg">${Object.entries(PEN.levels).map(([k, v]) => `<button data-lv="${k}" class="${k === level ? 'active' : ''}">${v.label}</button>`).join('')}</div></div>
      <button class="btn btn-primary btn-block pen-go" id="pen-go">Ir para a marca do pênalti</button></div>`, side());
    const byId = (v) => all.find((t) => String(t.time_id) === v);
    document.getElementById('pen-me').addEventListener('change', (e) => { me = byId(e.target.value); if (cpu.time_id === me.time_id) cpu = all.find((t) => t.time_id !== me.time_id); setup(); });
    document.getElementById('pen-cpu').addEventListener('change', (e) => { cpu = byId(e.target.value); setup(); });
    $app.querySelectorAll('[data-lv]').forEach((b) => b.addEventListener('click', () => { level = b.dataset.lv; store.set('placar.pen.nivel', level); setup(); }));
    document.getElementById('pen-go').addEventListener('click', start);
  };

  // cobradores (atacantes e meias primeiro) e goleiro do elenco real
  const squad = async (t) => {
    // times da API Futebol (IDs baixos) gastariam o orçamento diário do plano: usa nomes genéricos
    const list = +t.time_id >= 800000000 ? await soft(api(`/times/${t.time_id}/elenco`, 3600000)) || [] : [];
    const pos = (x) => norm(((x.posicao || {}).nome || '') + ' ' + ((x.posicao || {}).sigla || ''));
    const gk = list.find((x) => /gol|goalkeeper|\bg\b/.test(pos(x)));
    const order = (x) => (/ata|forward|atac|centroav|ponta/.test(pos(x)) ? 0 : /mei|midfield|vol/.test(pos(x)) ? 1 : /gol|goalkeeper/.test(pos(x)) ? 9 : 2);
    const kickers = shuffle(list.filter((x) => x !== gk)).sort((a, b) => order(a) - order(b)).slice(0, 11).map((x) => shortName(x.atleta.nome_popular));
    return { kickers: kickers.length >= 5 ? kickers : ['Cobrador 1', 'Cobrador 2', 'Cobrador 3', 'Cobrador 4', 'Cobrador 5'], keeper: gk ? shortName(gk.atleta.nome_popular) : 'Goleiro' };
  };

  async function start() {
    const btn = document.getElementById('pen-go');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span>'; }
    const [sqMe, sqCpu] = await Promise.all([squad(me), squad(cpu)]);
    if (!ok()) return;
    play(sqMe, sqCpu);
  }

  function play(sqMe, sqCpu) {
    const L = PEN.levels[level];
    const kick = { me: [], cpu: [] };
    let turn = Math.random() < 0.5 ? 'me' : 'cpu';
    const firstTurn = turn;
    let phase = 'intro', aim = null, power = 0, powerDir = 1, raf = 0, timer = 0, dive = null;
    const session = { gols: 0, chutes: 0, defesas: 0, defTot: 0 };

    const decided = () => {
      const a = kick.me.filter(Boolean).length, b = kick.cpu.filter(Boolean).length;
      const ra = Math.max(0, 5 - kick.me.length), rb = Math.max(0, 5 - kick.cpu.length);
      if (kick.me.length <= 5 && kick.cpu.length <= 5) {
        if (a + ra < b || b + rb < a) return a > b ? 'me' : 'cpu';
        if (kick.me.length === 5 && kick.cpu.length === 5 && a !== b) return a > b ? 'me' : 'cpu';
        return null;
      }
      return kick.me.length === kick.cpu.length && a !== b ? (a > b ? 'me' : 'cpu') : null;
    };
    const dots = (arr) => Array.from({ length: Math.max(5, kick.me.length, kick.cpu.length) }, (_, i) => `<i class="${arr[i] === true ? 'g' : arr[i] === false ? 'x' : ''}">${arr[i] === true ? '✓' : arr[i] === false ? '✕' : ''}</i>`).join('');
    const kickerName = () => (turn === 'me' ? sqMe.kickers[kick.me.length % sqMe.kickers.length] : sqCpu.kickers[kick.cpu.length % sqCpu.kickers.length]);
    const round = () => { const n = Math.max(kick.me.length, kick.cpu.length) + (kick[turn].length === Math.max(kick.me.length, kick.cpu.length) ? 1 : 0); return n <= 5 ? `Cobrança ${n} de 5` : 'Alternadas'; };

    const G = PEN.goal;
    const keeperKit = () => kitColor(turn === 'me' ? cpu : me);
    const shirt = () => kitColor(turn === 'me' ? me : cpu);
    const scene = () => `<svg viewBox="0 0 400 300" class="pen-svg" id="pen-svg" role="img" aria-label="Gol e marca do pênalti">
      <defs>
        <pattern id="pnet" width="9" height="9" patternUnits="userSpaceOnUse"><path d="M9 0L0 9M0 0l9 9" stroke="rgba(255,255,255,.55)" stroke-width=".55"/></pattern>
        <pattern id="crowd" width="8" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.6" fill="rgba(255,255,255,.18)"/><circle cx="6" cy="5" r="1.6" fill="rgba(255,255,255,.1)"/></pattern>
        <linearGradient id="grass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2f8f46"/><stop offset="1" stop-color="#1f6b33"/></linearGradient>
        <radialGradient id="light" cx=".5" cy="0" r=".9"><stop offset="0" stop-color="rgba(255,255,255,.25)"/><stop offset="1" stop-color="rgba(255,255,255,0)"/></radialGradient>
      </defs>
      <rect width="400" height="62" fill="#0e1a24"/><rect width="400" height="46" fill="url(#crowd)"/>
      <rect y="46" width="400" height="14" fill="#0b8a43"/><text x="200" y="56.5" text-anchor="middle" class="pen-ad">placar · placar · placar · placar · placar</text>
      <rect y="60" width="400" height="240" fill="url(#grass)"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect y="${60 + i * 40}" width="400" height="20" fill="rgba(255,255,255,.035)"/>`).join('')}
      <rect width="400" height="300" fill="url(#light)"/>
      <path d="M40 ${G.b + 18}H360M86 ${G.b}l-46 ${18}M314 ${G.b}l46 ${18}" class="pen-line"/>
      <path d="M0 236H400" class="pen-line" opacity=".7"/><ellipse cx="${PEN.spot.x}" cy="${PEN.spot.y + 3}" rx="4" ry="1.6" fill="rgba(255,255,255,.85)"/>
      <g class="pen-goal"><rect x="${G.l + 6}" y="${G.t + 6}" width="${G.r - G.l - 12}" height="${G.b - G.t - 6}" fill="rgba(0,0,0,.18)"/>
        <rect id="pen-net" x="${G.l}" y="${G.t}" width="${G.r - G.l}" height="${G.b - G.t}" fill="url(#pnet)"/>
        <path d="M${G.l} ${G.b}V${G.t}H${G.r}V${G.b}" class="pen-post"/></g>
      <g id="pen-zones"></g>
      <g id="pen-keeper" class="pen-keeper"><ellipse cx="200" cy="173" rx="22" ry="4" fill="rgba(0,0,0,.25)"/>
        <rect x="190" y="146" width="8" height="26" rx="3" fill="#222"/><rect x="202" y="146" width="8" height="26" rx="3" fill="#222"/>
        <rect x="186" y="112" width="28" height="38" rx="9" fill="${keeperKit()}"/>
        <rect x="166" y="104" width="22" height="8" rx="4" fill="${keeperKit()}" transform="rotate(-35 177 108)"/><rect x="212" y="104" width="22" height="8" rx="4" fill="${keeperKit()}" transform="rotate(35 223 108)"/>
        <circle cx="166" cy="96" r="6" fill="#f4f4f4" stroke="#bbb"/><circle cx="234" cy="96" r="6" fill="#f4f4f4" stroke="#bbb"/>
        <circle cx="200" cy="101" r="10" fill="#e7b48f"/><path d="M190 99a10 10 0 0 1 20 0" fill="#3a2a1e"/></g>
      <g id="pen-aim" class="pen-aim" style="display:none"><circle r="11" fill="none" stroke="#fff" stroke-width="2"/><path d="M-16 0h8M8 0h8M0 -16v8M0 8v8" stroke="#fff" stroke-width="2"/></g>
      <g id="pen-dive-mark" style="display:none"><circle r="14" fill="rgba(255,255,255,.18)" stroke="#fff" stroke-dasharray="4 3"/></g>
      <ellipse id="pen-shadow" cx="${PEN.spot.x}" cy="${PEN.spot.y + 10}" rx="12" ry="3.5" fill="rgba(0,0,0,.3)"/>
      <g id="pen-ball" class="pen-ball"><circle cx="${PEN.spot.x}" cy="${PEN.spot.y}" r="11" fill="#fff" stroke="#333" stroke-width="1"/>
        <path d="M${PEN.spot.x} ${PEN.spot.y - 4}l4 3-1.5 4.5h-5L${PEN.spot.x - 4} ${PEN.spot.y - 1}z" fill="#222"/>
        <path d="M${PEN.spot.x - 10} ${PEN.spot.y - 3}l5 1M${PEN.spot.x + 10} ${PEN.spot.y - 3}l-5 1M${PEN.spot.x - 5} ${PEN.spot.y + 9}l2 -4M${PEN.spot.x + 5} ${PEN.spot.y + 9}l-2 -4" stroke="#222" stroke-width="1.2"/></g>
      <g id="pen-kicker" class="pen-kicker" style="--shirt:${shirt()}"><circle cx="232" cy="236" r="7" fill="#e7b48f"/><rect x="224" y="243" width="16" height="22" rx="6" fill="var(--shirt)"/>
        <rect x="226" y="262" width="5" height="18" rx="2" fill="#222"/><rect x="234" y="262" width="5" height="18" rx="2" fill="#222"/></g>
    </svg>`;

    const draw = () => {
      const winner = decided();
      const a = kick.me.filter(Boolean).length, b = kick.cpu.filter(Boolean).length;
      const head = `<div class="card pen-board">
        <div class="pen-team">${crest(me, 36)}<div><b>${esc(me.nome_popular)}</b><div class="pen-dots">${dots(kick.me)}</div></div></div>
        <div class="pen-score"><span>${a}</span><em>×</em><span>${b}</span><small>${winner ? 'Fim' : esc(round())}</small></div>
        <div class="pen-team r"><div><b>${esc(cpu.nome_popular)}</b><div class="pen-dots">${dots(kick.cpu)}</div></div>${crest(cpu, 36)}</div></div>`;
      let panel = '';
      if (winner) {
        const won = winner === 'me';
        panel = `<div class="pen-end ${won ? 'won' : ''}">${won ? '<div class="confetti">' + Array.from({ length: 36 }, (_, i) => `<i style="--x:${Math.random() * 100}%;--d:${(Math.random() * 1.2).toFixed(2)}s;--c:${['#0b8a43', '#ffd400', '#fff', kitColor(me)][i % 4]}"></i>`).join('') + '</div>' : ''}
          <b>${won ? `${esc(me.nome_popular)} é campeão nos pênaltis!` : `${esc(cpu.nome_popular)} venceu nos pênaltis.`}</b>
          <span>${a} × ${b} · você converteu ${session.gols} de ${session.chutes} e defendeu ${session.defesas} de ${session.defTot}</span>
          <div class="pen-actions"><button class="btn btn-primary" id="pen-again">Revanche</button><button class="btn" id="pen-teams">Trocar times</button></div></div>`;
      }
      $app.innerHTML = gameShell('Disputa de pênaltis', `${head}
        <div class="card pen-field ${phase}">
          <div class="pen-stage">${scene()}<div class="pen-flash" id="pen-flash"></div>
            <div class="pen-power" id="pen-power" hidden><div class="pp-bar"><i class="pp-green"></i><i class="pp-mark" id="pp-mark"></i></div><span>Toque para chutar</span></div>
            <div class="pen-timer" id="pen-timer" hidden><i></i></div>${panel}</div>
          <div class="pen-msg" id="pen-msg"></div></div>`, side());
      const again = document.getElementById('pen-again'); if (again) again.addEventListener('click', () => start());
      const tms = document.getElementById('pen-teams'); if (tms) tms.addEventListener('click', setup);
      if (!winner) bind();
    };

    const $ = (id) => document.getElementById(id);
    const msg = (html, cls = '') => { const m = $('pen-msg'); if (m) { m.className = `pen-msg ${cls}`; m.innerHTML = html; } };
    const flash = (text, cls) => { const f = $('pen-flash'); if (!f) return; f.className = `pen-flash show ${cls}`; f.textContent = text; };
    const svgPoint = (e) => { const svg = $('pen-svg'); const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
    const inGoalArea = (p) => p.x > PEN.goal.l - 40 && p.x < PEN.goal.r + 40 && p.y > PEN.goal.t - 35 && p.y < PEN.goal.b + 6;

    function bind() {
      const svg = $('pen-svg');
      if (turn === 'me') {
        phase = 'aim';
        msg(`<b>${esc(kickerName())}</b> vai bater. <span>Toque no gol onde quer chutar.</span>`);
        const aimEl = $('pen-aim');
        svg.addEventListener('pointermove', (e) => { if (phase !== 'aim') return; const p = svgPoint(e); aimEl.style.display = inGoalArea(p) ? '' : 'none'; aimEl.setAttribute('transform', `translate(${p.x} ${p.y})`); });
        svg.addEventListener('pointerdown', (e) => {
          if (phase === 'aim') {
            const p = svgPoint(e);
            if (!inGoalArea(p)) return;
            aim = { x: p.x, y: p.y };
            aimEl.style.display = ''; aimEl.setAttribute('transform', `translate(${p.x} ${p.y})`); aimEl.classList.add('locked');
            phase = 'power'; power = 0; powerDir = 1;
            $('pen-power').hidden = false;
            msg('<b>Força!</b> <span>Toque de novo para parar a barra na faixa verde.</span>');
            const speed = level === 'dificil' ? 2.3 : level === 'facil' ? 1.4 : 1.8;
            const tick = () => { power += powerDir * speed; if (power >= 100) { power = 100; powerDir = -1; } if (power <= 0) { power = 0; powerDir = 1; } const mk = $('pp-mark'); if (mk) mk.style.left = `${power}%`; raf = requestAnimationFrame(tick); };
            raf = requestAnimationFrame(tick);
          } else if (phase === 'power') {
            cancelAnimationFrame(raf);
            shoot();
          }
        });
      } else {
        phase = 'defend';
        const name = kickerName();
        msg(`<b>${esc(name)}</b> corre para a bola… <span>Toque onde você vai pular!</span>`, 'hot');
        const t = $('pen-timer'); t.hidden = false; t.style.setProperty('--ms', `${L.window}ms`);
        requestAnimationFrame(() => t.classList.add('run'));
        $('pen-kicker').classList.add('run');
        dive = null;
        svg.addEventListener('pointerdown', (e) => {
          if (phase !== 'defend') return;
          const p = svgPoint(e);
          if (!inGoalArea(p)) return;
          dive = { x: Math.max(PEN.goal.l - 10, Math.min(PEN.goal.r + 10, p.x)), y: Math.max(PEN.goal.t, Math.min(PEN.goal.b - 8, p.y)) };
          const dm = $('pen-dive-mark'); dm.style.display = ''; dm.setAttribute('transform', `translate(${dive.x} ${dive.y})`);
        });
        timer = setTimeout(cpuShoot, L.window);
      }
    }

    const moveKeeper = (to, slow = false) => {
      const k = $('pen-keeper');
      if (!k || !to) return;
      const dx = to.x - PEN.keeper.x, dy = Math.min(0, to.y - 125);
      const rot = Math.max(-80, Math.min(80, dx * 0.75));
      k.style.transitionDuration = slow ? '.55s' : '.38s';
      k.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    };
    const flyBall = (to, ms, scale = 0.55) => {
      const b = $('pen-ball'), sh = $('pen-shadow');
      b.style.transitionDuration = `${ms}ms`;
      b.style.transform = `translate(${to.x - PEN.spot.x}px, ${to.y - PEN.spot.y}px) scale(${scale})`;
      sh.style.transitionDuration = `${ms}ms`;
      sh.style.transform = `translate(${to.x - PEN.spot.x}px, ${Math.min(PEN.goal.b + 2, to.y + 30) - PEN.spot.y - 10}px) scale(.5)`;
      $('pen-kicker').classList.add('kick');
    };
    // alcance do goleiro: acertar o lado não basta, a bola bem colocada no canto ainda entra
    const reach = (rating, factor) => 29 * (1 + 0.2 * rating) * factor;
    const outcomeOf = (ball, keeperAt, R, slow) => {
      const G2 = PEN.goal;
      const nearPost = Math.abs(ball.x - G2.l) < 5 || Math.abs(ball.x - G2.r) < 5 || (Math.abs(ball.y - G2.t) < 5 && ball.x > G2.l && ball.x < G2.r);
      if (nearPost && ball.y > G2.t - 5) return 'trave';
      if (ball.x < G2.l || ball.x > G2.r || ball.y < G2.t) return 'fora';
      const k = keeperAt || { x: PEN.keeper.x, y: 130 };
      const d = Math.hypot(ball.x - k.x, (ball.y - k.y) * 1.15);
      return d <= R * (slow ? 1.35 : 1) ? 'defesa' : 'gol';
    };
    const finish = (scored, result, mine) => {
      kick[turn].push(scored);
      if (mine) { session.chutes++; if (scored) session.gols++; } else { session.defTot++; if (result === 'defesa') session.defesas++; }
      const T = { gol: mine ? ['GOOOL!', 'good'] : ['Gol deles', 'bad'], defesa: mine ? ['Defendeu!', 'bad'] : ['QUE DEFESA!', 'good'], fora: mine ? ['Pra fora!', 'bad'] : ['Pra fora!', 'good'], trave: mine ? ['Na trave!', 'bad'] : ['Na trave!', 'good'] }[result];
      flash(T[0], T[1]);
      if (result === 'gol') { const n = $('pen-net'); if (n) n.classList.add('hit'); }
      const winner = decided();
      if (winner) {
        const s = penStats();
        s[winner === 'me' ? 'v' : 'd']++;
        s.gols = (s.gols || 0) + session.gols; s.chutes = (s.chutes || 0) + session.chutes; s.defesas = (s.defesas || 0) + session.defesas; s.defTot = (s.defTot || 0) + session.defTot;
        s.seq = winner === 'me' ? (s.seq || 0) + 1 : 0; s.melhorSeq = Math.max(s.melhorSeq || 0, s.seq);
        store.set('placar.pen', s);
      }
      setTimeout(() => { if (!ok()) return; turn = turn === 'me' ? 'cpu' : 'me'; phase = 'intro'; draw(); }, 1700);
    };

    function shoot() {
      phase = 'flight';
      $('pen-power').hidden = true;
      const dev = Math.abs(power - 67.5);
      const spread = 7 + Math.max(0, dev - 12.5) * 0.9;
      const ang = Math.random() * Math.PI * 2, r = Math.random() * spread;
      const ball = { x: aim.x + Math.cos(ang) * r, y: aim.y + Math.sin(ang) * r - (power > 85 ? (power - 85) * 2.4 : 0) };
      const slow = power < 35;
      // goleiro: às vezes lê a cobrança, senão escolhe um canto
      const reads = Math.random() < L.read + cpu.forca * 0.12;
      const zones = [[125, 95], [200, 95], [275, 95], [125, 150], [200, 150], [275, 150]];
      const z = pick(zones);
      const keeperAt = reads ? { x: Math.max(110, Math.min(290, ball.x + (Math.random() - 0.5) * 50)), y: Math.max(85, Math.min(160, ball.y + (Math.random() - 0.5) * 40)) } : { x: z[0], y: z[1] };
      const result = outcomeOf(ball, keeperAt, reach(cpu.forca, L.reach), slow);
      const ms = slow ? 620 : 360 + (100 - power) * 1.2;
      setTimeout(() => moveKeeper(keeperAt), 90);
      flyBall(result === 'fora' && ball.y < PEN.goal.t ? { x: ball.x, y: ball.y - 40 } : ball, ms);
      if (result === 'defesa' || result === 'trave') setTimeout(() => flyBall({ x: ball.x + (ball.x < 200 ? -70 : 70), y: ball.y + 60 }, 380, 0.6), ms + 20);
      setTimeout(() => finish(result === 'gol', result, true), ms + 120);
      msg(`<b>${esc(kickerName())}</b> bateu!`);
    }

    function cpuShoot() {
      phase = 'flight';
      const t = $('pen-timer'); if (t) t.hidden = true;
      const miss = Math.random() < 0.05 + (1 - cpu.forca) * 0.07 + (level === 'facil' ? 0.06 : 0);
      const corner = Math.random() < 0.6;
      let ball;
      if (miss) ball = pick([{ x: PEN.goal.l - 20, y: 100 + Math.random() * 50 }, { x: PEN.goal.r + 20, y: 100 + Math.random() * 50 }, { x: 140 + Math.random() * 120, y: PEN.goal.t - 25 }]);
      else if (corner) ball = { x: pick([PEN.goal.l + 9 + Math.random() * 38, PEN.goal.r - 9 - Math.random() * 38]), y: PEN.goal.t + 9 + Math.random() * 95 };
      else ball = { x: 150 + Math.random() * 100, y: PEN.goal.t + 20 + Math.random() * 85 };
      const strong = Math.random() < 0.35 + cpu.forca * 0.2; // chute forte: o goleiro chega menos
      const result = outcomeOf(ball, dive, reach(me.forca, L.mine) * (strong ? 0.82 : 1), false);
      moveKeeper(dive || { x: PEN.keeper.x, y: 130 });
      flyBall(result === 'fora' && ball.y < PEN.goal.t ? { x: ball.x, y: ball.y - 30 } : ball, 400);
      if (result === 'defesa' || result === 'trave') setTimeout(() => flyBall({ x: ball.x + (ball.x < 200 ? -70 : 70), y: ball.y + 60 }, 380, 0.6), 420);
      setTimeout(() => finish(result === 'gol', result, false), 520);
    }

    view.cleanup = () => { cancelAnimationFrame(raf); clearTimeout(timer); };
    draw();
    msg(firstTurn === 'me' ? 'Sorteio: <b>você começa batendo</b>.' : `Sorteio: <b>${esc(cpu.nome_popular)}</b> começa. Prepare-se para defender!`);
  }

  setup();
}
