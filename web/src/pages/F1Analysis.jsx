// Análise da corrida com dados oficiais de cronometragem (OpenF1): pódio, estratégia de pneus,
// posição volta a volta, pit stops, ultrapassagens, direção de prova, clima e rádio das equipes.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { fmtDT } from '../lib/format.js';
import { Panel, Head, Skel, Stagger, Item, CountUp, Reveal, ease } from '../components/ui.jsx';

const TYRE = { SOFT: '#e10600', MEDIUM: '#ffd400', HARD: '#f0f0f0', INTERMEDIATE: '#43b02a', WET: '#0067ad' };
const RC = {
  sc: ['Safety car', '#ffb000'], vsc: ['Safety car virtual', '#ffb000'], vermelha: ['Bandeira vermelha', '#e10600'],
  punicao: ['Punição', '#e5484d'], investigacao: ['Investigação', '#5aa3ff'], sem_punicao: ['Sem punição', '#9aa4b1'], bandeirada: ['Bandeirada', '#f0f0f0'],
};
const lapTime = (s) => { if (!s) return '–'; const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(3).padStart(6, '0')}`; };
// a mensagem da FIA vem em inglês: as mais comuns em português, o resto como veio
function rcText(msg) {
  return String(msg || '')
    .replace(/^FIA STEWARDS: /, '')
    .replace(/INCIDENT INVOLVING CARS? ([\d\w (),]+?) (NOTED|WILL BE INVESTIGATED AFTER THE RACE|UNDER INVESTIGATION|REVIEWED NO FURTHER INVESTIGATION|NO FURTHER ACTION)/, (_, cars, what) => `Incidente com o carro ${cars} · ${{ NOTED: 'anotado', 'WILL BE INVESTIGATED AFTER THE RACE': 'investigado após a corrida', 'UNDER INVESTIGATION': 'em investigação', 'REVIEWED NO FURTHER INVESTIGATION': 'analisado, sem investigação', 'NO FURTHER ACTION': 'sem punição' }[what]}`)
    .replace(/(\d+) SECOND TIME PENALTY FOR CAR/, '$1 s de punição para o carro')
    .replace(/SAFETY CAR DEPLOYED/, 'Safety car na pista').replace(/VIRTUAL SAFETY CAR DEPLOYED/, 'Safety car virtual acionado')
    .replace(/SAFETY CAR IN THIS LAP/, 'Safety car sai nesta volta').replace(/RED FLAG/, 'Bandeira vermelha').replace(/CHEQUERED FLAG/, 'Bandeirada')
    .replace(/FAILING TO FOLLOW RACE DIRECTORS? INSTRUCTIONS/g, 'não seguiu as instruções da direção de prova')
    .replace(/PRACTICE START INFRINGEMENT/g, 'largada de treino irregular').replace(/CAUSING A COLLISION/g, 'causou uma colisão')
    .replace(/LEAVING THE TRACK AND GAINING AN ADVANTAGE/g, 'saiu da pista e levou vantagem').replace(/TRACK LIMITS/g, 'limites da pista')
    .replace(/SPEEDING IN THE PIT ?LANE/g, 'velocidade acima do limite no pit lane').replace(/UNSAFE RELEASE/g, 'liberação insegura do box')
    .replace(/FORCING ANOTHER DRIVER OFF THE TRACK/g, 'forçou outro piloto para fora da pista').replace(/FALSE START/g, 'queima de largada')
    .replace(/MOVING UNDER BRAKING/g, 'mudou de trajetória na freada').replace(/OVERTAKING UNDER (SAFETY CAR|SC)/g, 'ultrapassagem sob safety car')
    .replace(/\s+\(\d{2}:\d{2}:\d{2}\)$/, '').replace(/ [–-] /g, ' · ');
}

export default function F1Analysis({ rnd }) {
  const { data: a, isLoading, error } = useApi(`/esportes/f1/corrida/${rnd}/analise`, { ttl: 3_600_000 });
  if (isLoading) return <Panel className="pad"><p className="muted small">Buscando os dados oficiais de cronometragem (OpenF1)…</p><Skel h={260} /></Panel>;
  if (error || !a) return null;
  const by = Object.fromEntries(a.pilotos.map((p) => [p.numero, p]));
  return (
    <>
      <h2 className="sec-h">Análise da corrida <small className="muted" style={{ fontSize: 14, fontStyle: 'normal' }}>dados oficiais de cronometragem · OpenF1</small></h2>
      <Podium a={a} by={by} />
      <Facts a={a} by={by} />
      <Strategy a={a} by={by} />
      <LapChart a={a} by={by} />
      <div className="grid-2">
        <Pits a={a} by={by} />
        <Overtakes a={a} by={by} />
      </div>
      <div className="grid-2">
        <RaceControl a={a} by={by} />
        <Radio a={a} by={by} />
      </div>
    </>
  );
}

function Driver({ p, size = 28 }) {
  if (!p) return null;
  const inner = <>{p.foto ? <img className="hs" src={p.foto} alt="" width={size} height={size} loading="lazy" /> : null}<i className="tcb" style={{ background: p.cor }} /><b>{p.sigla}</b></>;
  return p.id ? <Link className="drv" to={`/f1/piloto/${p.id}`}>{inner}</Link> : <span className="drv">{inner}</span>;
}

function Podium({ a, by }) {
  const top = a.resultado.slice(0, 3);
  if (top.length < 3) return null;
  const order = [top[1], top[0], top[2]];
  return (
    <div className="podium">
      {order.map((r, i) => {
        const p = by[r.numero];
        const place = r.posicao;
        return (
          <motion.div key={r.numero} className={`pod-col p${place}`} style={{ '--tc': p.cor }}
            initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 + [0.2, 0, 0.35][i], duration: 0.6, ease }}>
            <Link to={p.id ? `/f1/piloto/${p.id}` : '#/f1'} className="pod-face">{p.foto && <img src={p.foto} alt="" />}</Link>
            <b>{p.sobrenome}</b><small>{p.equipe}</small>
            <motion.div className="pod-step" initial={{ height: 0 }} animate={{ height: [96, 130, 72][i] }} transition={{ delay: 0.3 + i * 0.1, duration: 0.7, ease }}>
              <span>{place}</span>
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
}

function Facts({ a, by }) {
  const c = a.clima;
  const vr = a.volta_rapida;
  return (
    <Panel>
      <div className="kpi-grid">
        <div><b><CountUp value={a.voltas_total} /></b><span>Voltas</span></div>
        {vr && <div><b>{lapTime(vr.tempo)}</b><span>Volta mais rápida</span><small>{by[vr.numero] ? by[vr.numero].sobrenome : ''} · volta {vr.volta}</small></div>}
        <div><b><CountUp value={a.ultrapassagens_total} /></b><span>Ultrapassagens</span></div>
        <div><b><CountUp value={a.pit_stops.length} /></b><span>Pit stops</span></div>
        {c && <div><b>{c.ar}°</b><span>Temperatura do ar</span><small>pista de {c.pista_min}° a {c.pista_max}°</small></div>}
        {c && <div><b>{c.chuva ? 'Sim' : 'Não'}</b><span>Chuva</span><small>umidade {c.umidade}%</small></div>}
      </div>
    </Panel>
  );
}

// estratégia de pneus: cada linha é um piloto, cada bloco um jogo de pneus
function Strategy({ a, by }) {
  const total = a.voltas_total || 1;
  const pitLaps = useMemo(() => {
    const m = {};
    a.pit_stops.forEach((p) => { (m[p.numero] = m[p.numero] || []).push(p.volta); });
    return m;
  }, [a]);
  return (
    <Reveal>
      <Panel>
        <Head sub="pneu usado em cada volta">Estratégia de pneus</Head>
        <div className="strat">
          {a.estrategia.map((row, i) => (
            <div key={row.numero} className="strat-row">
              <span className="strat-pos">{i + 1}</span>
              <Driver p={by[row.numero]} size={24} />
              <div className="strat-bar">
                {row.stints.map((s, j) => (
                  <motion.i key={j} title={`${s.nome}: voltas ${s.de} a ${s.ate}${s.idade ? ` (pneu usado, ${s.idade} voltas)` : ''}`}
                    style={{ left: `${((s.de - 1) / total) * 100}%`, background: TYRE[s.composto] || '#777' }}
                    initial={{ width: 0 }} whileInView={{ width: `${((s.ate - s.de + 1) / total) * 100}%` }} viewport={{ once: true }}
                    transition={{ duration: 0.6, ease, delay: i * 0.02 + j * 0.08 }}>
                    <em>{s.composto ? s.composto[0] : ''}</em>
                  </motion.i>
                ))}
                {(pitLaps[row.numero] || []).map((l, k) => <span key={k} className="strat-pit" style={{ left: `${(l / total) * 100}%` }} />)}
              </div>
            </div>
          ))}
        </div>
        <div className="legend">{Object.entries({ SOFT: 'Macio', MEDIUM: 'Médio', HARD: 'Duro', INTERMEDIATE: 'Intermediário', WET: 'Chuva' }).map(([k, l]) => <span key={k} style={{ '--c': TYRE[k] }}>{l}</span>)}<span style={{ '--c': 'var(--ink)' }}>Pit stop</span></div>
      </Panel>
    </Reveal>
  );
}

// posição volta a volta: as linhas se desenham; clique num piloto para destacar
function LapChart({ a, by }) {
  const [sel, setSel] = useState(() => new Set(a.resultado.slice(0, 5).map((r) => r.numero)));
  const total = a.voltas_total || 1;
  const n = a.posicoes.length || 20;
  const W = 900, H = 420, P = { l: 30, r: 54, t: 14, b: 26 };
  const X = (lap) => P.l + (lap / total) * (W - P.l - P.r);
  const Y = (pos) => P.t + ((pos - 1) / Math.max(1, n - 1)) * (H - P.t - P.b);
  const toggle = (num) => setSel((s) => { const x = new Set(s); if (x.has(num)) x.delete(num); else x.add(num); return x; });
  return (
    <Reveal>
      <Panel>
        <Head sub="toque nos pilotos para destacar">Posição volta a volta</Head>
        <div className="lap-chips">
          {a.posicoes.map((r) => { const p = by[r.numero]; return p ? (
            <button key={r.numero} className={`lchip ${sel.has(r.numero) ? 'on' : ''}`} style={{ '--tc': p.cor }} onClick={() => toggle(r.numero)}>{p.sigla}</button>
          ) : null; })}
        </div>
        <div className="lap-wrap">
          <svg className="lapchart" viewBox={`0 0 ${W} ${H}`}>
            {[1, 5, 10, 15, 20].filter((p) => p <= n).map((p) => <g key={p}><line x1={P.l} x2={W - P.r} y1={Y(p)} y2={Y(p)} className="g" /><text x={P.l - 8} y={Y(p) + 4} textAnchor="end">{p}</text></g>)}
            {Array.from({ length: Math.floor(total / 10) }, (_, i) => (i + 1) * 10).map((l) => <text key={l} x={X(l)} y={H - 6} textAnchor="middle">{l}</text>)}
            {a.posicoes.map((r) => {
              const p = by[r.numero];
              if (!p) return null;
              const pts = [[0, r.largada || r.posicoes[0]], ...r.posicoes.map((v, i) => [i + 1, v])].filter(([, v]) => v);
              if (pts.length < 2) return null;
              const d = pts.map(([l, v], i) => `${i ? 'L' : 'M'}${X(l).toFixed(1)},${Y(v).toFixed(1)}`).join('');
              const on = sel.has(r.numero);
              const last = pts[pts.length - 1];
              return (
                <g key={r.numero} className={on ? 'on' : 'off'} onClick={() => toggle(r.numero)}>
                  <motion.path d={d} stroke={p.cor} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.8, ease }} />
                  {on && <text x={X(last[0]) + 6} y={Y(last[1]) + 4} fill={p.cor} className="lab">{p.sigla}</text>}
                </g>
              );
            })}
          </svg>
        </div>
      </Panel>
    </Reveal>
  );
}

function Pits({ a, by }) {
  const best = a.pit_mais_rapidos;
  const max = Math.max(...best.map((p) => p.parado || 0), 1);
  return (
    <Panel>
      <Head sub="tempo com o carro parado">Pit stops mais rápidos</Head>
      <Stagger>{best.map((p, i) => (
        <Item key={i} className="ov-row">
          <span className="n">{i + 1}</span><Driver p={by[p.numero]} />
          <span className="rbar"><motion.i style={{ background: by[p.numero] ? by[p.numero].cor : 'var(--hl)' }} initial={{ width: 0 }} animate={{ width: `${(p.parado / max) * 100}%` }} transition={{ duration: 0.8, ease }} /></span>
          <b>{p.parado.toFixed(1).replace('.', ',')} s</b><small className="muted">volta {p.volta}</small>
        </Item>))}</Stagger>
    </Panel>
  );
}

function Overtakes({ a, by }) {
  const list = a.ultrapassagens.slice(0, 6);
  const max = Math.max(1, ...list.map((x) => x.total));
  return (
    <Panel>
      <Head sub={`${a.ultrapassagens_total} na corrida`}>Quem mais ultrapassou</Head>
      <Stagger>{list.map((x, i) => (
        <Item key={x.numero} className="ov-row">
          <span className="n">{i + 1}</span><Driver p={by[x.numero]} />
          <span className="rbar"><motion.i style={{ background: by[x.numero] ? by[x.numero].cor : 'var(--hl)' }} initial={{ width: 0 }} animate={{ width: `${(x.total / max) * 100}%` }} transition={{ duration: 0.8, ease, delay: i * 0.05 }} /></span>
          <b><CountUp value={x.total} /></b><small className="muted">ultrap.</small>
        </Item>))}</Stagger>
    </Panel>
  );
}

function RaceControl({ a }) {
  const list = a.direcao_de_prova;
  return (
    <Panel>
      <Head sub={a.bandeiras_amarelas ? `${a.bandeiras_amarelas} bandeiras amarelas` : ''}>Direção de prova</Head>
      {list.length ? (
        <Stagger className="rc-list">{list.map((m, i) => (
          <Item key={i} className="rc-row">
            <span className="rc-lap">{m.volta ? `V${m.volta}` : '–'}</span>
            <span className="rc-tag" style={{ '--c': (RC[m.tipo] || [])[1] }}>{(RC[m.tipo] || [m.tipo])[0]}</span>
            <span className="rc-msg">{rcText(m.mensagem)}</span>
          </Item>))}</Stagger>
      ) : <p className="pad muted">Corrida sem safety car, bandeira vermelha ou punições.</p>}
    </Panel>
  );
}

function Radio({ a, by }) {
  if (!a.radio.length) return <Panel><Head>Rádio das equipes</Head><p className="pad muted">A F1 não liberou mensagens de rádio desta corrida.</p></Panel>;
  return (
    <Panel>
      <Head sub="seleção liberada pela F1">Rádio das equipes</Head>
      <Stagger className="radio-list">{[...a.radio].reverse().map((r, i) => (
        <Item key={i} className="radio-row">
          <Driver p={by[r.numero]} size={30} />
          <small className="muted">{fmtDT(r.quando, { hour: '2-digit', minute: '2-digit' })}</small>
          <audio controls preload="none" src={r.audio} />
        </Item>))}</Stagger>
    </Panel>
  );
}
