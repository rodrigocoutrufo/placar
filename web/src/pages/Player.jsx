import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useApi, fetchCached, soft } from '../lib/api.js';
import { useComps } from '../lib/data.js';
import { registry, regPlayer } from '../lib/registry.js';
import { timeAgo } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Crest, CompLogo, CountUp, Icon, ease } from '../components/ui.jsx';
import { TrophyCard, clubColors } from './Team.jsx';

export default function Player() {
  const id = +useParams().id;
  const { data: comps } = useComps();
  const info = useApi(`/atletas/${id}`, { ttl: 3_600_000 });
  const season = useQuery({
    queryKey: ['player-season', id], enabled: !!comps, staleTime: 300_000,
    queryFn: async () => {
      const [goals, assists] = await Promise.all([
        Promise.all(comps.map((c) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/artilharia`, 300_000)))),
        Promise.all(comps.map((c) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/assistencias`, 300_000))))]);
      return comps.map((c, i) => {
        const g = (goals[i] || []).find((s) => +s.atleta.atleta_id === id);
        const a = (assists[i] || []).find((s) => +s.atleta.atleta_id === id);
        if (g) regPlayer(g.atleta, { time: g.time }); else if (a) regPlayer(a.atleta, { time: a.time });
        return g || a ? { c, g: g ? g.gols : 0, a: a ? a.assistencias : 0, j: (g || a).jogos, time: (g || a).time } : null;
      }).filter(Boolean);
    },
  });
  if (!comps || info.isLoading || season.isLoading) return <><Skel h={300} /><Skel h={300} /></>;
  const detail = info.data && +info.data.atleta_id === id ? info.data : null;
  const pl = { ...(registry.players.get(id) || {}), ...(detail || {}) };
  const rows = season.data || [];
  if (!pl.nome_popular) return <Panel><Empty>Jogador não encontrado.</Empty></Panel>;
  const team = (detail && detail.time) || pl.time || (rows[0] && rows[0].time);
  return <PlayerView id={id} pl={pl} team={team} rows={rows} comps={comps} />;
}

