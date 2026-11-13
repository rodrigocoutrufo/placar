/* Placar — dados de clube e títulos (Transfermarkt): abas Elenco, Títulos e Clube da página do time,
 * resumo de títulos na visão geral e a sala de troféus do jogador.
 * Carregado antes do app.js; usa os helpers de lá (api, esc, crest, ...) só em tempo de execução. */
'use strict';

const CAT_ORDER = ['Mundial', 'Continental', 'Liga nacional', 'Copa nacional', 'Estadual', 'Outros'];

function teamTM(team) {
  const q = new URLSearchParams({ nome: team.nome_popular || '', nome_completo: team.nome || '', pais: team.pais || '' });
  return soft(api(`/time-tm?${q}`, 6 * 3600000));
}

function trophyCard(t, extra = '') {
  const seasons = t.temporadas || [];
  return `<div class="trophy">
    <div class="trophy-img">${t.imagem ? `<img src="${esc(t.imagem)}" alt="" loading="lazy" onerror="this.remove()">` : ''}</div>
    <div class="trophy-body">
      <div class="trophy-n">${t.quantidade}<span>×</span></div>
      <div class="trophy-name">${esc(t.titulo)}</div>
      ${seasons.length ? `<div class="trophy-seasons">${seasons.slice(0, 12).map((s) => `<span>${esc(s)}</span>`).join('')}${seasons.length > 12 ? `<span class="more-s">+${seasons.length - 12}</span>` : ''}</div>` : ''}
      ${extra}
    </div></div>`;
}

function titlesByCategory(list) {
  const groups = CAT_ORDER.map((cat) => [cat, list.filter((t) => (t.categoria || 'Outros') === cat)]).filter(([, l]) => l.length);
  return groups.map(([cat, l]) => `<div class="sec-label">${cat} · ${l.reduce((a, t) => a + t.quantidade, 0)}</div><div class="trophies">${l.map((t) => trophyCard(t)).join('')}</div>`).join('');
}

