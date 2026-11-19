// Mapa de arremessos da NBA: meia quadra em escala (50 x 47 pés, 10 unidades por pé), com cada arremesso de quadra
// do lance a lance da ESPN. Acerto = bolinha na cor do time; erro = "×". Filtros por time, jogador e quarto.
import { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { Empty } from './ui.jsx';

const sy = (y) => (47 - y) * 10; // a ESPN mede do fundo da quadra (y = 0 na linha de fundo); aqui o aro fica embaixo
const HOOP = { x: 250, y: sy(5.25) };
const zone = (s) => (s.pts === 3 ? 'tres' : (s.x >= 17 && s.x <= 33 && s.y <= 19) ? 'garrafao' : 'media');
const ZONES = [['garrafao', 'Garrafão'], ['media', 'Meia distância'], ['tres', 'Bola de 3']];
const pct = (m, a) => (a ? Math.round((m / a) * 100) : 0);
const qLabel = (n) => (n <= 4 ? `${n}º` : `P${n - 4}`);

function Court({ children }) {
  return (
    <svg viewBox="-10 -10 520 490" className="court" role="img" aria-label="Meia quadra de basquete com os arremessos">
      <rect x="0" y="0" width="500" height="470" className="c-floor" rx="6" />
      <g className="c-lines">
        <rect x="170" y={sy(19)} width="160" height={470 - sy(19)} className="c-paint" />
        <circle cx="250" cy={sy(19)} r="60" />
        <path d={`M 210 ${HOOP.y} A 40 40 0 0 1 290 ${HOOP.y}`} />
        <path d={`M 30 470 L 30 ${sy(14.2)} A 237.5 237.5 0 0 1 470 ${sy(14.2)} L 470 470`} />
        <line x1="220" y1={sy(4)} x2="280" y2={sy(4)} className="c-board" />
        <circle cx={HOOP.x} cy={HOOP.y} r="7.5" className="c-rim" />
        <path d="M 190 0 A 60 60 0 0 0 310 0" />
        <rect x="0" y="0" width="500" height="470" fill="none" />
      </g>
      {children}
    </svg>
  );
}

export function ShotChart({ shots, home, away }) {
  const [side, setSide] = useState('casa');
  const [player, setPlayer] = useState('');
  const [q, setQ] = useState(0);
  const [pick, setPick] = useState(null);
  const team = side === 'casa' ? home : away;
  const color = team.cor || '#ff7a1a';
  const mine = useMemo(() => (shots || []).filter((s) => s.lado === side), [shots, side]);
  const players = useMemo(() => {
    const m = new Map();
    mine.forEach((s) => { const p = m.get(s.jogador) || { id: s.jogador, nome: s.nome, a: 0, m: 0 }; p.a++; if (s.ok) p.m++; m.set(s.jogador, p); });
    return [...m.values()].sort((a, b) => b.a - a.a);
  }, [mine]);
  const quarters = [...new Set(mine.map((s) => s.periodo).filter(Boolean))].sort((a, b) => a - b);
  const list = mine.filter((s) => (!player || String(s.jogador) === player) && (!q || s.periodo === q));
  const made = list.filter((s) => s.ok).length;
  const byZone = ZONES.map(([k, l]) => { const z = list.filter((s) => zone(s) === k); return { k, l, a: z.length, m: z.filter((s) => s.ok).length }; });
  const hot = byZone.filter((z) => z.a >= 3).sort((a, b) => pct(b.m, b.a) - pct(a.m, a.a))[0];

  if (!(shots || []).length) return <Empty>O mapa de arremessos aparece quando o jogo começa.</Empty>;
  return (
    <div className="shots">
      <div className="shots-ctl">
        <div className="seg">{[['casa', home], ['fora', away]].map(([k, t]) => (
          <button key={k} className={side === k ? 'on' : ''} onClick={() => { setSide(k); setPlayer(''); setPick(null); }}>
            <img src={t.logo} alt="" width="18" /> {t.curto}{side === k && <motion.span layoutId="seg-shots" className="seg-ind" />}
          </button>
        ))}</div>
        <select value={player} onChange={(e) => { setPlayer(e.target.value); setPick(null); }} aria-label="Jogador">
          <option value="">Todos os jogadores</option>
          {players.map((p) => <option key={p.id} value={String(p.id)}>{p.nome} · {p.m}/{p.a}</option>)}
        </select>
        <div className="shots-q">
          {[0, ...quarters].map((n) => <button key={n} type="button" className={`chip ${q === n ? 'on' : ''}`} onClick={() => { setQ(n); setPick(null); }}>{n ? qLabel(n) : 'Jogo todo'}</button>)}
        </div>
      </div>
      <div className="shots-body">
        <div className="shots-court" style={{ '--tc': color }}>
          <Court>
            {list.map((s, i) => {
              const cx = s.x * 10, cy = sy(s.y), on = pick === s;
              return (
                <motion.g key={`${s.periodo}-${s.relogio}-${s.jogador}-${i}`} className={`shot ${s.ok ? 'made' : 'miss'} ${on ? 'on' : ''}`}
                  initial={{ opacity: 0, scale: 0.3 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: Math.min(i * 0.006, 0.6), duration: 0.25 }}
                  style={{ transformOrigin: `${cx}px ${cy}px` }} onClick={() => setPick(on ? null : s)}>
                  <title>{`${s.nome} · ${s.tipo} · ${String(s.dist).replace('.', ',')} m · ${qLabel(s.periodo)} ${s.relogio} · ${s.ok ? 'convertido' : 'errou'}`}</title>
                  {s.ok ? <circle cx={cx} cy={cy} r={on ? 10 : 7} /> : <path d={`M ${cx - 6} ${cy - 6} L ${cx + 6} ${cy + 6} M ${cx + 6} ${cy - 6} L ${cx - 6} ${cy + 6}`} />}
                </motion.g>
              );
            })}
          </Court>
          <div className="shots-legend"><span><i className="lg-made" /> Convertido</span><span><i className="lg-miss">×</i> Errou</span><span>Toque num arremesso para ver o lance</span></div>
        </div>
        <aside className="shots-side">
          <div className="shots-big"><b>{made}/{list.length}</b><span>{pct(made, list.length)}% de aproveitamento</span></div>
          {pick ? (
            <div className="shots-pick">
              <small>{qLabel(pick.periodo)} · {pick.relogio}</small>
              <b>{pick.nome}</b>
              <span>{pick.tipo} de {String(pick.dist).replace('.', ',')} m · {pick.pts} pontos</span>
              <em className={pick.ok ? 'ok' : 'no'}>{pick.ok ? 'Convertido' : 'Errou'}</em>
            </div>
          ) : null}
          <table className="tbl shots-z">
            <thead><tr><th className="l">Zona</th><th>Acertos</th><th>%</th></tr></thead>
            <tbody>{byZone.map((z) => (
              <tr key={z.k} className={hot && hot.k === z.k ? 'hot' : ''}><td className="l">{z.l}{hot && hot.k === z.k ? ' 🔥' : ''}</td><td>{z.m}/{z.a}</td><td><b>{pct(z.m, z.a)}%</b></td></tr>
            ))}</tbody>
          </table>
          <p className="np-note">A ESPN informa a posição de {mine.length} arremessos de quadra deste time; lances livres não entram no mapa.</p>
        </aside>
      </div>
    </div>
  );
}