function PlayerView({ id, pl, team, rows, comps }) {
  const q = new URLSearchParams({ nome: pl.nome_popular, clube: (team && team.nome_popular) || '', idade: pl.idade || '' });
  const tm = useApi(`/jogador-tm?${q}`, { ttl: 3_600_000 });
  const news = useApi(team ? `/noticias?por_pagina=5&time_id=${team.time_id}` : '', { ttl: 600_000, enabled: !!team });
  const d = tm.data;
  const [c1, c2] = clubColors(team || {});
  const photo = pl.foto || (d && d.foto);
  const tot = rows.reduce((a, s) => ({ g: a.g + s.g, a: a.a + s.a }), { g: 0, a: 0 });
  const pos = (pl.posicao && pl.posicao.nome) || (d && d.posicao);
  return (
    <>
      <section className="club-hero player" style={{ '--c1': c1, '--c2': c2 }}>
        <span className="ch-stripes" />
        {pl.camisa && <motion.span className="pl-num" initial={{ opacity: 0, x: 60 }} animate={{ opacity: 0.14, x: 0 }} transition={{ duration: 0.8, ease }}>{pl.camisa}</motion.span>}
        <div className="ch-in">
          <motion.div className="pl-photo" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : <span>{pl.nome_popular.split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</span>}
          </motion.div>
          <div className="ch-txt">
            {team && <small><Link to={`/time/${team.time_id}`}><Crest t={team} size={20} /> {team.nome_popular}</Link>{pos ? ` · ${pos}` : ''}</small>}
            <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6, ease }}>{pl.nome_popular}</motion.h1>
            <div className="to-meta">
              {pl.idade && <span><b>{pl.idade}</b> anos</span>}
              {pl.nacionalidade && <span>{pl.bandeira && <img className="flag" src={pl.bandeira} alt="" width="18" />} {pl.nacionalidade}</span>}
              {pl.altura && <span>{pl.altura}</span>}
              {d && d.mercado && d.mercado.atual && <span>Valor <b>{d.mercado.atual}</b></span>}
            </div>
            <Link className="follow" to={`/comparar?a=${id}`}>Comparar com outro jogador</Link>
          </div>
          <div className="pl-stats">
            <div><b><CountUp value={tot.g} /></b><span>Gols</span></div>
            <div><b><CountUp value={tot.a} /></b><span>Assist.</span></div>
          </div>
        </div>
      </section>
      <div className="grid-main">
        <div className="col">
          <Panel className="flush">
            <Head sub={(comps[0] && comps[0].edicao_atual && comps[0].edicao_atual.temporada) || ''}>Temporada</Head>
            {rows.length ? (
              <div className="tbl-wrap"><table className="tbl"><thead><tr><th className="l">Campeonato</th><th>Jogos</th><th>Gols</th><th>Assist.</th></tr></thead>
                <tbody>{rows.map((s) => <tr key={s.c.campeonato_id}><td className="team l"><Link to={`/campeonato/${s.c.campeonato_id}/artilharia`}><CompLogo c={s.c} size={20} /><span>{s.c.nome_popular}</span></Link></td><td>{s.j ?? '–'}</td><td className="pts"><b>{s.g}</b></td><td>{s.a}</td></tr>)}</tbody></table></div>
            ) : <Empty>Sem gols ou assistências registrados nos campeonatos acompanhados.</Empty>}
          </Panel>
          {tm.isLoading ? <Skel h={300} /> : d ? <TMProfile d={d} /> : <Panel><Empty>Perfil detalhado não encontrado no Transfermarkt.</Empty></Panel>}
        </div>
        <aside className="col side">
          {d && <Facts d={d} />}
          {news.data && (news.data.noticias || []).length > 0 && (
            <Panel><Head>Notícias do {team.nome_popular}</Head>
              <Stagger className="news-mini">{news.data.noticias.map((n) => (
                <Item key={n.link} as="a" href={n.link} target="_blank" rel="noopener noreferrer" className="nm-row">
                  {n.imagem && <img src={n.imagem} alt="" loading="lazy" onError={(e) => e.currentTarget.remove()} />}
                  <span><b>{n.titulo}</b><small>{n.provedor ? n.provedor.nome : ''} · {timeAgo(n.publicado_em)}</small></span>
                </Item>))}</Stagger></Panel>
          )}
        </aside>
      </div>
    </>
  );
}

function Facts({ d }) {
  const facts = [['Nome completo', d.nome_completo], ['Nascimento', d.nascimento ? `${d.nascimento}${d.idade ? ` (${d.idade} anos)` : ''}` : null], ['Naturalidade', d.naturalidade],
    ['Nacionalidade', (d.nacionalidades || []).map((n) => n.nome).join(', ')], ['Altura', d.altura], ['Pé preferido', d.pe], ['Posição', d.posicao],
    ['Clube', d.clube && d.clube.nome], ['No clube desde', d.no_clube_desde], ['Contrato até', d.contrato_ate], ['Empresário', d.empresario]].filter(([, v]) => v);
  return <Panel><Head>Dados pessoais</Head><dl className="facts">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Panel>;
}

