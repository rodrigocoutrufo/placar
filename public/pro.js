/* Placar — recursos exclusivos: Chances (probabilidades), Simulador de tabela, Tabela ao vivo,
 * probabilidade de vitória na partida e Comparador de jogadores.
 * Carregado antes do app.js; usa os helpers de lá (api, esc, crest, ...) só em tempo de execução. */
'use strict';

const pct = (v) => (v == null ? '–' : v >= 99.95 ? '100%' : v > 0 && v < 0.1 ? '<0,1%' : `${v.toFixed(1).replace('.', ',')}%`);
const heat = (v) => `style="--h:${Math.min(1, (v || 0) / 100).toFixed(3)}"`;

/* ================= Tabela ao vivo ================= */
// Como a tabela fica se os jogos em andamento terminarem agora.
function liveStandings(rows, live) {
  const byId = new Map(rows.map((r) => [r.time.time_id, r]));
  const byName = new Map(rows.map((r) => [norm(r.time.nome_popular), r]));
  const find = (t) => byId.get(t.time_id) || byName.get(norm(t.nome_popular));
  const games = live.filter((p) => find(p.time_mandante) && find(p.time_visitante));
  if (!games.length) return null;
  const copy = rows.map((r) => ({ ...r, _old: r.posicao }));
  const idx = new Map(copy.map((r) => [r.time.time_id, r]));
  const status = new Map();
  games.forEach((p) => {
    const h = idx.get(find(p.time_mandante).time.time_id), a = idx.get(find(p.time_visitante).time.time_id);
    const gh = p.placar_mandante || 0, ga = p.placar_visitante || 0;
    [[h, gh, ga, p], [a, ga, gh, p]].forEach(([r, f, c]) => {
      r.jogos += 1; r.gols_pro += f; r.gols_contra += c; r.saldo_gols += f - c;
      if (f > c) { r.pontos += 3; r.vitorias += 1; } else if (f === c) { r.pontos += 1; r.empates += 1; } else r.derrotas += 1;
    });
    status.set(h.time.time_id, p); status.set(a.time.time_id, p);
  });
  copy.sort((x, y) => y.pontos - x.pontos || y.vitorias - x.vitorias || y.saldo_gols - x.saldo_gols || y.gols_pro - x.gols_pro);
  const zonesByPos = new Map(rows.map((r) => [r.posicao, r.faixa_classificacao]));
  copy.forEach((r, i) => { r.posicao = i + 1; r.faixa_classificacao = zonesByPos.get(i + 1); r.variacao_posicao = r._old - r.posicao; r._live = status.get(r.time.time_id); });
  return copy;
}

function liveTableHTML(rows, campId) {
  return `<div class="table-wrap"><table class="tbl">
    <thead><tr><th>#</th><th class="l">Time</th><th>J</th><th>SG</th><th>P</th><th class="l">Agora</th></tr></thead>
    <tbody>${rows.map((r) => {
      const p = r._live;
      const mv = r.variacao_posicao > 0 ? `<span class="mv up">▲${r.variacao_posicao}</span>` : r.variacao_posicao < 0 ? `<span class="mv down">▼${-r.variacao_posicao}</span>` : '';
      return `<tr class="${p ? 'is-playing' : ''}"><td class="pos" style="--z:${(ZONES[r.faixa_classificacao] || [])[1] || 'transparent'}">${r.posicao}${mv}</td>
        <td class="team l"><a href="#/time/${r.time.time_id}?c=${campId}">${crest(r.time, 20)}<span>${esc(r.time.nome_popular)}</span></a></td>
        <td>${r.jogos}</td><td>${r.saldo_gols > 0 ? '+' : ''}${r.saldo_gols}</td><td class="pts">${r.pontos}</td>
        <td class="l">${p ? `<a class="now" href="#/partida/${p.partida_id}"><span class="live-dot"></span>${esc(p.time_mandante.sigla)} ${p.placar_mandante ?? 0}-${p.placar_visitante ?? 0} ${esc(p.time_visitante.sigla)} <span class="muted">${liveTag(p)}</span></a>` : ''}</td></tr>`;
    }).join('')}</tbody></table></div>`;
}

