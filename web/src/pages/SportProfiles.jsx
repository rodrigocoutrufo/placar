import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { Taste } from '../lib/store.js';
import { LOGO } from '../lib/themes.js';
import { fmtDT, hexA } from '../lib/format.js';
import { Bell } from '../components/Notify.jsx';
import { followsNbaTeam, toggleNbaTeam, followsF1Driver, toggleF1Driver, followsF1Team, toggleF1Team } from '../lib/notify.js';
import { Panel, Head, Skel, Empty, Tabs, Stagger, Item, CountUp, Reveal, ease } from '../components/ui.jsx';

const flag = (src, w = 22) => (src ? <img className="flag" src={src} alt="" width={w} /> : null);

// cabeçalho de perfil nas cores do time/equipe
function ProfileHero({ color, kind, photo, logo, eyebrow, title, sub, num, kpis, action = null }) {
  return (
    <section className={`club-hero sport ${kind}`} style={{ '--c1': color || '#1d2430', '--c2': '#07080a' }}>
      <span className="ch-stripes" />
      {num && <motion.span className="pl-num" initial={{ opacity: 0, x: 60 }} animate={{ opacity: 0.16, x: 0 }} transition={{ duration: 0.8, ease }}>{num}</motion.span>}
      <div className="ch-in">
        {photo !== undefined ? (
          <motion.div className={`pl-photo ${kind === 'f1-team' ? 'wide' : ''}`} initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
            {photo ? <img src={photo} alt="" referrerPolicy="no-referrer" /> : null}
          </motion.div>
        ) : (
          <motion.div className="ch-crest" initial={{ opacity: 0, scale: 0.5, rotate: -12 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 15 }}>
            <img src={logo} alt="" width="150" height="150" style={{ objectFit: 'contain' }} />
          </motion.div>
        )}
        <div className="ch-txt">
          <small>{eyebrow}</small>
          <motion.h1 initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1, duration: 0.6, ease }}>{title}</motion.h1>
          {sub && <div className="to-meta"><span>{sub}</span></div>}
          {action}
        </div>
      </div>
      {kpis && (
        <Stagger className="hero-kpis">
          {kpis.filter(Boolean).map(([v, l, s]) => <Item key={l}><b>{typeof v === 'number' ? <CountUp value={v} /> : v}</b><span>{l}</span>{s && <small>{s}</small>}</Item>)}
        </Stagger>
      )}
    </section>
  );
}

