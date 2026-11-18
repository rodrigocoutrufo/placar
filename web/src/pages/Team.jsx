import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence, useScroll, useTransform } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useApi, fetchCached, soft } from '../lib/api.js';
import { useComps, compOf } from '../lib/data.js';
import { Taste, isFav, toggleFav, useStoreVersion } from '../lib/store.js';
import { flattenTable, isLeague, isLive, parseDate, fmtTime, liveLabel, kitColor, luminance, norm, faseMatches, timeAgo } from '../lib/format.js';
import { mvNumber, regTeam } from '../lib/registry.js';
import { Panel, Head, Skel, Empty, ErrorBox, Tabs, Stagger, Item, Crest, CompLogo, CountUp, LiveDot, Icon, ease } from '../components/ui.jsx';
import { StadiumPanel } from '../components/Stadium.jsx';
import { MatchRow, Standings, RankList } from '../components/match.jsx';

const CAT_ORDER = ['Mundial', 'Continental', 'Liga nacional', 'Copa nacional', 'Estadual', 'Outros'];
export const teamTMPath = (team) => `/time-tm?${new URLSearchParams({ nome: team.nome_popular || '', nome_completo: team.nome || '', pais: team.pais || '' })}`;

// cores do clube para o cabeçalho (cor escura demais vira a secundária; nunca preto puro)
export function clubColors(t) {
  let c1 = kitColor(t);
  let c2 = t && t.cor_secundaria ? t.cor_secundaria : '#0b0c0e';
  if (luminance(c1) > 0.85) [c1, c2] = [c2 && luminance(c2) < 0.85 ? c2 : '#1d2430', c1];
  if (luminance(c1) < 0.08) c1 = '#1d2430';
  return [c1, c2];
}