// Acrescenta o seletor "Atual | Ao vivo" na aba Classificação quando há jogo da liga rolando.
function attachLiveTable($tab, rows, campId, ok) {
  if (!rows || !rows.length) return;
  let mode = 'atual';
  const paint = () => {
    const lt = liveStandings(rows, liveNow || []);
    const bar = document.getElementById('lt-bar');
    if (!lt) { if (bar) bar.remove(); if (mode === 'vivo') { mode = 'atual'; router(); } return; }
    if (!bar) {
      $tab.insertAdjacentHTML('afterbegin', `<div class="seg" id="lt-bar"><button data-m="atual" class="active">Tabela atual</button><button data-m="vivo"><span class="live-dot"></span> Ao vivo — se terminar agora</button></div>`);
      document.querySelectorAll('#lt-bar [data-m]').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; paint(); }));
    }
    document.querySelectorAll('#lt-bar [data-m]').forEach((b) => b.classList.toggle('active', b.dataset.m === mode));
    const card = $tab.querySelector('.card');
    if (mode === 'vivo') card.innerHTML = liveTableHTML(lt, campId);
    else card.innerHTML = standingsTable(rows, campId);
  };
  paint();
  const prev = view.onLive;
  view.onLive = (l) => { if (prev) prev(l); if (ok()) paint(); };
}

/* ================= Chances ================= */
async function chancesTab(camp, $tab, ok) {
  $tab.innerHTML = `<div class="card card-body"><div class="small muted">Simulando milhares de campeonatos com os jogos que faltam…</div>${skel(380)}</div>`;
  let d;
  try { d = await api(`/campeonatos/${camp.campeonato_id}/chances`, 600000); } catch (e) { if (ok()) $tab.innerHTML = errorBox(e); return; }
  if (!ok()) return;
  const zones = d.zonas.filter((z) => ZONES[z.chave]);
  const favs = getFavs();
  const n = d.times.length;
  const dist = (x) => `<div class="dist" title="Chance de terminar em cada posição">${x.distribuicao.map((v, i) => `<i style="height:${Math.max(2, Math.min(100, v * 2.2))}%;background:${(ZONES[(d.zonas.find((z) => i + 1 >= z.de && i + 1 <= z.ate) || {}).chave] || [])[1] || 'var(--faint)'}" title="${i + 1}º: ${pct(v)}"></i>`).join('')}</div>`;
  const early = d.times.some((x) => x.jogos < 12);
  $tab.innerHTML = `<div class="stack">
    <div class="card chances-intro"><div><b>Chances no campeonato</b><div class="small muted">${(d.simulacoes).toLocaleString('pt-BR')} campeonatos simulados com os ${d.jogos_restantes} jogos que faltam. O modelo usa os gols marcados e sofridos na temporada e o mando de campo${early ? '; com poucas rodadas jogadas, as chances ainda mudam bastante' : ''}. Atualizado às ${new Date(d.atualizado_em.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.</div></div></div>
    <div class="card"><div class="table-wrap"><table class="tbl chances">
      <thead><tr><th>#</th><th class="l">Time</th><th>P</th><th title="Pontos esperados ao final">Final</th><th>Título</th>${zones.map((z) => `<th title="${ZONES[z.chave][0]} (${z.de}º–${z.ate}º)"><span class="zdot" style="--c:${ZONES[z.chave][1]}"></span>${ZONES[z.chave][0]}</th>`).join('')}<th class="hide-sm l">Posição final</th></tr></thead>
      <tbody>${d.times.map((x, i) => `<tr class="${favs[x.time.time_id] ? 'hl' : ''}">
        <td class="muted">${x.posicao_atual}</td>
        <td class="team l"><a href="#/time/${x.time.time_id}?c=${camp.campeonato_id}">${crest(x.time, 20)}<span>${esc(x.time.nome_popular)}</span></a></td>
        <td>${x.pontos}</td><td class="pts">${Math.round(x.pontos_esperados)}</td>
        <td class="heat" ${heat(x.titulo)}>${pct(x.titulo)}</td>
        ${zones.map((z) => `<td class="heat ${z.chave === 'rebaixamento' || z.chave === 'eliminado' ? 'bad' : ''}" ${heat(x.zonas[z.chave])}>${pct(x.zonas[z.chave])}</td>`).join('')}
        <td class="hide-sm l">${dist(x)}</td></tr>`).join('')}</tbody>
    </table></div></div>
    <div class="card"><div class="card-title">Próximos jogos · probabilidade de vitória</div>${d.jogos.slice(0, 12).map((m) => probRow(m)).join('')}</div>
  </div>`;
  void n;
}