function LineChart({ points, color, height = 190, label }) {
  if (!points || points.length < 2) return null;
  const W = 640, H = height, P = 30;
  const max = Math.max(...points.map((p) => p.y), 1);
  const x = (i) => P + (i / (points.length - 1)) * (W - P * 2);
  const y = (v) => H - P - (v / max) * (H - P * 2);
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.y).toFixed(1)}`).join('');
  return (
    <svg className="mv-chart" viewBox={`0 0 ${W} ${H}`} aria-label={label} style={{ '--lc': color }}>
      {[0.25, 0.5, 0.75, 1].map((f) => <g key={f}><line x1={P} x2={W - P} y1={y(max * f)} y2={y(max * f)} className="g" /><text x={P - 6} y={y(max * f) + 4} textAnchor="end">{Math.round(max * f)}</text></g>)}
      <motion.path d={`${path}L${x(points.length - 1)},${H - P}L${x(0)},${H - P}Z`} className="a" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} />
      <motion.path d={path} className="l" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 1.4, ease }} />
      {points.map((p, i) => (i % Math.ceil(points.length / 12) === 0 ? <text key={i} x={x(i)} y={H - 8} textAnchor="middle">{p.x}</text> : null))}
    </svg>
  );
}

/* ================= NBA: time ================= */
export function NBATeam() {
  const id = +useParams().id;
  const [params, setParams] = useSearchParams();
  const tab = params.get('aba') || 'visao';
  const { data: t } = useApi(`/esportes/nba/time/${id}`, { ttl: 600_000, critical: true });
  useEffect(() => { if (t) { Taste.bump('n', id, 3, { n: t.curto || t.nome, e: t.logo }); Taste.bump('e', 'nba', 1); } }, [t]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return <Skel h={420} />;
  const c = t.campanha || {};
  const game = (g) => (
    <Item key={g.id}><Link className="tg" to={`/nba/jogo/${g.id}`}>
      <span className="tg-d">{fmtDT(g.data_iso, { day: '2-digit', month: 'short' })}</span><span className="tg-v">{g.casa ? 'vs' : '@'}</span>
      <span className="tg-t"><img src={g.adversario.logo} alt="" width="26" /><b>{g.adversario.nome}</b></span>
      {g.status === 'finalizado' ? <><span className={`tg-r ${g.vitoria ? 'w' : 'l'}`}>{g.vitoria ? 'V' : 'D'}</span><span className="tg-s">{g.placar}-{g.placar_adv}</span></> : <span className="tg-s muted">{fmtDT(g.data_iso, { hour: '2-digit', minute: '2-digit' })}</span>}
    </Link></Item>
  );
  const go = (k) => setParams(k === 'visao' ? {} : { aba: k }, { replace: true });
  return (
    <>
      <ProfileHero color={t.cor} logo={t.logo} eyebrow={<><img src={LOGO.nba} alt="" height="18" style={{ display: 'inline', verticalAlign: '-3px' }} /> {t.resumo}</>} title={t.nome} sub={[t.ginasio, t.local].filter(Boolean).join(' · ')}
        action={<Bell on={() => followsNbaTeam(id)} onClick={() => toggleNbaTeam({ id, nome: t.nome, logo: t.logo })} className="on-dark" />}
        kpis={[[`${c.v}-${c.d}`, 'Campanha', c.posicao ? `${c.posicao}º na conferência` : ''], [c.pontos_pro, 'Pontos por jogo'], [c.pontos_contra, 'Sofridos por jogo'], [`${c.saldo > 0 ? '+' : ''}${c.saldo}`, 'Saldo médio'], c.sequencia ? [c.sequencia, 'Sequência'] : null, t.casa_fora ? [t.casa_fora.casa, 'Em casa', `fora ${t.casa_fora.fora}`] : null]} />
      <div className="sticky-tabs"><nav className="tabs">{[['visao', 'Visão geral'], ['jogos', 'Jogos'], ['elenco', 'Elenco']].map(([k, l]) => <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => go(k)}>{l}{tab === k && <motion.span layoutId="tab-nbat" className="tab-ind" />}</button>)}</nav></div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          {tab === 'elenco' ? (
            <Panel><Head sub={`${t.elenco.length} jogadores${t.tecnico ? ` · técnico ${t.tecnico}` : ''}`}>Elenco</Head>
              <Stagger className="squad-grid pad">{t.elenco.map((p) => (
                <Item key={p.id}><Link className="sq-card" to={`/nba/jogador/${p.id}`}>
                  <span className="sq-photo">{p.foto && <img src={p.foto} alt="" loading="lazy" />}<em>{p.camisa}</em></span>
                  <b>{p.nome}</b><small>{p.posicao}{p.idade ? ` · ${p.idade} anos` : ''}</small>
                  <span className="sq-meta"><span>{[p.altura, p.peso].filter(Boolean).join(' · ')}</span>{p.lesao && <strong className="inj">{p.lesao === 'Out' ? 'Fora' : p.lesao}</strong>}</span>
                </Link></Item>))}</Stagger></Panel>
          ) : tab === 'jogos' ? (
            <div className="grid-2">
              <Panel><Head>Próximos jogos</Head>{t.proximos.length ? <Stagger>{t.proximos.map(game)}</Stagger> : <Empty>Sem jogos marcados.</Empty>}</Panel>
              <Panel><Head>Últimos resultados</Head>{t.ultimos.length ? <Stagger>{t.ultimos.map(game)}</Stagger> : <Empty>Ainda sem jogos.</Empty>}</Panel>
            </div>
          ) : (
            <div className="grid-main">
              <div className="col">
                {t.proximos[0] && <Panel><Head>Próximo jogo</Head><Stagger>{game(t.proximos[0])}</Stagger></Panel>}
                {t.estatisticas.length > 0 && <Panel><Head>Médias por jogo</Head><div className="kpi-grid">{t.estatisticas.map((s) => <div key={s.nome}><b>{s.valor}</b><span>{s.nome}</span>{s.rank && <small>{s.rank} na liga</small>}</div>)}</div></Panel>}
                <Panel><Head right={<button className="phead-more" onClick={() => go('jogos')}>Todos</button>}>Últimos resultados</Head>{t.ultimos.length ? <Stagger>{t.ultimos.slice(0, 5).map(game)}</Stagger> : <Empty>Ainda sem jogos.</Empty>}</Panel>
              </div>
              <aside className="col side">
                <Panel><Head right={<button className="phead-more" onClick={() => go('elenco')}>Elenco</button>}>Destaques do elenco</Head>
                  <Stagger className="list">{t.elenco.slice(0, 6).map((p) => <Item key={p.id}><Link className="li" to={`/nba/jogador/${p.id}`}>{p.foto && <img className="face" src={p.foto} alt="" />}<span style={{ flex: 1 }}><b>{p.nome}</b><small className="muted" style={{ display: 'block' }}>{p.posicao} · #{p.camisa}</small></span></Link></Item>)}</Stagger></Panel>
              </aside>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </>
  );
}

/* ================= NBA: jogador ================= */
export function NBAPlayer() {
  const id = +useParams().id;
  const { data: p } = useApi(`/esportes/nba/jogador/${id}`, { ttl: 600_000, critical: true });
  if (!p) return <Skel h={420} />;
  const t = p.time || {};
  const season = (p.medias || [])[0], career = (p.medias || [])[1];
  const val = (m, s) => ((m && m.stats.find((x) => x.sigla === s)) || {}).valor || '–';
  return (
    <>
      <ProfileHero kind="nba-p" color={t.cor} photo={p.foto} num={p.camisa} eyebrow={t.id ? <Link to={`/nba/time/${t.id}`}><img src={t.logo} alt="" height="20" style={{ display: 'inline', verticalAlign: '-4px' }} /> {t.nome}</Link> : 'NBA'}
        title={p.nome} sub={[p.posicao, p.idade ? `${p.idade} anos` : '', p.altura, p.peso].filter(Boolean).join(' · ')}
        kpis={season ? [[val(season, 'PTS'), 'Pontos', `carreira ${val(career, 'PTS')}`], [val(season, 'REB'), 'Rebotes', `carreira ${val(career, 'REB')}`], [val(season, 'AST'), 'Assistências', `carreira ${val(career, 'AST')}`], [val(season, 'FG%'), 'Arremessos %'], [val(season, '3P%'), 'Bolas de 3 %'], [val(season, 'MIN'), 'Minutos', `${val(season, 'GP')} jogos`]] : null} />
      <div className="grid-main">
        <div className="col">
          {(p.ultimos_jogos || []).length > 0 && (
            <Panel className="flush"><Head>Últimos jogos</Head><div className="tbl-wrap"><table className="tbl">
              <thead><tr><th className="l">Jogo</th><th>Res.</th><th>Pts</th><th>Reb</th><th>Ast</th><th className="hs">Min</th></tr></thead>
              <tbody>{p.ultimos_jogos.map((g) => <tr key={g.id}><td className="team l"><Link to={`/nba/jogo/${g.id}`}><span className="muted small">{fmtDT(g.data_iso, { day: '2-digit', month: 'short' })}</span> {g.casa ? 'vs' : '@'} <img src={g.adv_logo} alt="" width="20" /><b>{g.adversario}</b></Link></td>
                <td><span className={`tg-r ${g.resultado === 'W' ? 'w' : 'l'}`}>{g.resultado === 'W' ? 'V' : 'D'}</span> <small className="muted">{g.placar}</small></td><td className="pts"><b>{g.pts}</b></td><td>{g.reb}</td><td>{g.ast}</td><td className="hs">{g.min}</td></tr>)}</tbody></table></div></Panel>
          )}
          {(p.medias || []).length > 0 && (
            <Panel className="flush"><Head>Médias</Head><div className="tbl-wrap"><table className="tbl"><thead><tr><th className="l" />{p.medias[0].stats.map((s) => <th key={s.sigla} title={s.nome}>{s.sigla}</th>)}</tr></thead>
              <tbody>{p.medias.map((m) => <tr key={m.nome}><td className="l"><b>{m.nome}</b></td>{m.stats.map((s) => <td key={s.sigla} className={s.sigla === 'PTS' ? 'pts' : ''}>{s.valor}</td>)}</tr>)}</tbody></table></div></Panel>
          )}
        </div>
        <aside className="col side">
          <Panel><Head>Ficha</Head><dl className="facts">{[['Nome completo', p.nome_completo], ['Nascimento', p.nascimento], ['Naturalidade', p.naturalidade], ['Universidade', p.universidade], ['Draft', p.draft], ['Experiência', p.experiencia]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Panel>
        </aside>
      </div>
    </>
  );
}

/* ================= F1: piloto ================= */
const posClass = (r) => (!r.classificado ? 'dnf' : r.posicao === 1 ? 'p1' : r.posicao <= 3 ? 'pod' : r.posicao <= 10 ? 'pts' : '');
export function F1Driver() {
  const id = useParams().id;
  const { data: d } = useApi(`/esportes/f1/piloto/${id}`, { ttl: 600_000, critical: true });
  useEffect(() => { if (d) { Taste.bump('p', id, 3, { n: d.nome, e: d.bandeira }); Taste.bump('e', 'f1', 1); } }, [d]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <Skel h={420} />;
  const team = d.equipe || {}, cs = d.campeonato || {}, cr = d.carreira || {}, tm = d.companheiro;
  const duel = (label, a, b) => { const tot = (a + b) || 1; return (
    <div className="duel"><div className="duel-top"><b>{a}</b><span>{label}</span><b>{b}</b></div>
      <div className="duel-bar"><motion.i style={{ background: team.cor || '#ff1e1e' }} initial={{ width: 0 }} whileInView={{ width: `${(a / tot) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease }} /><motion.i initial={{ width: 0 }} whileInView={{ width: `${(b / tot) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.9, ease }} /></div></div>
  ); };
  return (
    <>
      <ProfileHero kind="f1" color={team.cor} photo={d.foto_oficial || d.foto} num={d.numero} eyebrow={team.id ? <Link to={`/f1/equipe/${team.id}`}><i className="tcb" style={{ background: team.cor }} /> {team.nome}</Link> : 'Fórmula 1'}
        title={<>{flag(d.bandeira, 34)} {d.nome}</>} sub={[d.idade ? `${d.idade} anos` : '', d.nascimento ? `nascido em ${d.nascimento}` : ''].filter(Boolean).join(' · ')}
        action={<Bell on={() => followsF1Driver(d.id)} onClick={() => toggleF1Driver({ id: d.id, nome: d.nome, cor: team.cor, foto: d.foto_oficial })} label="Seguir" onLabel="Seguindo" className="on-dark" hint="começo e fim das sessões, com a posição dele" />}
        kpis={[[cs.posicao ? `${cs.posicao}º` : '–', 'No campeonato', `${cs.pontos ?? 0} pontos`], [cs.vitorias ?? 0, 'Vitórias em 2026'], [cr.titulos, 'Títulos mundiais'], [cr.vitorias, 'Vitórias na carreira'], [cr.podios, 'Pódios'], [cr.poles, 'Poles'], [cr.corridas, 'GPs']]} />
      <div className="grid-main">
        <div className="col">
          <Reveal><Panel><Head sub="corridas + sprints">Pontos na temporada</Head><LineChart points={d.temporada.map((r) => ({ x: r.rodada, y: r.acumulado }))} color={team.cor || '#ff1e1e'} /></Panel></Reveal>
          <Panel><Head>Etapa a etapa</Head>
            <Stagger className="rstrip">{d.temporada.map((r) => <Item key={r.rodada}><Link className={`rs ${posClass(r)}`} to={`/f1/corrida/${r.rodada}`} title={`${r.gp} · largou ${r.largada || 'box'}`}><b>{r.classificado ? r.posicao : 'AB'}</b><small>{r.gp.replace(/^GP (do|da|de) /, '').slice(0, 10)}</small></Link></Item>)}</Stagger>
            <div className="legend"><span style={{ '--c': '#e8b923' }}>Vitória</span><span style={{ '--c': '#9aa4b1' }}>Pódio</span><span style={{ '--c': 'var(--hl)' }}>Pontos</span><span style={{ '--c': 'var(--loss)' }}>Abandono</span></div></Panel>
          {d.resumo && <Panel><Head>Sobre</Head><p className="pad bio">{d.resumo}<small className="muted" style={{ display: 'block', marginTop: 8 }}>Fonte: Wikipédia</small></p></Panel>}
        </div>
        <aside className="col side">
          {tm && <Panel><Head>Duelo com o companheiro</Head><div className="duel-head"><b>{d.sobrenome}</b><span>×</span><Link to={`/f1/piloto/${tm.piloto.id}`}>{tm.piloto.sobrenome}</Link></div>
            <div className="pad">{duel('Chegou à frente', tm.corrida[0], tm.corrida[1])}{tm.classificacao ? duel('Classificou à frente', tm.classificacao[0], tm.classificacao[1]) : tm.largada ? duel('Largou à frente', tm.largada[0], tm.largada[1]) : null}{duel('Pontos', tm.pontos[0], tm.pontos[1])}
              <small className="muted">{tm.rodadas != null ? `${tm.rodadas} etapas juntos` : ''}{(tm.outros || []).length ? ` · também correu com ${tm.outros.map((o) => o.sobrenome).join(', ')}` : ''}</small>
              <Link className="btn ghost sm duel-cmp" to={`/f1/comparar/${d.id}/${tm.piloto.id}`}>Comparar em detalhe</Link></div></Panel>}
          <Panel className="cmp-cta"><Link to={`/f1/comparar/${d.id}`}><b>Comparar {d.sobrenome} com outro piloto</b><small>Pontos, vitórias, poles, média de chegada e frente a frente</small></Link></Panel>
          <Panel><Head>Ficha</Head><dl className="facts">{[['Número', d.numero], ['Sigla', d.sigla], ['Equipe', team.nome], ['Nascimento', d.nascimento]].filter(([, v]) => v).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl></Panel>
          <Panel className="note">Títulos: levantamento até 2025 + o de 2026 quando já decidido. Demais números: Jolpica (base Ergast).</Panel>
        </aside>
      </div>
    </>
  );
}

/* ================= F1: equipe ================= */
export function F1Team() {
  const id = useParams().id;
  const { data: t } = useApi(`/esportes/f1/equipe/${id}`, { ttl: 600_000, critical: true });
  if (!t) return <Skel h={420} />;
  const cs = t.campeonato || {}, cr = t.carreira || {};
  const maxPts = Math.max(1, ...t.temporada.map((r) => r.pontos));
  return (
    <>
      <ProfileHero kind="f1-team" color={t.cor} photo={t.foto} eyebrow={<><i className="tcb" style={{ background: t.cor }} /> Equipe de Fórmula 1</>} title={t.nome} sub={t.pais}
        action={<Bell on={() => followsF1Team(id)} onClick={() => toggleF1Team({ id, nome: t.nome, cor: t.cor })} label="Seguir" onLabel="Seguindo" className="on-dark" hint="começo e fim das sessões, com a posição dos pilotos" />}
        kpis={[[cs.posicao ? `${cs.posicao}º` : '–', 'Construtores', `${cs.pontos ?? 0} pontos`], [cs.vitorias ?? 0, 'Vitórias em 2026'], [cr.titulos, 'Títulos'], [cr.vitorias, 'Vitórias na história'], [cr.poles, 'Poles na história']]} />
      <div className="grid-main">
        <div className="col">
          <Stagger className="grid-2">{t.pilotos.map((x) => (
            <Item key={x.piloto.id}><Link className="drv-card" to={`/f1/piloto/${x.piloto.id}`} style={{ '--tc': t.cor }}>{flag(x.piloto.bandeira, 30)}<span><b>{x.piloto.nome}</b><small>{x.pontos} pontos · melhor {x.melhor < 99 ? `${x.melhor}º` : '–'}</small><small>{x.vitorias} vitória{x.vitorias === 1 ? '' : 's'} · {x.podios} pódio{x.podios === 1 ? '' : 's'}</small></span></Link></Item>
          ))}</Stagger>
          <Reveal><Panel><Head>Pontos acumulados</Head><LineChart points={t.temporada.map((r) => ({ x: r.rodada, y: r.acumulado }))} color={t.cor} /></Panel></Reveal>
          <Panel><Head>Pontos por etapa</Head><div className="bars">{t.temporada.map((r, i) => <Link key={r.rodada} to={`/f1/corrida/${r.rodada}`} title={`${r.gp}: ${r.pontos} pts`}><motion.i style={{ background: t.cor }} initial={{ height: 0 }} whileInView={{ height: `${(r.pontos / maxPts) * 100}%` }} viewport={{ once: true }} transition={{ duration: 0.6, ease, delay: i * 0.03 }} /><span>{r.rodada}</span></Link>)}</div></Panel>
        </div>
        <aside className="col side">
          {t.resumo && <Panel><Head>Sobre</Head><p className="pad bio">{t.resumo}<small className="muted" style={{ display: 'block', marginTop: 8 }}>Fonte: Wikipédia</small></p></Panel>}
          <Panel className="note">Títulos: levantamento até 2025 + o de 2026 quando já decidido. Vitórias e poles: Jolpica (base Ergast).</Panel>
        </aside>
      </div>
    </>
  );
}
export { hexA, Tabs };
