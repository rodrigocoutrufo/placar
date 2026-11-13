import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useApi, fetchCached, soft } from '../lib/api.js';
import { useComps } from '../lib/data.js';
import { useLive } from '../lib/live.js';
import { buildIndex, searchAll, registry, mvNumber } from '../lib/registry.js';
import { getFavs, toggleFav, useStoreVersion } from '../lib/store.js';
import { norm, barColors } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Crest, CountUp, Icon, ease } from '../components/ui.jsx';
import { MatchRow } from '../components/match.jsx';

/* ---------- Busca ---------- */
export function Search() {
  const q = decodeURIComponent(useParams().q || '');
  const ready = useQuery({ queryKey: ['search-index'], queryFn: () => buildIndex().then(() => true), staleTime: 300_000 });
  if (!ready.data) return <Skel h={400} />;
  const { teams, players } = searchAll(q);
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>{q ? `“${q}”` : 'Times'}</motion.h1>
      <div className="grid-2">
        <Panel><Head sub={`${teams.length}`}>Times</Head>
          {teams.length ? <Stagger className="list">{teams.slice(0, 80).map((t) => <Item key={t.time_id}><Link className="li" to={`/time/${t.time_id}`}><Crest t={t} size={28} /><b style={{ flex: 1 }}>{t.nome_popular}</b><small className="muted">{t.sigla}</small></Link></Item>)}</Stagger> : <Empty>Nenhum time encontrado.</Empty>}</Panel>
        {q && <Panel><Head sub={`${players.length}`}>Jogadores</Head>
          {players.length ? <Stagger className="list">{players.map((p) => <Item key={p.atleta_id}><Link className="li" to={`/jogador/${p.atleta_id}`}>{p.time && <Crest t={p.time} size={24} />}<span><b>{p.nome_popular}</b><small className="muted" style={{ display: 'block' }}>{p.time ? p.time.nome_popular : ''}</small></span></Link></Item>)}</Stagger> : <Empty>Nenhum jogador encontrado.</Empty>}</Panel>}
      </div>
    </>
  );
}

// sugestões enquanto digita (cabeçalho)
export function useSuggest(q) {
  const [ready, setReady] = useState(false);
  useEffect(() => { if (q.length >= 2 && !ready) buildIndex().then(() => setReady(true)); }, [q, ready]);
  if (q.length < 2 || !ready) return null;
  const { teams, players } = searchAll(q, 6);
  return [...teams.slice(0, 5).map((t) => ({ k: `t${t.time_id}`, to: `/time/${t.time_id}`, t, label: t.nome_popular, kind: 'Time' })),
    ...players.map((p) => ({ k: `p${p.atleta_id}`, to: `/jogador/${p.atleta_id}`, t: p.time, label: p.nome_popular, kind: 'Jogador' }))];
}

/* ---------- Favoritos ---------- */
export function Favorites() {
  useStoreVersion();
  const live = useLive();
  const favs = Object.values(getFavs());
  const ids = new Set(favs.map((f) => +f.time_id));
  const lm = live.filter((p) => ids.has(+p.time_mandante.time_id) || ids.has(+p.time_visitante.time_id));
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>Favoritos</motion.h1>
      {lm.length > 0 && <Panel><Head>Jogando agora</Head><Stagger>{lm.map((p) => <MatchRow key={p.partida_id} p={p} />)}</Stagger></Panel>}
      {favs.length ? (
        <Stagger className="fav-grid">
          {favs.map((t) => (
            <Item key={t.time_id} className="fav-card" layout>
              <Link to={`/time/${t.time_id}`}><Crest t={t} size={64} /><b>{t.nome_popular}</b></Link>
              <button className="btn" onClick={() => toggleFav(t)}>{Icon.star} Deixar de seguir</button>
            </Item>
          ))}
        </Stagger>
      ) : <Panel><Empty>Você ainda não segue nenhum time. Abra a página de um time e toque em Seguir.</Empty></Panel>}
    </>
  );
}