export default function Team() {
  const { id: sid, tab = 'visao' } = useParams();
  const [params] = useSearchParams();
  const id = +sid;
  useStoreVersion();
  const { data: comps } = useComps();
  const info = useApi(`/times/${id}`, { ttl: 3_600_000 });
  const tc = useApi(`/times/${id}/campeonatos`, { ttl: 3_600_000 });
  const ready = comps && !info.isLoading && !tc.isLoading;
  const myComps = tc.data && +tc.data.time.time_id === id ? tc.data.campeonatos.map((c) => +c.campeonato_id).filter((cid) => (comps || []).some((c) => c.campeonato_id === cid)) : [];
  const leagueComp = comps && (comps.find((c) => myComps.includes(c.campeonato_id) && c.tipo === 'Pontos Corridos')
    || comps.find((c) => myComps.includes(c.campeonato_id) && isLeague(c)) || comps.find((c) => c.campeonato_id === +params.get('c')) || comps.find(isLeague));
  const table = useApi(leagueComp ? `/campeonatos/${leagueComp.campeonato_id}/tabela` : '', { ttl: 60_000, enabled: !!leagueComp });
  let row = null;
  flattenTable(table.data || []).forEach((g) => g.rows.forEach((r) => { regTeam(r.time); if (+r.time.time_id === id) row = r; }));
  const detail = info.data && +info.data.time_id === id ? info.data : null;
  const team = { ...(row ? row.time : {}), ...(tc.data && +tc.data.time.time_id === id ? tc.data.time : {}), ...(detail || {}) };
  useEffect(() => { if (team.nome_popular && tab === 'visao') Taste.bump('t', id, 3, { n: team.nome_popular, e: team.escudo || null }); }, [team.nome_popular]); // eslint-disable-line react-hooks/exhaustive-deps
  const { scrollY } = useScroll();
  const wmY = useTransform(scrollY, [0, 400], [0, 80]);

  if (info.error && tc.error) return <ErrorBox error={info.error} retry={info.refetch} />;
  if (!ready || (leagueComp && table.isLoading)) return <><Skel h={300} /><Skel h={420} /></>;
  if (!team.nome_popular) return <Panel><Empty>Time não encontrado.</Empty></Panel>;
  const fav = isFav(team);
  const [c1, c2] = clubColors(team);
  const base = `/time/${id}`;
  const facts = [team.estadio, team.fundacao && `Fundado em ${team.fundacao}`, team.tecnico && team.tecnico.nome && `Técnico: ${team.tecnico.nome}`].filter(Boolean);
  return (
    <>
      <section className="club-hero" style={{ '--c1': c1, '--c2': c2 }}>
        <span className="ch-stripes" />
        <motion.div className="ch-wm" style={{ y: wmY }}><Crest t={team} size={420} /></motion.div>
        <div className="ch-in">
          <motion.div className="ch-crest" initial={{ opacity: 0, scale: 0.5, rotate: -12 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}>
            <Crest t={team} size={150} />
          </motion.div>
          <div className="ch-txt">
            {row && leagueComp && (
              <motion.small initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.15 }}>
                <CompLogo c={leagueComp} size={18} dark /> {row.posicao}º no {leagueComp.nome_popular} · {row.pontos} pontos
              </motion.small>
            )}
            <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15, duration: 0.6, ease }}>{team.nome_popular}</motion.h1>
            {facts.length > 0 && <div className="to-meta">{facts.map((f) => <span key={f}>{f}</span>)}</div>}
            <motion.button className={`follow ${fav ? 'on' : ''}`} onClick={() => toggleFav(team)} whileTap={{ scale: 0.92 }}>
              <motion.span key={String(fav)} initial={{ scale: 0.4, rotate: -90 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 400, damping: 15 }}>{Icon.star}</motion.span>
              {fav ? 'Seguindo' : 'Seguir'}
            </motion.button>
          </div>
        </div>
      </section>
      <div className="sticky-tabs"><Tabs id="team" active={tab} items={[['visao', 'Visão geral', base], ['jogos', 'Jogos', `${base}/jogos`], ['elenco', 'Elenco', `${base}/elenco`], ['titulos', 'Títulos', `${base}/titulos`], ['clube', 'Clube', `${base}/clube`]]} /></div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
          {tab === 'elenco' ? <Squad id={id} team={team} />
            : tab === 'titulos' ? <Titles team={team} />
              : tab === 'clube' ? <Club id={id} team={team} />
                : <Overview id={id} team={team} tab={tab} comps={comps} myComps={myComps} leagueComp={leagueComp} row={row} rows={flattenTable(table.data || [])[0]} />}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

// jogos do time: rotas da API (próximas/anteriores/ao vivo) ou, como reserva, as fases dos campeonatos
function useTeamGames(id, comps, myComps, leagueComp) {
  return useQuery({
    queryKey: ['team-games', id], staleTime: 120_000,
    queryFn: async () => {
      const [nextG, prevG, liveT] = await Promise.all([
        soft(fetchCached(`/times/${id}/partidas/proximas`, 600_000)), soft(fetchCached(`/times/${id}/partidas/anteriores`, 600_000)), soft(fetchCached(`/times/${id}/partidas/ao-vivo`, 30_000))]);
      const flat = (g) => Object.values(g || {}).flat();
      if (nextG || prevG) {
        const liveIds = new Set((liveT || []).map((p) => p.partida_id));
        const upcoming = [...(liveT || []), ...flat(nextG).filter((p) => !liveIds.has(p.partida_id))].sort((a, b) => (isLive(b) - isLive(a)) || ((parseDate(a) || 9e15) - (parseDate(b) || 9e15)));
        const played = flat(prevG).filter((p) => p.status === 'finalizado').sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0));
        return { upcoming, played };
      }
      const cids = myComps.length ? myComps : leagueComp ? [leagueComp.campeonato_id] : [];
      const lists = await Promise.all(cids.map(async (cid) => {
        const c = await soft(fetchCached(`/campeonatos/${cid}`, 600_000));
        if (!c) return [];
        const fases = isLeague(c) ? [c.fase_atual].filter(Boolean) : (c.fases || []);
        const fs = await Promise.all(fases.map((f) => soft(fetchCached(`/campeonatos/${cid}/fases/${f.fase_id}`, 120_000))));
        return fs.filter(Boolean).flatMap(faseMatches);
      }));
      const seen = new Set();
      const all = lists.flat().filter((p) => (+p.time_mandante.time_id === id || +p.time_visitante.time_id === id) && !seen.has(p.partida_id) && seen.add(p.partida_id))
        .sort((a, b) => (parseDate(a) || 0) - (parseDate(b) || 0));
      return { played: all.filter((p) => p.status === 'finalizado'), upcoming: all.filter((p) => !['finalizado', 'cancelado'].includes(p.status)) };
    },
  });
}