function probBar(p, h, a) {
  return `<div class="pbar"><i style="width:${p.casa}%;background:${barColors(h, a)[0]}"></i><i style="width:${p.empate}%" class="d"></i><i style="width:${p.fora}%;background:${barColors(h, a)[1]}"></i></div>`;
}
function probRow(m) {
  const p = m.probabilidades;
  const d = parseDate({ data_realizacao_iso: m.data });
  return `<a class="prow" href="#/partida/${m.partida_id}">
    <span class="small muted">${d ? esc(fmtShort(d)) : ''}</span>
    <span class="t h">${esc(m.time_mandante.nome_popular)} ${crest(m.time_mandante, 18)}</span>
    <span class="pv"><b>${Math.round(p.casa)}%</b>${probBar(p, m.time_mandante, m.time_visitante)}<b>${Math.round(p.fora)}%</b></span>
    <span class="t">${crest(m.time_visitante, 18)} ${esc(m.time_visitante.nome_popular)}</span></a>`;
}

/* ================= Simulador ================= */
async function simulatorTab(camp, $tab, ok) {
  $tab.innerHTML = skel(420);
  let d;
  try { d = await api(`/campeonatos/${camp.campeonato_id}/chances`, 600000); } catch (e) { if (ok()) $tab.innerHTML = errorBox(e); return; }
  if (!ok()) return;
  const key = `placar.sim.${camp.campeonato_id}`;
  const sim = store.get(key, {});
  const games = d.jogos.filter((m) => m.status !== 'andamento');
  // agrupa por rodada (quando a fonte informa) ou por semana
  const groupKey = (m) => (m.rodada ? `${m.rodada}ª rodada` : (() => { const x = parseDate({ data_realizacao_iso: m.data }); if (!x) return 'A definir'; const s = new Date(x); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return `Semana de ${fmtShort(s)}`; })());
  const groups = [];
  games.forEach((m) => { const k = groupKey(m); let g = groups.find((x) => x.k === k); if (!g) { g = { k, ms: [] }; groups.push(g); } g.ms.push(m); });
  // começa na próxima rodada (jogos adiados antigos ficam para trás, ainda acessíveis pelas setas)
  const soon = Date.now() - 86400000;
  let gi = Math.max(0, groups.findIndex((g) => g.ms.some((m) => (parseDate({ data_realizacao_iso: m.data }) || 0) >= soon)));

  const table = () => {
    const rows = d.tabela.map((r) => ({ ...r, _old: r.posicao }));
    const idx = new Map(rows.map((r) => [r.time.time_id, r]));
    Object.entries(sim).forEach(([pid, s]) => {
      const m = games.find((x) => String(x.partida_id) === pid);
      if (!m || s.h == null || s.a == null) return;
      const h = idx.get(m.time_mandante.time_id), a = idx.get(m.time_visitante.time_id);
      if (!h || !a) return;
      [[h, s.h, s.a], [a, s.a, s.h]].forEach(([r, f, c]) => {
        r.jogos += 1; r.gols_pro += f; r.gols_contra += c; r.saldo_gols += f - c;
        if (f > c) { r.pontos += 3; r.vitorias += 1; } else if (f === c) { r.pontos += 1; r.empates += 1; } else r.derrotas += 1;
      });
    });
    rows.sort((x, y) => y.pontos - x.pontos || y.vitorias - x.vitorias || y.saldo_gols - x.saldo_gols || y.gols_pro - x.gols_pro);
    const zonesByPos = new Map(d.tabela.map((r) => [r.posicao, r.faixa_classificacao]));
    rows.forEach((r, i) => { r.posicao = i + 1; r.faixa_classificacao = zonesByPos.get(i + 1); r.variacao_posicao = r._old - r.posicao; });
    return rows;
  };
  const filled = () => Object.values(sim).filter((s) => s.h != null && s.a != null).length;

  const render = () => {
    const g = groups[gi];
    const rows = table();
    $tab.innerHTML = `<div class="sim">
      <div class="stack">
        <div class="card card-body sim-intro"><b>Simulador</b><div class="small muted">Preencha os placares dos jogos que faltam e veja a tabela mudar na hora. Seus palpites ficam salvos neste navegador.</div>
          <div class="sim-actions"><button class="btn" id="sim-auto">Preencher com o resultado mais provável</button><button class="btn" id="sim-clear">Limpar tudo</button><span class="small muted">${filled()} de ${games.length} jogos simulados</span></div></div>
        ${g ? `<div class="card"><div class="roundbar"><button class="arrow" id="sim-prev" ${gi ? '' : 'disabled style="opacity:.3"'}>${I.left}</button><b style="flex:1;text-align:center">${esc(g.k)}</b><button class="arrow" id="sim-next" ${gi < groups.length - 1 ? '' : 'disabled style="opacity:.3"'}>${I.right}</button></div>
          ${g.ms.map((m) => { const s = sim[m.partida_id] || {}; const p = m.probabilidades; return `<div class="sim-row" data-id="${m.partida_id}">
            <span class="t h">${esc(m.time_mandante.nome_popular)} ${crest(m.time_mandante, 20)}</span>
            <span class="pal-in"><input type="number" min="0" max="15" value="${s.h ?? ''}" aria-label="Gols ${esc(m.time_mandante.nome_popular)}"><span>x</span><input type="number" min="0" max="15" value="${s.a ?? ''}" aria-label="Gols ${esc(m.time_visitante.nome_popular)}"></span>
            <span class="t">${crest(m.time_visitante, 20)} ${esc(m.time_visitante.nome_popular)}</span>
            <span class="quick"><button data-q="1-0" title="Vitória do mandante (${Math.round(p.casa)}%)">1</button><button data-q="1-1" title="Empate (${Math.round(p.empate)}%)">X</button><button data-q="0-1" title="Vitória do visitante (${Math.round(p.fora)}%)">2</button></span>
          </div>`; }).join('')}</div>` : `<div class="card">${empty('Não há jogos restantes para simular.')}</div>`}
      </div>
      <div class="card sim-table"><div class="card-title">Tabela simulada</div>${liveTableHTML(rows.map((r) => ({ ...r, _live: null })), camp.campeonato_id).replace('<th class="l">Agora</th>', '').replace(/<td class="l"><\/td>/g, '')}</div>
    </div>`;
    const save = () => store.set(key, sim);
    $tab.querySelectorAll('.sim-row').forEach((row) => {
      const id = row.dataset.id;
      const [ih, ia] = row.querySelectorAll('input');
      const upd = () => { const h = ih.value === '' ? null : +ih.value, a = ia.value === '' ? null : +ia.value; if (h == null && a == null) delete sim[id]; else sim[id] = { h, a }; save(); render(); };
      ih.addEventListener('change', upd); ia.addEventListener('change', upd);
      row.querySelectorAll('[data-q]').forEach((b) => b.addEventListener('click', () => { const [h, a] = b.dataset.q.split('-').map(Number); sim[id] = { h, a }; save(); render(); }));
    });
    const on = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); };
    on('sim-prev', () => { gi = Math.max(0, gi - 1); render(); });
    on('sim-next', () => { gi = Math.min(groups.length - 1, gi + 1); render(); });
    on('sim-clear', () => { Object.keys(sim).forEach((k) => delete sim[k]); save(); render(); });
    on('sim-auto', () => {
      games.forEach((m) => { if (sim[m.partida_id]) return; const p = m.probabilidades; const best = p.casa >= p.empate && p.casa >= p.fora ? [1, 0] : p.fora >= p.empate ? [0, 1] : [1, 1]; sim[m.partida_id] = { h: best[0], a: best[1] }; });
      save(); render();
    });
  };
  render();
}