/* ---- abas da página do time ---- */
async function teamExtraTab(tab, id, team, $t, ok) {
  $t.innerHTML = skel(420);
  const [tm, ours] = await Promise.all([teamTM(team), tab === 'elenco' ? soft(api(`/times/${id}/elenco`, 3600000)) : null]);
  if (!ok()) return;
  const source = tm ? `<div class="small faint" style="padding:0 2px">Dados do clube, títulos e valores: <a href="${esc(tm.url)}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">Transfermarkt</a>.</div>` : '';

  if (tab === 'titulos') {
    const list = (tm && tm.titulos) || [];
    const total = list.reduce((a, t) => a + t.quantidade, 0);
    $t.innerHTML = list.length ? `<div class="stack">
      <div class="card"><div class="kv">${CAT_ORDER.slice(0, 5).map((cat) => `<div><b>${list.filter((t) => t.categoria === cat).reduce((a, t) => a + t.quantidade, 0)}</b><span>${cat === 'Liga nacional' ? 'Ligas nacionais' : cat === 'Copa nacional' ? 'Copas nacionais' : cat === 'Estadual' ? 'Estaduais' : cat === 'Continental' ? 'Continentais' : 'Mundiais'}</span></div>`).join('')}<div><b>${total}</b><span>Total</span></div></div></div>
      <div class="card">${titlesByCategory(list)}</div>${source}</div>`
      : `<div class="card">${empty('Nenhum título encontrado para este clube.')}</div>`;
    return;
  }

  if (tab === 'clube') {
    if (!tm) { $t.innerHTML = `<div class="card">${empty('Perfil do clube indisponível no momento.')}</div>`; return; }
    const kpis = [['Valor de mercado do elenco', tm.valor_mercado], ['Jogadores no elenco', tm.plantel], ['Idade média', tm.idade_media && `${tm.idade_media} anos`],
      ['Estrangeiros', tm.estrangeiros && `${tm.estrangeiros}${tm.estrangeiros_pct ? ` (${tm.estrangeiros_pct})` : ''}`], ['Jogadores de seleção', tm.selecao],
      ['Saldo de transferências', tm.balanco_transferencias]].filter(([, v]) => v);
    const ficha = [['Nome', team.nome || tm.nome], ['País', tm.pais], ['Fundação', team.fundacao], ['Cores', team.cores], ['Técnico', team.tecnico && team.tecnico.nome],
      ['Site oficial', team.site && `<a href="${esc(team.site)}" target="_blank" rel="noopener noreferrer" style="text-decoration:underline">${esc(team.site.replace(/^https?:\/\/(www\.)?/, ''))}</a>`]].filter(([, v]) => v);
    const mostValued = [...(tm.elenco || [])].sort((a, b) => mvNumber(b.valor_mercado) - mvNumber(a.valor_mercado)).slice(0, 5);
    const titles = (tm.titulos || []).slice(0, 4);
    $t.innerHTML = `<div class="cols-2"><div class="stack">
      <div class="card"><div class="card-title">Elenco em números</div><div class="kv kv-lg">${kpis.map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div></div>
      ${tm.estadio ? `<div class="card stadium"><div class="st-ico"><svg viewBox="0 0 24 24"><path d="M3 10c0-2.2 4-4 9-4s9 1.8 9 4v6c0 2.2-4 4-9 4s-9-1.8-9-4v-6Z"/><path d="M3 10c0 2.2 4 4 9 4s9-1.8 9-4"/></svg></div>
        <div><div class="small muted">Estádio</div><div class="st-name">${esc(tm.estadio)}</div>${tm.capacidade ? `<div class="small muted">Capacidade: ${esc(tm.capacidade)}</div>` : ''}</div></div>` : ''}
      ${mostValued.length ? `<div class="card"><div class="card-title">Mais valiosos do elenco<a class="more" href="#/time/${id}/elenco">Elenco completo</a></div>${mostValued.map((p, i) => `
        <div class="rank-row"><span class="n">${i + 1}</span>${p.foto ? `<img class="mini-face" src="${esc(p.foto)}" alt="">` : '<span></span>'}<div class="who"><div class="nm">${esc(p.nome)}</div><div class="small muted">${esc(p.posicao || '')}${p.idade ? ` · ${p.idade} anos` : ''}</div></div><span class="v" style="font-size:14px">${esc(p.valor_mercado)}</span></div>`).join('')}</div>` : ''}
    </div><aside class="side">
      ${ficha.length ? `<div class="card"><div class="card-title">Ficha do clube</div><div class="facts-grid one">${ficha.map(([k, v]) => `<div><span>${k}</span><b>${k === 'Site oficial' ? v : esc(v)}</b></div>`).join('')}</div></div>` : ''}
      ${titles.length ? `<div class="card"><div class="card-title">Principais títulos<a class="more" href="#/time/${id}/titulos">Todos</a></div>${titles.map((t) => `<div class="list-row">${t.imagem ? `<img src="${esc(t.imagem)}" width="28" height="28" alt="" style="object-fit:contain">` : ''}<span style="font-weight:500">${esc(t.titulo)}</span><b class="right" style="color:var(--text)">${t.quantidade}×</b></div>`).join('')}</div>` : ''}
    </aside></div>${source}`;
    return;
  }

  // elenco: detalhado (Transfermarkt) quando disponível; senão o da fonte de dados
  const list = Array.isArray(ours) ? ours : [];
  list.forEach((x) => regPlayer(x.atleta, { time: team, camisa: x.camisa, posicao: x.posicao }));
  const ourByName = new Map(list.map((x) => [norm(x.atleta.nome_popular), x.atleta.atleta_id]));
  const findOurs = (name) => {
    const n = norm(name);
    if (ourByName.has(n)) return ourByName.get(n);
    const last = n.split(' ').pop();
    const hit = [...ourByName.keys()].find((k) => k === last || k.endsWith(` ${last}`) && k.split(' ')[0] === n.split(' ')[0]);
    return hit ? ourByName.get(hit) : null;
  };
  if (tm && tm.elenco && tm.elenco.length) {
    const groupOf = (p) => {
      const s = norm(p.posicao);
      if (s.includes('goleiro')) return 'Goleiros';
      if (/zagueiro|lateral|defens/.test(s)) return 'Defensores';
      if (/volante|meia|meio/.test(s)) return 'Meio-campistas';
      return 'Atacantes';
    };
    const order = ['Goleiros', 'Defensores', 'Meio-campistas', 'Atacantes'];
    const row = (p) => {
      const our = findOurs(p.nome);
      const name = `${p.foto ? `<img class="mini-face" src="${esc(p.foto)}" alt="" loading="lazy">` : '<span class="mini-face"></span>'}<div><div class="nm">${esc(p.nome)}</div><div class="small muted">${esc(p.posicao || '')}</div></div>`;
      return `<tr>
        <td class="num">${esc(p.camisa || '')}</td>
        <td class="l">${our ? `<a class="sq-name" href="#/jogador/${our}">${name}</a>` : `<span class="sq-name">${name}</span>`}</td>
        <td>${p.idade ?? ''}</td>
        <td class="hide-sm">${(p.nacionalidades || []).map((n) => `<img class="flag" src="${esc(n.bandeira)}" alt="${esc(n.nome)}" title="${esc(n.nome)}">`).join(' ')}</td>
        <td class="hide-sm">${esc(p.altura || '')}</td><td class="hide-sm">${esc(p.pe || '')}</td>
        <td class="hide-sm">${esc(p.contrato_ate || '')}</td>
        <td class="r"><b>${esc(p.valor_mercado && p.valor_mercado !== '-' ? p.valor_mercado : '–')}</b></td></tr>`;
    };
    $t.innerHTML = `<div class="stack">
      <div class="card"><div class="kv">${[['Jogadores', tm.plantel || tm.elenco.length], ['Idade média', tm.idade_media], ['Estrangeiros', tm.estrangeiros], ['Valor do elenco', tm.valor_mercado]].filter(([, v]) => v).map(([k, v]) => `<div><b>${esc(v)}</b><span>${k}</span></div>`).join('')}</div></div>
      <div class="card"><div class="table-wrap"><table class="tbl squad">
        <thead><tr><th>#</th><th class="l">Jogador</th><th>Idade</th><th class="hide-sm">Nac.</th><th class="hide-sm">Altura</th><th class="hide-sm">Pé</th><th class="hide-sm">Contrato</th><th class="r">Valor</th></tr></thead>
        ${order.map((g) => { const l = tm.elenco.filter((p) => groupOf(p) === g); return l.length ? `<tbody><tr class="grp"><td colspan="8">${g}</td></tr>${l.map(row).join('')}</tbody>` : ''; }).join('')}
      </table></div></div>${source}</div>`;
    return;
  }
  if (!list.length) { $t.innerHTML = `<div class="card">${empty('Elenco indisponível para este time.')}</div>`; return; }
  $t.innerHTML = `<div class="card">${list.map((x) => `<a class="list-row" href="#/jogador/${x.atleta.atleta_id}"><span class="jersey">${esc(x.camisa || '')}</span><span style="font-weight:500">${esc(x.atleta.nome_popular)}</span><span class="right">${esc((x.posicao && x.posicao.nome) || '')}${x.idade ? ` · ${x.idade} anos` : ''}</span></a>`).join('')}</div>`;
}