/* ---------- Sobre ---------- */
export function About() {
  const src = [
    ['API Futebol', 'https://www.api-futebol.com.br', 'Dados oficiais dos campeonatos do plano contratado e notícias.'],
    ['football-data.org', 'https://www.football-data.org', 'Champions League e principais ligas europeias.'],
    ['ESPN', 'https://www.espn.com.br', 'Placar ao vivo, escalações, estatísticas, NBA e notícias (fonte pública, não oficial).'],
    ['Jolpica (Ergast)', 'https://jolpi.ca', 'Calendário, resultados e classificação da Fórmula 1.'],
    ['Transfermarkt', 'https://www.transfermarkt.com.br', 'Valor de mercado, transferências, elencos e títulos.'],
  ];
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>Sobre o Placar</motion.h1>
      <p className="lead-p">Placares ao vivo, tabelas, escalações, estatísticas e onde assistir: futebol brasileiro e europeu, NBA e Fórmula 1.</p>
      <div className="grid-main">
        <div className="col">
          <Panel><Head>Fontes dos dados</Head><Stagger className="list">{src.map(([n, u, d]) => <Item key={n} as="a" className="li" href={u} target="_blank" rel="noopener noreferrer"><span style={{ flex: 1 }}><b>{n}</b><small className="muted" style={{ display: 'block' }}>{d}</small></span>{Icon.right}</Item>)}</Stagger></Panel>
          <Panel><Head>Aviso</Head><p className="pad muted">O Placar não é afiliado a clubes, ligas, federações, emissoras ou às fontes acima. Marcas, logos, escudos e imagens pertencem aos seus donos e aparecem só para identificar cada competição, time e canal. Os dados podem ter atraso ou conter erros; confira sempre as fontes oficiais.</p></Panel>
          <Panel><Head>Privacidade</Head><p className="pad muted">O Placar não usa cookies de rastreamento. Times favoritos, palpites, recordes dos minijogos e preferências ficam neste navegador e, se você criar uma conta, também na sua conta. As notícias abrem o site do portal de origem.</p></Panel>
        </div>
      </div>
    </>
  );
}