/* ================= Partida: probabilidade de vitória ================= */
function matchProbCard(p) {
  const pr = p.probabilidades;
  if (!pr) return '';
  const live = pr.ao_vivo && isLive(p);
  const cur = live ? pr.ao_vivo : pr.pre;
  const H = p.time_mandante, A = p.time_visitante;
  return `<div class="card"><div class="card-title">${live ? '<span class="live-dot"></span> Probabilidade ao vivo' : p.status === 'finalizado' ? 'Probabilidade antes do jogo' : 'Probabilidade de vitória'}<span class="more">${pr.confianca === 'baixa' ? 'estimativa com poucos dados' : 'modelo do Placar'}</span></div>
    <div class="wp">
      <div class="wp-side">${crest(H, 28)}<b>${pct(cur.casa)}</b><span>${esc(H.nome_popular)}</span></div>
      <div class="wp-side"><span class="wp-x">X</span><b>${pct(cur.empate)}</b><span>Empate</span></div>
      <div class="wp-side">${crest(A, 28)}<b>${pct(cur.fora)}</b><span>${esc(A.nome_popular)}</span></div>
    </div>
    <div style="padding:0 16px 14px">${probBar(cur, H, A)}</div>
    ${live ? `<div class="small muted" style="padding:0 16px 14px">Antes do jogo: ${esc(H.sigla)} ${pct(pr.pre.casa)} · empate ${pct(pr.pre.empate)} · ${esc(A.sigla)} ${pct(pr.pre.fora)}</div>` : ''}
    <div class="small muted" style="padding:0 16px 14px">Gols esperados: ${esc(H.sigla)} ${String(pr.gols_esperados.casa).replace('.', ',')} · ${esc(A.sigla)} ${String(pr.gols_esperados.fora).replace('.', ',')}</div>
  </div>`;
}