function TMProfile({ d }) {
  const [all, setAll] = useState(false);
  const mv = d.mercado, tr = d.transferencias;
  const titles = d.titulos_detalhes || [];
  return (
    <>
      {mv && mv.atual && (
        <Panel>
          <Head sub={mv.atualizado_em ? `atualizado em ${mv.atualizado_em}` : ''}>Valor de mercado</Head>
          <div className="mv-head"><div><b>{mv.atual}</b><small>Valor atual</small></div>{mv.maior && <div><b className="muted">{mv.maior}</b><small>Maior valor{mv.maior_em ? ` · ${mv.maior_em}` : ''}</small></div>}</div>
          <MVChart hist={mv.historico} />
        </Panel>
      )}
      {tr && (tr.lista || []).length > 0 && (
        <Panel>
          <Head sub={tr.total_taxas ? `total em taxas: ${tr.total_taxas}` : ''}>Transferências</Head>
          <Stagger>{tr.lista.slice(0, all ? 99 : 8).map((t, i) => (
            <Item key={i} className="trf">
              <span className="trf-d"><b>{t.temporada}</b><small>{t.data}</small></span>
              <span className="trf-c">{t.de.escudo && <img src={t.de.escudo} alt="" width="22" />}{t.de.clube}<span className="trf-arr">{Icon.right}</span>{t.para.escudo && <img src={t.para.escudo} alt="" width="22" />}<b>{t.para.clube}</b></span>
              <span className="trf-f"><b>{t.taxa || '–'}</b>{t.valor_mercado && <small>VM {t.valor_mercado}</small>}</span>
            </Item>))}</Stagger>
          {tr.lista.length > 8 && !all && <div className="pad"><button className="btn" onClick={() => setAll(true)}>Ver todas as {tr.lista.length} transferências</button></div>}
        </Panel>
      )}
      {titles.length > 0 && (
        <section><h2 className="sec-h">Títulos e prêmios · {titles.reduce((a, t) => a + t.quantidade, 0)}</h2>
          <Stagger className="trophies">{titles.map((t) => (
            <TrophyCard key={t.titulo} t={{ ...t, temporadas: [] }}>
              <span className="tr-seasons">{(t.conquistas || []).map((c, i) => <i key={i}>{c.escudo && <img src={c.escudo} alt="" width="12" />}{c.temporada}{c.clube ? ` · ${c.clube}` : ''}</i>)}</span>
            </TrophyCard>))}</Stagger>
        </section>
      )}
      <p className="foot">Perfil, valor de mercado e transferências: <a href={d.url} target="_blank" rel="noopener noreferrer">Transfermarkt</a>.</p>
    </>
  );
}

// evolução do valor de mercado: a linha se desenha
function MVChart({ hist }) {
  const pts = (hist || []).filter((p) => p.valor != null && p.timestamp);
  if (pts.length < 2) return null;
  const W = 640, H = 210, P = { l: 56, r: 16, t: 16, b: 28 };
  const x0 = pts[0].timestamp, x1 = pts[pts.length - 1].timestamp, ymax = Math.max(...pts.map((p) => p.valor)) * 1.1 || 1;
  const X = (t) => P.l + ((t - x0) / (x1 - x0 || 1)) * (W - P.l - P.r);
  const Y = (v) => H - P.b - (v / ymax) * (H - P.t - P.b);
  const fmt = (v) => (v >= 1e6 ? `€${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} mi` : `€${Math.round(v / 1e3)} mil`);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.timestamp).toFixed(1)},${Y(p.valor).toFixed(1)}`).join(' ');
  const area = `${path} L${X(x1).toFixed(1)},${H - P.b} L${X(x0).toFixed(1)},${H - P.b} Z`;
  const y0 = new Date(x0).getFullYear(), y1 = new Date(x1).getFullYear();
  const step = Math.max(1, Math.ceil((y1 - y0) / 6));
  const years = []; for (let y = y0 + 1; y <= y1; y += step) years.push(y);
  return (
    <svg className="mv-chart" viewBox={`0 0 ${W} ${H}`}>
      {[0.25, 0.5, 0.75, 1].map((f) => { const v = (ymax / 1.1) * f; return <g key={f}><line x1={P.l} x2={W - P.r} y1={Y(v)} y2={Y(v)} className="g" /><text x={P.l - 6} y={Y(v) + 4} textAnchor="end">{fmt(v)}</text></g>; })}
      {years.map((y) => <text key={y} x={X(new Date(`${y}-01-01`).getTime())} y={H - 8} textAnchor="middle">{y}</text>)}
      <motion.path d={area} className="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} />
      <motion.path d={path} className="l" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.5, ease }} />
      {pts.map((p, i) => <motion.circle key={i} cx={X(p.timestamp)} cy={Y(p.valor)} r="4" initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + (i / pts.length) * 1.2 }}><title>{p.data} · {p.valor_fmt} · {p.clube}</title></motion.circle>)}
    </svg>
  );
}