function mvNumber(v) {
  const m = /([\d.,]+)\s*(mil|mi|bi)/i.exec(v || ''); // "mil" antes de "mi": €800mil ≠ €800mi
  if (!m) return 0;
  const n = parseFloat(m[1].replace(',', '.'));
  return n * ({ bi: 1e9, mi: 1e6, mil: 1e3 }[m[2].toLowerCase()] || 1);
}

/* ---- resumo de títulos na visão geral do time ---- */
async function teamTitlesTeaser(team, id, ok) {
  const tm = await teamTM(team);
  const aside = document.getElementById('team-aside');
  if (!ok() || !aside || !tm) return;
  const titles = (tm.titulos || []).filter((t) => ['Mundial', 'Continental', 'Liga nacional', 'Copa nacional'].includes(t.categoria)).slice(0, 5);
  const html = `
    ${titles.length ? `<div class="card"><div class="card-title">Sala de troféus<a class="more" href="#/time/${id}/titulos">Todos os títulos</a></div>${titles.map((t) => `<div class="list-row">${t.imagem ? `<img src="${esc(t.imagem)}" width="28" height="28" alt="" style="object-fit:contain">` : ''}<span style="font-weight:500">${esc(t.titulo)}</span><b class="right" style="color:var(--text)">${t.quantidade}×</b></div>`).join('')}</div>` : ''}
    ${tm.valor_mercado ? `<a class="card club-mini" href="#/time/${id}/clube"><div><div class="small muted">Valor do elenco</div><b>${esc(tm.valor_mercado)}</b></div><div><div class="small muted">Idade média</div><b>${esc(tm.idade_media || '–')}</b></div><div><div class="small muted">Estádio</div><b>${esc(tm.capacidade || '–')}</b></div></a>` : ''}`;
  aside.insertAdjacentHTML('afterbegin', html);
}

/* ---- títulos do jogador ---- */
function playerTitlesCard(d) {
  const list = d.titulos_detalhes && d.titulos_detalhes.length ? d.titulos_detalhes : null;
  if (!list) return '';
  const total = list.reduce((a, t) => a + t.quantidade, 0);
  return `<div class="card"><div class="card-title">Títulos e prêmios<span class="more">${total} no total</span></div>
    <div class="trophies">${list.map((t) => trophyCard({ ...t, temporadas: [] }, `<div class="trophy-wins">${(t.conquistas || []).map((c) => `<span>${c.escudo ? `<img src="${esc(c.escudo)}" alt="" width="14" height="14">` : ''}${esc(c.temporada)}${c.clube ? ` · ${esc(c.clube)}` : ''}</span>`).join('')}</div>`)).join('')}</div></div>`;
}