// Momento dos dois times na tabela: posição, pontos, aproveitamento, gols por jogo e últimos jogos.
function preGameCard(p, rows) {
  if (!rows) return '';
  const find = (t) => rows.find((r) => +r.time.time_id === +t.time_id) || rows.find((r) => norm(r.time.nome_popular) === norm(t.nome_popular));
  const h = find(p.time_mandante), a = find(p.time_visitante);
  if (!h || !a) return '';
  const ap = (r) => (r.jogos ? Math.round((r.pontos / (r.jogos * 3)) * 100) : 0);
  const gpj = (v, r) => (r.jogos ? (v / r.jogos).toFixed(1).replace('.', ',') : '–');
  const line = (label, x, y, better) => {
    const nx = parseFloat(String(x).replace(',', '.')), ny = parseFloat(String(y).replace(',', '.'));
    const bx = better === 'min' ? nx < ny : nx > ny, by = better === 'min' ? ny < nx : ny > nx;
    return `<div class="pg-row"><span class="${bx ? 'best' : ''}">${x}</span><em>${label}</em><span class="${by ? 'best' : ''}">${y}</span></div>`;
  };
  return `<div class="card"><div class="card-title">${p.status === 'finalizado' ? 'Os times na tabela' : 'Momento dos times'}</div>
    <div class="pg-head"><span>${crest(p.time_mandante, 22)} ${esc(p.time_mandante.sigla || p.time_mandante.nome_popular)}</span><span>${esc(p.time_visitante.sigla || p.time_visitante.nome_popular)} ${crest(p.time_visitante, 22)}</span></div>
    ${line('Posição', `${h.posicao}º`, `${a.posicao}º`, 'min')}${line('Pontos', h.pontos, a.pontos)}${line('Aproveitamento', `${ap(h)}%`, `${ap(a)}%`)}
    ${line('Gols marcados por jogo', gpj(h.gols_pro, h), gpj(a.gols_pro, a))}${line('Gols sofridos por jogo', gpj(h.gols_contra, h), gpj(a.gols_contra, a), 'min')}
    ${(h.ultimos_jogos || []).length ? `<div class="pg-row"><span>${formDots(h.ultimos_jogos)}</span><em>Últimos jogos</em><span>${formDots(a.ultimos_jogos)}</span></div>` : ''}
  </div>`;
}