function Overview({ id, team, tab, comps, myComps, leagueComp, row, rows }) {
  const games = useTeamGames(id, comps, myComps, leagueComp);
  const sc = useApi(leagueComp ? `/campeonatos/${leagueComp.campeonato_id}/artilharia` : '', { ttl: 300_000, enabled: !!leagueComp });
  const news = useApi(`/noticias?por_pagina=6&time_id=${id}`, { ttl: 600_000 });
  const tm = useApi(teamTMPath(team), { ttl: 6 * 3_600_000 });
  if (!games.data) return <Skel h={420} />;
  const { upcoming, played } = games.data;
  if (tab === 'jogos') {
    return (
      <div className="grid-2">
        <Panel><Head sub={`${upcoming.length}`}>Próximos jogos</Head>{upcoming.length ? <Stagger>{upcoming.map((p) => <MatchRow key={p.partida_id} p={p} showDate comp={compOf(comps, p)} />)}</Stagger> : <Empty>Nenhum jogo agendado.</Empty>}</Panel>
        <Panel><Head sub={`${played.length}`}>Resultados</Head>{played.length ? <Stagger>{[...played].reverse().map((p) => <MatchRow key={p.partida_id} p={p} showDate comp={compOf(comps, p)} />)}</Stagger> : <Empty>Nenhum jogo disputado.</Empty>}</Panel>
      </div>
    );
  }
  const next = upcoming.find(isLive) || upcoming[0];
  const last5 = played.slice(-5);
  const mine = (sc.data || []).filter((s) => s.time && +s.time.time_id === id);
  const titles = ((tm.data && tm.data.titulos) || []).filter((t) => ['Mundial', 'Continental', 'Liga nacional', 'Copa nacional'].includes(t.categoria)).slice(0, 5);
  const res = (p) => { const home = +p.time_mandante.time_id === id; const [g, c] = home ? [p.placar_mandante, p.placar_visitante] : [p.placar_visitante, p.placar_mandante]; return g > c ? 'v' : g < c ? 'd' : 'e'; };
  const nd = next && parseDate(next);
  return (
    <div className="grid-main">
      <div className="col">
        {next && (
          <Panel>
            <Head sub={compOf(comps, next).nome_popular}>{isLive(next) ? <><LiveDot /> Jogando agora</> : 'Próximo jogo'}</Head>
            <Link to={`/partida/${next.partida_id}`} className="next-up">
              <span className="nu-t"><Crest t={next.time_mandante} size={60} /><b>{next.time_mandante.nome_popular}</b></span>
              <span className="nu-c">{isLive(next) ? <><em className="live">{next.placar_mandante ?? 0} – {next.placar_visitante ?? 0}</em><small>{liveLabel(next)}</small></>
                : <><em>{fmtTime(next)}</em><small>{nd ? nd.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' }) : ''}</small>{next.estadio && <small>{next.estadio.nome_popular}</small>}</>}</span>
              <span className="nu-t"><Crest t={next.time_visitante} size={60} /><b>{next.time_visitante.nome_popular}</b></span>
            </Link>
          </Panel>
        )}
        {last5.length > 0 && (
          <Panel>
            <Head right={<Link className="phead-more" to={`/time/${id}/jogos`}>Todos os jogos</Link>}>Últimos resultados</Head>
            <Stagger className="form-strip">
              {last5.map((p) => { const r = res(p); const opp = +p.time_mandante.time_id === id ? p.time_visitante : p.time_mandante; return (
                <Item key={p.partida_id}><Link to={`/partida/${p.partida_id}`} className={`fs-card ${r}`}><Crest t={opp} size={34} /><b>{{ v: 'V', e: 'E', d: 'D' }[r]}</b><small>{p.placar_mandante}–{p.placar_visitante}</small></Link></Item>
              ); })}
            </Stagger>
          </Panel>
        )}
        {row && (
          <Panel>
            <Head>Desempenho no {leagueComp.nome_popular}</Head>
            <div className="kpi-grid">
              {[['Pontos', row.pontos], ['Jogos', row.jogos], ['Vitórias', row.vitorias], ['Empates', row.empates], ['Derrotas', row.derrotas], ['Gols pró', row.gols_pro], ['Gols contra', row.gols_contra], ['Aproveitamento', row.aproveitamento, '%']].map(([l, v, u]) => (
                <div key={l}><b><CountUp value={v} />{u}</b><span>{l}</span></div>
              ))}
            </div>
          </Panel>
        )}
        {mine.length > 0 && <Panel><Head>Artilheiros do time</Head><RankList list={mine.slice(0, 6)} k="gols" unit=" gols" /></Panel>}
      </div>
      <aside className="col side">
        {titles.length > 0 && (
          <Panel><Head right={<Link className="phead-more" to={`/time/${id}/titulos`}>Todos</Link>}>Sala de troféus</Head>
            <Stagger className="list">{titles.map((t) => <Item key={t.titulo} className="li">{t.imagem && <img src={t.imagem} alt="" width="30" height="30" style={{ objectFit: 'contain' }} />}<b style={{ flex: 1 }}>{t.titulo}</b><span className="trophy-x">{t.quantidade}×</span></Item>)}</Stagger></Panel>
        )}
        {tm.data && tm.data.valor_mercado && (
          <Link to={`/time/${id}/clube`} className="panel club-mini">
            <div><small>Valor do elenco</small><b>{tm.data.valor_mercado}</b></div><div><small>Idade média</small><b>{tm.data.idade_media || '–'}</b></div><div><small>Estádio</small><b>{tm.data.capacidade || '–'}</b></div>
          </Link>
        )}
        {rows && leagueComp && <Panel><Head to={`/campeonato/${leagueComp.campeonato_id}/tabela`}><CompLogo c={leagueComp} size={20} /> {leagueComp.nome_popular}</Head><Standings rows={rows.rows} campId={leagueComp.campeonato_id} compact highlight={[id]} /></Panel>}
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
  );
}

function Squad({ id, team }) {
  const tm = useApi(teamTMPath(team), { ttl: 6 * 3_600_000 });
  const ours = useApi(`/times/${id}/elenco`, { ttl: 3_600_000 });
  if (tm.isLoading || ours.isLoading) return <Skel h={500} />;
  const list = Array.isArray(ours.data) ? ours.data : [];
  const byName = new Map(list.map((x) => [norm(x.atleta.nome_popular), x.atleta.atleta_id]));
  const findOurs = (name) => {
    const n = norm(name);
    if (byName.has(n)) return byName.get(n);
    const last = n.split(' ').pop();
    const hit = [...byName.keys()].find((k) => k === last || (k.endsWith(` ${last}`) && k.split(' ')[0] === n.split(' ')[0]));
    return hit ? byName.get(hit) : null;
  };
  const d = tm.data;
  if (d && (d.elenco || []).length) {
    const groupOf = (p) => { const s = norm(p.posicao); if (s.includes('goleiro')) return 'Goleiros'; if (/zagueiro|lateral|defens/.test(s)) return 'Defensores'; if (/volante|meia|meio/.test(s)) return 'Meio-campistas'; return 'Atacantes'; };
    return (
      <div className="col">
        <Panel><div className="kpi-grid">{[['Jogadores', d.plantel || d.elenco.length], ['Idade média', d.idade_media], ['Estrangeiros', d.estrangeiros], ['Valor do elenco', d.valor_mercado]].filter(([, v]) => v).map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div></Panel>
        {['Goleiros', 'Defensores', 'Meio-campistas', 'Atacantes'].map((g) => {
          const l = d.elenco.filter((p) => groupOf(p) === g);
          if (!l.length) return null;
          return (
            <section key={g}>
              <h2 className="sec-h">{g}</h2>
              <Stagger className="squad-grid">
                {l.map((p) => {
                  const our = findOurs(p.nome);
                  const inner = (
                    <>
                      <span className="sq-photo">{p.foto ? <img src={p.foto} alt="" loading="lazy" /> : null}<em>{p.camisa}</em></span>
                      <b>{p.nome}</b>
                      <small>{p.posicao}{p.idade ? ` · ${p.idade} anos` : ''}</small>
                      <span className="sq-meta">{(p.nacionalidades || []).slice(0, 2).map((n) => <img key={n.nome} className="flag" src={n.bandeira} alt={n.nome} title={n.nome} width="18" />)}<strong>{p.valor_mercado && p.valor_mercado !== '-' ? p.valor_mercado : ''}</strong></span>
                    </>
                  );
                  return <Item key={p.nome}>{our ? <Link className="sq-card" to={`/jogador/${our}`}>{inner}</Link> : <div className="sq-card">{inner}</div>}</Item>;
                })}
              </Stagger>
            </section>
          );
        })}
        <p className="foot">Dados do elenco e valores: <a href={d.url} target="_blank" rel="noopener noreferrer">Transfermarkt</a>.</p>
      </div>
    );
  }
  if (!list.length) return <Panel><Empty>Elenco indisponível para este time.</Empty></Panel>;
  return <Panel><Stagger className="list">{list.map((x) => <Item key={x.atleta.atleta_id}><Link className="li" to={`/jogador/${x.atleta.atleta_id}`}><span className="jersey">{x.camisa}</span><b style={{ flex: 1 }}>{x.atleta.nome_popular}</b><small className="muted">{(x.posicao && x.posicao.nome) || ''}</small></Link></Item>)}</Stagger></Panel>;
}

export function TrophyCard({ t, children }) {
  const seasons = t.temporadas || [];
  return (
    <Item className="trophy">
      <span className="tr-img">{t.imagem && <img src={t.imagem} alt="" loading="lazy" />}</span>
      <div className="tr-body">
        <b className="tr-n"><CountUp value={t.quantidade} />×</b>
        <span className="tr-name">{t.titulo}</span>
        {seasons.length > 0 && <span className="tr-seasons">{seasons.slice(0, 12).map((s) => <i key={s}>{s}</i>)}{seasons.length > 12 && <i>+{seasons.length - 12}</i>}</span>}
        {children}
      </div>
    </Item>
  );
}

function Titles({ team }) {
  const tm = useApi(teamTMPath(team), { ttl: 6 * 3_600_000 });
  if (tm.isLoading) return <Skel h={500} />;
  const list = (tm.data && tm.data.titulos) || [];
  if (!list.length) return <Panel><Empty>Nenhum título encontrado para este clube.</Empty></Panel>;
  const total = list.reduce((a, t) => a + t.quantidade, 0);
  const label = { Mundial: 'Mundiais', Continental: 'Continentais', 'Liga nacional': 'Ligas nacionais', 'Copa nacional': 'Copas nacionais', Estadual: 'Estaduais' };
  return (
    <div className="col">
      <Panel><div className="kpi-grid">{CAT_ORDER.slice(0, 5).map((cat) => <div key={cat}><b><CountUp value={list.filter((t) => t.categoria === cat).reduce((a, t) => a + t.quantidade, 0)} /></b><span>{label[cat]}</span></div>)}<div><b><CountUp value={total} /></b><span>Total</span></div></div></Panel>
      {CAT_ORDER.map((cat) => {
        const l = list.filter((t) => (t.categoria || 'Outros') === cat);
        if (!l.length) return null;
        return <section key={cat}><h2 className="sec-h">{cat} · {l.reduce((a, t) => a + t.quantidade, 0)}</h2><Stagger className="trophies">{l.map((t) => <TrophyCard key={t.titulo} t={t} />)}</Stagger></section>;
      })}
      <p className="foot">Títulos: <a href={tm.data.url} target="_blank" rel="noopener noreferrer">Transfermarkt</a>.</p>
    </div>
  );
}

function Club({ id, team }) {
  const tm = useApi(teamTMPath(team), { ttl: 6 * 3_600_000 });
  if (tm.isLoading) return <Skel h={500} />;
  const d = tm.data;
  if (!d) return <Panel><Empty>Perfil do clube indisponível no momento.</Empty></Panel>;
  const kpis = [['Valor de mercado do elenco', d.valor_mercado], ['Jogadores no elenco', d.plantel], ['Idade média', d.idade_media && `${d.idade_media} anos`],
    ['Estrangeiros', d.estrangeiros && `${d.estrangeiros}${d.estrangeiros_pct ? ` (${d.estrangeiros_pct})` : ''}`], ['Jogadores de seleção', d.selecao], ['Saldo de transferências', d.balanco_transferencias]].filter(([, v]) => v);
  const ficha = [['Nome', team.nome || d.nome], ['País', d.pais], ['Fundação', team.fundacao], ['Cores', team.cores], ['Técnico', team.tecnico && team.tecnico.nome]].filter(([, v]) => v);
  const top = [...(d.elenco || [])].sort((a, b) => mvNumber(b.valor_mercado) - mvNumber(a.valor_mercado)).slice(0, 5);
  return (
    <div className="grid-main">
      <div className="col">
        <Panel><Head>Elenco em números</Head><div className="kpi-grid big">{kpis.map(([k, v]) => <div key={k}><b>{v}</b><span>{k}</span></div>)}</div></Panel>
        {d.estadio && <StadiumPanel name={d.estadio} capacity={d.capacidade && `Capacidade: ${d.capacidade}`} team={team} />}
        {top.length > 0 && (
          <Panel><Head right={<Link className="phead-more" to={`/time/${id}/elenco`}>Elenco completo</Link>}>Mais valiosos</Head>
            <Stagger>{top.map((p, i) => <Item key={p.nome} className="rank-row"><span className="n">{i + 1}</span>{p.foto ? <img className="face" src={p.foto} alt="" /> : <span />}<span className="who"><b>{p.nome}</b><small>{p.posicao}{p.idade ? ` · ${p.idade} anos` : ''}</small></span><span /><span className="v" style={{ fontSize: 17 }}>{p.valor_mercado}</span></Item>)}</Stagger></Panel>
        )}
      </div>
      <aside className="col side">
        {ficha.length > 0 && <Panel><Head>Ficha do clube</Head><dl className="facts">{ficha.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}{team.site && <div><dt>Site oficial</dt><dd><a href={team.site} target="_blank" rel="noopener noreferrer">{team.site.replace(/^https?:\/\/(www\.)?/, '')}</a></dd></div>}</dl></Panel>}
        <p className="foot">Dados do clube: <a href={d.url} target="_blank" rel="noopener noreferrer">Transfermarkt</a>.</p>
      </aside>
    </div>
  );
}
