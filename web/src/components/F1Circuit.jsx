// Página da etapa da F1: traçado com as curvas, ficha do circuito, previsão do tempo por sessão e a última edição.
import { motion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { fmtDT } from '../lib/format.js';
import { Panel, Head, Skel, Stagger, Item, ease } from './ui.jsx';

const flag = (src, w = 18) => (src ? <img className="flag" src={src} alt="" width={w} /> : null);
const num = (v, d = 3) => (v == null ? '–' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d }));

function TrackMap({ t }) {
  const pad = 70;
  const d = t.pontos.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('') + 'Z';
  const [sx, sy] = t.largada || t.pontos[0];
  return (
    <svg className="trk" viewBox={`${-pad} ${-pad} ${t.largura + pad * 2} ${t.altura + pad * 2}`} role="img" aria-label="Traçado do circuito">
      <path d={d} className="trk-base" />
      <motion.path d={d} className="trk-line" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2.2, ease }} />
      {/* largada/chegada */}
      <g transform={`translate(${sx} ${sy})`}><rect x="-14" y="-14" width="28" height="28" rx="4" className="trk-start" /><text y="5" textAnchor="middle" className="trk-start-t">L</text></g>
      {t.curvas.map((c) => (
        <motion.g key={`${c.n}${c.letra}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 + c.n * 0.06 }}>
          <line x1={c.x} y1={c.y} x2={c.lx} y2={c.ly} className="trk-tick" />
          <circle cx={c.lx} cy={c.ly} r="22" className="trk-c" />
          <text x={c.lx} y={c.ly + 7} textAnchor="middle" className="trk-n">{c.n}{c.letra}</text>
        </motion.g>
      ))}
    </svg>
  );
}

// ícones simples para o tempo (código WMO da Open-Meteo)
function WxIcon({ code }) {
  const rain = code >= 51 && code <= 82, storm = code >= 95, cloud = code >= 2, sun = code <= 2;
  return (
    <svg className="wx-ico" viewBox="0 0 48 48" aria-hidden="true">
      {sun && <g className="wx-sun"><circle cx={cloud ? 18 : 24} cy={cloud ? 18 : 24} r="8" />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1={cloud ? 18 : 24} y1={(cloud ? 18 : 24) - 13} x2={cloud ? 18 : 24} y2={(cloud ? 18 : 24) - 17} transform={`rotate(${a} ${cloud ? 18 : 24} ${cloud ? 18 : 24})`} />)}</g>}
      {cloud && <path className="wx-cloud" d="M14 34h20a8 8 0 0 0 0-16 11 11 0 0 0-21 3 6.5 6.5 0 0 0 1 13z" />}
      {rain && [16, 24, 32].map((x) => <line key={x} className="wx-rain" x1={x} y1="38" x2={x - 3} y2="45" />)}
      {storm && <path className="wx-bolt" d="M25 33l-5 8h5l-3 6 8-10h-5l3-4z" />}
    </svg>
  );
}

export function F1Circuit({ rnd }) {
  const { data: c, isLoading } = useApi(`/esportes/f1/corrida/${rnd}/circuito`, { ttl: 1_800_000 });
  if (isLoading) return <Skel h={420} />;
  if (!c) return null;
  const f = c.ficha || {}, rec = f.recorde, u = c.ultima;
  const facts = [
    ['Extensão', f.extensao_km ? `${num(f.extensao_km)} km` : null],
    ['Voltas', f.voltas],
    ['Distância', f.distancia_km ? `${num(f.distancia_km)} km` : null],
    ['Curvas', f.curvas],
    ['Perda no pit stop', f.pit_perda ? `${num(f.pit_perda, 1)} s` : null],
  ].filter(([, v]) => v != null);
  return (
    <>
      <Panel className="circ">
        <Head sub={[c.cidade, c.pais].filter(Boolean).join(', ')}>{c.nome}</Head>
        <div className="circ-grid">
          <div className="circ-map">{c.tracado ? <TrackMap t={c.tracado} /> : <p className="muted pad">Traçado indisponível para este circuito.</p>}</div>
          <div className="circ-side">
            <Stagger className="circ-facts">{facts.map(([k, v]) => <Item key={k}><span>{k}</span><b>{v}</b></Item>)}</Stagger>
            {rec && (
              <a className="circ-rec" href={`#/f1/piloto/${rec.piloto.id}`} style={{ '--tc': (rec.piloto.equipe || {}).cor || '#888' }}>
                <small>Recorde da volta em corrida</small>
                <b>{rec.tempo}</b>
                <span>{flag(rec.piloto.bandeira)} {rec.piloto.nome} · {rec.ano}</span>
              </a>
            )}
          </div>
        </div>
      </Panel>
      {(c.clima || []).length > 0 && (
        <Panel><Head sub="na hora de cada sessão · Open-Meteo">Previsão do tempo</Head>
          <Stagger className="wx">{c.clima.map((w) => (
            <Item key={w.sessao} className={`wx-card ${w.sessao === 'Corrida' ? 'race' : ''} ${w.chuva >= 40 ? 'wet' : ''}`}>
              <small>{w.sessao}</small>
              <span className="wx-when">{fmtDT(w.data_iso, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
              <WxIcon code={w.codigo} />
              <b>{Math.round(w.temperatura)}°</b>
              <span className="wx-txt">{w.tempo}</span>
              <span className="wx-meta">Chuva {w.chuva ?? '–'}% · vento {Math.round(w.vento)} km/h</span>
            </Item>
          ))}</Stagger>
        </Panel>
      )}
      {u && (
        <Panel><Head sub={`${u.voltas} voltas`}>Edição de {u.ano}</Head>
          <div className="last-ed">
            {u.podio.map((p) => (
              <a key={p.pos} className={`last-p p${p.pos}`} href={`#/f1/piloto/${p.piloto.id}`} style={{ '--tc': (p.piloto.equipe || {}).cor || '#888' }}>
                <span className="last-pos">{p.pos}º</span>
                <span className="last-nm">{flag(p.piloto.bandeira)} <b>{p.piloto.sobrenome}</b><small>{(p.piloto.equipe || {}).nome}</small></span>
                <span className="last-t">{p.tempo}</span>
              </a>
            ))}
            {u.pole && <div className="last-pole"><small>Pole position</small><b>{flag(u.pole.piloto.bandeira)} {u.pole.piloto.nome}</b><span>{u.pole.tempo}</span></div>}
          </div>
        </Panel>
      )}
    </>
  );
}