/* ================= Onde assistir ================= */
const TV_KIND = { aberta: ['TV aberta', 'k-open'], fechada: ['TV fechada', 'k-pay'], streaming: ['Streaming', 'k-stream'], ppv: ['Pay-per-view', 'k-ppv'], youtube: ['YouTube', 'k-yt'] };
function watchCard(w, title = 'Onde assistir') {
  if (!w || (!(w.canais || []).length && !w.materia)) return '';
  const when = w.atualizado_em ? new Date(`${w.atualizado_em}T12:00:00`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }) : '';
  return `<div class="card watch"><div class="card-title"><span class="tv-ico">${TV_ICON}</span>${esc(title)}</div>
    ${w.materia ? `<a class="watch-news" href="${esc(w.materia.link)}" target="_blank" rel="noopener noreferrer"><b>Canal deste jogo</b><span>${esc(w.materia.titulo)}</span><em>${esc(w.materia.veiculo || '')} ↗</em></a>` : ''}
    ${(w.canais || []).length ? `<div class="tv-list">${w.canais.map((c) => { const k = TV_KIND[c.tipo] || ['', '']; return `<div class="tv ${k[1]}"><b>${esc(c.nome)}</b><span>${esc(k[0])}${c.obs ? ` · ${esc(c.obs)}` : ''}</span></div>`; }).join('')}</div>` : ''}
    <div class="small faint watch-foot">${w.nota ? `${esc(w.nota)} ` : ''}${w.materia ? '' : 'Canais com direitos no Brasil para este campeonato'}${when ? ` (levantamento de ${esc(when)})` : ''}. Confira a grade da emissora.</div></div>`;
}
const TV_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="m9 2 3 4 3-4"/></svg>';