/* ---------- Comparar jogadores ---------- */
function PlayerPicker({ pool, slot, value, onPick }) {
  const [q, setQ] = useState('');
  const hits = q.length >= 2 ? pool.filter((p) => norm(p.nome).includes(norm(q))).slice(0, 8) : [];
  return (
    <div className="cmp-slot">
      {value ? <Link to={`/jogador/${value.id}`} className="cmp-who">{value.time && <Crest t={value.time} size={48} />}<span><b>{value.nome}</b><small>{value.time ? value.time.nome_popular : ''}</small></span></Link>
        : <div className="cmp-who empty"><b>Escolha um jogador</b></div>}
      <div className="pick">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={value ? 'Trocar jogador…' : 'Buscar jogador…'} aria-label={`Jogador ${slot + 1}`} />
        {hits.length > 0 && <div className="sugg">{hits.map((p) => <button key={p.id} onClick={() => { setQ(''); onPick(p.id); }}><Crest t={p.time} size={20} /><span>{p.nome}</span><small>{p.time.nome_popular}</small></button>)}</div>}
      </div>
    </div>
  );
}
export function Compare() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { data: pool } = useApi('/minijogos/craques', { ttl: 600_000 });
  const { data: comps } = useComps();
  const ids = [params.get('a'), params.get('b')].map((x) => (x ? +x : null));
  const picked = useQuery({
    queryKey: ['cmp-picked', ...ids], enabled: !!pool, staleTime: 600_000,
    queryFn: () => Promise.all(ids.map(async (id) => {
      if (!id) return null;
      const p = pool.find((x) => x.id === id);
      if (p) return p;
      const r = registry.players.get(id);
      if (r) return { id, nome: r.nome_popular, time: r.time };
      const a = await soft(fetchCached(`/atletas/${id}`, 3_600_000));
      return a ? { id, nome: a.nome_popular, time: a.time, idade: a.idade, nacionalidade: a.nacionalidade, posicao: a.posicao && a.posicao.nome } : { id, nome: `Jogador ${id}` };
    })),
  });
  const both = picked.data && picked.data[0] && picked.data[1];
  const stats = useQuery({
    queryKey: ['cmp-stats', ...ids], enabled: !!(both && comps), staleTime: 600_000,
    queryFn: async () => {
      const P = picked.data;
      const [goals, assists, tm] = await Promise.all([
        Promise.all(comps.map((c) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/artilharia`, 300_000)))),
        Promise.all(comps.map((c) => soft(fetchCached(`/campeonatos/${c.campeonato_id}/assistencias`, 300_000)))),
        Promise.all(P.map((p) => soft(fetchCached(`/jogador-tm?${new URLSearchParams({ nome: p.nome, clube: (p.time && p.time.nome_popular) || '', idade: p.idade || '' })}`, 3_600_000))))]);
      const season = (p) => { let g = 0, a = 0, j = 0; comps.forEach((c, i) => { const sg = (goals[i] || []).find((s) => +s.atleta.atleta_id === +p.id); const sa = (assists[i] || []).find((s) => +s.atleta.atleta_id === +p.id); if (sg) { g += sg.gols; j = Math.max(j, sg.jogos || 0); } if (sa) { a += sa.assistencias; j = Math.max(j, sa.jogos || 0); } }); return { g, a, j }; };
      return { S: P.map(season), tm };
    },
  });
  const pick = (slot, id) => { const next = [...ids]; next[slot] = id; const q = new URLSearchParams(); if (next[0]) q.set('a', next[0]); if (next[1]) q.set('b', next[1]); navigate(`/comparar?${q}`, { replace: true }); };
  if (!pool) return <Skel h={420} />;
  const P = picked.data || [null, null];
  const [ch, ca] = both ? barColors(P[0].time, P[1].time) : ['#888', '#888'];
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>Comparar jogadores</motion.h1>
      <Panel className="cmp-pick" style={{ '--ch': ch, '--ca': ca }}>
        <PlayerPicker pool={pool} slot={0} value={P[0]} onPick={(id) => pick(0, id)} />
        <span className="cmp-vs">VS</span>
        <PlayerPicker pool={pool} slot={1} value={P[1]} onPick={(id) => pick(1, id)} />
      </Panel>
      {!both ? <Panel><Empty>Escolha dois jogadores para comparar.</Empty></Panel> : !stats.data ? <Skel h={400} /> : (() => {
        const { S, tm } = stats.data;
        const mv = tm.map((t) => (t && t.mercado ? mvNumber(t.mercado.atual) : 0));
        const titles = tm.map((t) => (t && t.titulos_detalhes ? t.titulos_detalhes.reduce((x, y) => x + y.quantidade, 0) : 0));
        const fmtMv = (v) => (v >= 1e6 ? `€ ${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1).replace('.', ',')} mi` : v ? `€ ${Math.round(v / 1e3)} mil` : '–');
        const row = (label, a, b, fmt = (x) => x) => {
          const na = +a || 0, nb = +b || 0, tot = na + nb || 1;
          return (
            <div key={label} className="st"><div className="st-top"><b className={na > nb ? 'lead' : ''}>{fmt(a)}</b><span>{label}</span><b className={nb > na ? 'lead' : ''}>{fmt(b)}</b></div>
              <div className="st-bars"><span><motion.i className={`h ${na > nb ? 'lead' : ''}`} initial={{ width: 0 }} animate={{ width: `${(na / tot) * 100}%` }} transition={{ duration: 0.9, ease }} /></span><span><motion.i className={`a ${nb > na ? 'lead' : ''}`} initial={{ width: 0 }} animate={{ width: `${(nb / tot) * 100}%` }} transition={{ duration: 0.9, ease }} /></span></div></div>
          );
        };
        const info = (t, p) => [['Posição', (t && t.posicao) || p.posicao], ['Idade', (t && t.idade) || p.idade], ['Nacionalidade', (t && (t.nacionalidades || []).map((n) => n.nome).join(', ')) || p.nacionalidade], ['Altura', t && t.altura], ['Pé', t && t.pe], ['Clube', t && t.clube && t.clube.nome], ['Contrato até', t && t.contrato_ate]];
        const ia = info(tm[0], P[0]), ib = info(tm[1], P[1]);
        return (
          <div className="grid-main">
            <div className="col">
              <Panel className="cmp-faces">{P.map((p, i) => <motion.div key={i} initial={{ opacity: 0, x: i ? 40 : -40 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.6, ease }}>{tm[i] && tm[i].foto ? <img src={tm[i].foto} alt="" /> : <span className="cmp-av">{(p.nome || '?').split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>}<b>{p.nome}</b></motion.div>)}</Panel>
              <Panel><Head>Temporada</Head><div className="stats" style={{ '--ch': ch, '--ca': ca }}>
                {row('Gols', S[0].g, S[1].g)}{row('Assistências', S[0].a, S[1].a)}{row('Participações em gol', S[0].g + S[0].a, S[1].g + S[1].a)}{row('Jogos', S[0].j, S[1].j)}</div></Panel>
              <Panel><Head>Carreira</Head><div className="stats" style={{ '--ch': ch, '--ca': ca }}>{row('Valor de mercado', mv[0], mv[1], fmtMv)}{row('Títulos', titles[0], titles[1])}</div></Panel>
            </div>
            <aside className="col side"><Panel><Head>Ficha</Head>{ia.map(([k, v], i) => <div key={k} className="pg"><b>{v ?? '–'}</b><span>{k}</span><b>{ib[i][1] ?? '–'}</b></div>)}</Panel>
              <p className="foot">Temporada: artilharia e assistências dos campeonatos acompanhados. Carreira: Transfermarkt.</p></aside>
          </div>
        );
      })()}
    </>
  );
}
export { CountUp };
