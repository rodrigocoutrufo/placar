import { Link, useParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { LOGO } from '../lib/themes.js';
import { fmtDT } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Stagger, Item, ease } from '../components/ui.jsx';
import F1Analysis from './F1Analysis.jsx';
import { F1Circuit } from '../components/F1Circuit.jsx';
import { isFollowedF1 } from '../lib/notify.js';
import { useStoreVersion } from '../lib/store.js';

const flag = (src, w = 20) => (src ? <img className="flag" src={src} alt="" width={w} /> : null);

export default function F1Race() {
  useStoreVersion();
  const { rnd } = useParams();
  const { data: r } = useApi(`/esportes/f1/corrida/${rnd}`, { ttl: 120_000, critical: true });
  if (!r) return <><Skel h={260} /><Skel h={500} /></>;
  const pilot = (p) => (
    <a className="f1p" href={`#/f1/piloto/${p.id}`}>{flag(p.bandeira, 18)}<span><b>{p.nome}</b><small>{(p.equipe || {}).nome}</small></span></a>
  );
  return (
    <>
      <section className="pitwall small">
        <span className="pw-carbon" />
        <motion.span className="pw-slash" initial={{ x: 300, opacity: 0 }} animate={{ x: 0, opacity: 1 }} transition={{ duration: 0.8, ease }} />
        <div className="pw-in">
          <img className="pw-logo sm" src={LOGO.f1} alt="Fórmula 1" />
          <div className="pw-race">
            <small><Link to="/f1/calendario">Calendário</Link> · etapa {r.rodada}</small>
            <motion.h1 initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.5, ease }}>{r.nome}</motion.h1>
            <span className="pw-circ">{r.circuito} · {r.cidade}, {r.pais}</span>
          </div>
        </div>
        <Stagger className="pw-sessions">{r.sessoes.map((s) => <Item key={s.nome} className={`ses ${s.nome === 'Corrida' ? 'race' : ''}`}><b>{s.nome}</b><span>{fmtDT(s.data_iso)}</span></Item>)}</Stagger>
      </section>
      {!r.resultado.length && <F1Circuit rnd={r.rodada} />}
      {r.resultado.length > 0 && <F1Analysis rnd={r.rodada} />}
      {r.resultado.length > 0 && (
        <Panel className="flush">
          <Head>Resultado da corrida</Head>
          <div className="tbl-wrap"><table className="tbl">
            <thead><tr><th>#</th><th className="l">Piloto</th><th className="hs">Largou</th><th className="l">Tempo</th><th>Pts</th></tr></thead>
            <motion.tbody variants={{ show: { transition: { staggerChildren: 0.03 } } }} initial="hidden" animate="show">
              {r.resultado.map((x) => {
                const gain = x.largada && x.posicao ? x.largada - x.posicao : 0;
                return (
                  <motion.tr key={x.piloto.id} className={`${x.piloto.brasileiro ? 'hl' : ''} ${isFollowedF1({ id: x.piloto.id, equipe: x.piloto.equipe }) ? 'fol' : ''}`} variants={{ hidden: { opacity: 0, x: -14 }, show: { opacity: 1, x: 0 } }}>
                    <td className={`pos p${x.posicao}`} style={{ '--z': (x.piloto.equipe || {}).cor || 'transparent' }}>{x.posicao}</td>
                    <td className="team l">{pilot(x.piloto)}</td>
                    <td className="hs">{x.largada || 'Box'} {gain ? <span className={`mv ${gain > 0 ? 'up' : 'down'}`}>{gain > 0 ? '▲' : '▼'}{Math.abs(gain)}</span> : null}</td>
                    <td className="l small">{x.tempo}{x.volta_rapida && <span className="tag">Volta mais rápida {x.melhor_volta}</span>}</td>
                    <td className="pts"><b>{x.pontos || ''}</b></td>
                  </motion.tr>
                );
              })}
            </motion.tbody>
          </table></div>
        </Panel>
      )}
      {(r.sprint_resultado || []).length > 0 && (
        <Panel><Head>Corrida sprint</Head><Stagger>{r.sprint_resultado.slice(0, 10).map((x) => <Item key={x.piloto.id} className="tw-row"><span className="p">{x.posicao}</span>{pilot(x.piloto)}<small>{x.tempo}</small><b>{x.pontos || ''}</b></Item>)}</Stagger></Panel>
      )}
      {r.classificacao.length > 0 && (
        <Panel className="flush">
          <Head>Classificação (grid)</Head>
          <div className="tbl-wrap"><table className="tbl"><thead><tr><th>#</th><th className="l">Piloto</th><th>Q1</th><th className="hs">Q2</th><th>Q3</th></tr></thead>
            <tbody>{r.classificacao.map((x) => <tr key={x.piloto.id} className={x.piloto.brasileiro ? 'hl' : ''}><td>{x.posicao}</td><td className="team l">{pilot(x.piloto)}</td><td className="small">{x.q1}</td><td className="small hs">{x.q2}</td><td className="small">{x.q3}</td></tr>)}</tbody></table></div>
        </Panel>
      )}
      {!r.resultado.length && !r.classificacao.length && <p className="muted f1-wait">Os resultados aparecem aqui depois de cada sessão.</p>}
      {r.resultado.length > 0 && <F1Circuit rnd={r.rodada} />}
      {r.historico && r.historico.corridas > 0 && <History h={r.historico} circuito={r.circuito} />}
    </>
  );
}

// quem já venceu neste circuito (Jolpica, desde a primeira corrida da F1 ali)
function History({ h, circuito }) {
  return (
    <Panel className="hist">
      <Head sub={`${h.corridas} GPs desde ${h.primeira}`}>Vencedores em {circuito}</Head>
      <div className="hist-grid">
        <Stagger className="hist-list">{h.vencedores.map((w) => (
          <Item key={w.ano}><a className="hist-row" href={`#/f1/piloto/${w.piloto.id}`} style={{ '--tc': (w.piloto.equipe || {}).cor || '#888' }}>
            <span className="hist-y">{w.ano}</span>{flag(w.piloto.bandeira, 18)}<b>{w.piloto.nome}</b><small>{(w.piloto.equipe || {}).nome}{w.largada === 1 ? ' · da pole' : w.largada > 1 ? ` · largou em ${w.largada}º` : ''}</small>
          </a></Item>
        ))}</Stagger>
        <div className="hist-side">
          {h.maiores.length > 0 && <><h4 className="st-sec">Maiores vencedores</h4>{h.maiores.map((m, i) => <a key={m.piloto.id} className="hist-top" href={`#/f1/piloto/${m.piloto.id}`}><span className="p">{i + 1}</span>{flag(m.piloto.bandeira, 18)}<b>{m.piloto.nome}</b><em>{m.vitorias}</em></a>)}</>}
          <div className="hist-kpi"><b>{Math.round((h.pole_venceu / h.corridas) * 100)}%</b><span>das vitórias saíram da pole ({h.pole_venceu} de {h.corridas})</span></div>
        </div>
      </div>
    </Panel>
  );
}