/* ================= Comparador de jogadores ================= */
async function viewCompare(ok, params) {
  $app.innerHTML = `<div class="stack">${skel(120)}${skel(420)}</div>`;
  const pool = await soft(api('/minijogos/craques', 600000)) || [];
  if (!ok()) return;
  const ids = [params.get('a'), params.get('b')].map((x) => (x ? +x : null));
  const fromPool = (id) => pool.find((p) => p.id === id);
  const fromReg = (id) => { const r = registry.players.get(id); return r ? { id, nome: r.nome_popular, time: r.time, posicao: r.posicao && r.posicao.nome } : null; };
  const picked = ids.map((id) => (id ? fromPool(id) || fromReg(id) || { id, nome: null } : null));
  // completa nome/time de quem veio de fora da lista (ex.: link da página do jogador)
  await Promise.all(picked.map(async (p, i) => {
    if (p && !p.nome) { const a = await soft(api(`/atletas/${p.id}`, 3600000)); if (a) picked[i] = { id: p.id, nome: a.nome_popular, time: a.time, idade: a.idade, nacionalidade: a.nacionalidade, posicao: a.posicao && a.posicao.nome }; }
  }));
  if (!ok()) return;
  const slot = (p, i) => `<div class="cmp-slot">
    ${p ? `<a href="#/jogador/${p.id}" class="cmp-who">${p.time ? crest(p.time, 40) : ''}<div><b>${esc(p.nome || '')}</b><span>${esc(p.time ? p.time.nome_popular : '')}</span></div></a>` : '<div class="cmp-who empty-slot"><b>Escolha um jogador</b></div>'}
    <div class="cq-search"><input data-slot="${i}" placeholder="${p ? 'Trocar jogador…' : 'Buscar jogador…'}" autocomplete="off"><div class="suggest" hidden></div></div></div>`;
  $app.innerHTML = `<div class="stack">
    <div><h1 class="h1">Comparar jogadores</h1><div class="muted small">Temporada atual, valor de mercado e carreira, lado a lado.</div></div>
    <div class="card cmp-pick">${slot(picked[0], 0)}<div class="cmp-vs">vs</div>${slot(picked[1], 1)}</div>
    <div id="cmp-body">${picked[0] && picked[1] ? skel(420) : `<div class="card">${empty('Escolha dois jogadores para comparar.')}</div>`}</div></div>`;
  $app.querySelectorAll('[data-slot]').forEach((inp) => {
    const $sug = inp.nextElementSibling;
    inp.addEventListener('input', () => {
      const q = norm(inp.value);
      if (q.length < 2) { $sug.hidden = true; return; }
      const hits = pool.filter((p) => norm(p.nome).includes(q)).slice(0, 8);
      $sug.innerHTML = hits.map((p) => `<a data-id="${p.id}">${crest(p.time, 20)}<span>${esc(p.nome)}</span><span class="kind">${esc(p.time.nome_popular)}</span></a>`).join('') || '<div class="none">Nenhum jogador encontrado</div>';
      $sug.hidden = false;
      $sug.querySelectorAll('[data-id]').forEach((a) => a.addEventListener('click', () => {
        const next = [...ids]; next[+inp.dataset.slot] = +a.dataset.id;
        location.hash = `#/comparar?${new URLSearchParams(Object.fromEntries(next.map((v, k) => [k ? 'b' : 'a', v || '']).filter(([, v]) => v)))}`;
      }));
    });
  });
  if (!(picked[0] && picked[1])) return;

  const comps = await api('/campeonatos', 600000);
  const [goals, assists, tm] = await Promise.all([
    Promise.all(comps.map((c) => soft(api(`/campeonatos/${c.campeonato_id}/artilharia`, 300000)))),
    Promise.all(comps.map((c) => soft(api(`/campeonatos/${c.campeonato_id}/assistencias`, 300000)))),
    Promise.all(picked.map((p) => soft(api(`/jogador-tm?${new URLSearchParams({ nome: p.nome, clube: (p.time && p.time.nome_popular) || '', idade: p.idade || '' })}`, 3600000)))),
  ]);
  if (!ok()) return;
  const season = (p) => {
    let g = 0, a = 0, j = 0;
    comps.forEach((c, i) => {
      const sg = (goals[i] || []).find((s) => +s.atleta.atleta_id === +p.id);
      const sa = (assists[i] || []).find((s) => +s.atleta.atleta_id === +p.id);
      if (sg) { g += sg.gols; j = Math.max(j, sg.jogos || 0); }
      if (sa) { a += sa.assistencias; j = Math.max(j, sa.jogos || 0); }
    });
    return { g, a, j };
  };
  const S = picked.map(season);
  const mv = tm.map((t) => (t && t.mercado ? mvNumber(t.mercado.atual) : 0));
  const titles = tm.map((t) => (t && t.titulos_detalhes ? t.titulos_detalhes.reduce((x, y) => x + y.quantidade, 0) : 0));
  const height = tm.map((t) => (t && t.altura ? parseFloat(t.altura.replace(',', '.')) : 0));
  const fmtMv = (v) => (v >= 1e6 ? `€ ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',')} mi` : v ? `€ ${Math.round(v / 1e3)} mil` : '–');
  const row = (label, a, b, fmt = (x) => x, better = 'max') => {
    const na = +a || 0, nb = +b || 0, tot = na + nb || 1;
    const wa = better === 'max' ? na > nb : na < nb && na > 0, wb = better === 'max' ? nb > na : nb < na && nb > 0;
    return `<div class="stat"><div class="stat-top"><span>${wa ? `<b>${fmt(a)}</b>` : fmt(a)}</span><span>${label}</span><span>${wb ? `<b>${fmt(b)}</b>` : fmt(b)}</span></div>
      <div class="stat-bars"><div><i class="h ${wa ? 'lead' : ''}" style="width:${(na / tot) * 100}%"></i></div><div><i class="a ${wb ? 'lead' : ''}" style="width:${(nb / tot) * 100}%"></i></div></div></div>`;
  };
  const per90 = (s) => (s.j ? ((s.g + s.a) / s.j).toFixed(2).replace('.', ',') : '–');
  const [ch, ca] = barColors(picked[0].time, picked[1].time);
  const info = (t, p) => [['Posição', (t && t.posicao) || p.posicao], ['Idade', (t && t.idade) || p.idade], ['Nacionalidade', (t && (t.nacionalidades || []).map((n) => n.nome).join(', ')) || p.nacionalidade],
    ['Altura', t && t.altura], ['Pé', t && t.pe], ['Clube', t && t.clube && t.clube.nome], ['Contrato até', t && t.contrato_ate]];
  const ia = info(tm[0], picked[0]), ib = info(tm[1], picked[1]);
  document.getElementById('cmp-body').innerHTML = `<div class="cols-2"><div class="stack">
    <div class="card cmp-faces">${picked.map((p, i) => `<div>${tm[i] && tm[i].foto ? `<img src="${esc(tm[i].foto)}" alt="">` : `<span class="avatar">${esc((p.nome || '?').split(' ').map((w) => w[0]).slice(0, 2).join(''))}</span>`}<b>${esc(p.nome)}</b></div>`).join('<span class="cmp-vs">vs</span>')}</div>
    <div class="card" style="--ch:${ch};--ca:${ca}"><div class="card-title">Temporada</div>
      ${row('Gols', S[0].g, S[1].g)}${row('Assistências', S[0].a, S[1].a)}${row('Participações em gol', S[0].g + S[0].a, S[1].g + S[1].a)}${row('Jogos', S[0].j, S[1].j)}
      <div class="stat"><div class="stat-top"><span>${per90(S[0])}</span><span>Gols + assistências por jogo</span><span>${per90(S[1])}</span></div></div></div>
    <div class="card" style="--ch:${ch};--ca:${ca}"><div class="card-title">Carreira</div>
      ${row('Valor de mercado', mv[0], mv[1], fmtMv)}${row('Títulos', titles[0], titles[1])}${row('Altura (m)', height[0], height[1], (x) => (x ? String(x).replace('.', ',') : '–'))}</div>
  </div><aside class="side"><div class="card"><div class="card-title">Ficha</div>
    ${ia.map(([k, v], i) => `<div class="cmp-fact"><span>${esc(v ?? '–')}</span><em>${k}</em><span>${esc(ib[i][1] ?? '–')}</span></div>`).join('')}</div>
    <div class="small faint">Temporada: artilharia e assistências dos campeonatos acompanhados. Carreira: Transfermarkt.</div></aside></div>`;
}
