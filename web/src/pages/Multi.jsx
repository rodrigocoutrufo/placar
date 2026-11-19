// Multijogo: 2 a 4 jogos lado a lado, ao vivo, com "GOL!" piscando no quadro de cada um.
// Os jogos ficam no endereço (#/multijogo?j=1,2,3): dá para mandar o link. A última escolha fica guardada no aparelho.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { useLive } from '../lib/live.js';
import { useComps, useAgenda, compOf } from '../lib/data.js';
import { isLive, parseDate, fmtTime, dayKey, evMinute, barColors, inkFor, norm, STATUS_NAME } from '../lib/format.js';
import { isFollowedMatch } from '../lib/follow.js';
import { setWatching } from '../lib/notify.js';
import { Crest, CompLogo, Digit, LiveMinute, LiveDot, Empty, ease } from '../components/ui.jsx';
import { MAX_MULTI, SAVE, read, write, lastMulti } from '../lib/multi.js';

const SOUND = 'placar.multi.som';

// apito curto (Web Audio, sem arquivo de som): só quando a pessoa liga o som
function whistle() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.22].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'square'; o.frequency.value = 2200;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.18);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close(), 800);
  } catch { /* navegador sem áudio */ }
}

function events(p) {
  const out = [];
  ['mandante', 'visitante'].forEach((side) => {
    ((p.gols || {})[side] || []).forEach((g) => out.push({ side, kind: g.gol_contra ? 'contra' : g.penalti ? 'penalti' : 'gol', name: g.atleta ? g.atleta.nome_popular : 'Gol', m: evMinute(g) }));
    (((p.cartoes || {}).vermelho || {})[side] || []).forEach((c) => out.push({ side, kind: 'vermelho', name: c.atleta ? c.atleta.nome_popular : 'Expulsão', m: evMinute(c) }));
  });
  return out.sort((a, b) => b.m.key - a.m.key);
}
const ICON = { gol: '⚽', penalti: '⚽', contra: '⚽', vermelho: '🟥' };

function Tile({ id, live, comps, focus, onFocus, onRemove, onSwap, sound }) {
  const isOn = live.has(+id);
  const q = useApi(`/partidas/${id}`, { ttl: 15_000, refetch: isOn ? 30_000 : false });
  const base = q.data;
  const lv = live.get(+id);
  const p = base ? { ...base, ...(lv ? { placar_mandante: lv.placar_mandante, placar_visitante: lv.placar_visitante, status: lv.status, periodo: lv.periodo, cronometro: lv.cronometro, cronometro_label: lv.cronometro_label } : {}) } : lv;
  const [flash, setFlash] = useState(null);
  const prev = useRef(null);
  useEffect(() => { // placar subiu: "GOL!" no quadro (e apito, se ligado)
    if (!p) return undefined;
    const cur = [p.placar_mandante ?? 0, p.placar_visitante ?? 0];
    const old = prev.current;
    prev.current = cur;
    if (!old || !isLive(p)) return undefined;
    const side = cur[0] > old[0] ? 'mandante' : cur[1] > old[1] ? 'visitante' : null;
    if (!side) return undefined;
    setFlash({ side, t: p[side === 'mandante' ? 'time_mandante' : 'time_visitante'], k: Date.now() });
    if (sound) whistle();
    q.refetch(); // traz o autor do gol
    const tm = setTimeout(() => setFlash(null), 4500);
    return () => clearTimeout(tm);
  }, [p && p.placar_mandante, p && p.placar_visitante]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p) {
    return <div className="mj-tile loading">{q.isError ? <span>Jogo indisponível. <button type="button" className="chip" onClick={onRemove}>Remover</button></span> : <span className="mj-shine" />}</div>;
  }
  const H = p.time_mandante, A = p.time_visitante, on = isLive(p), done = p.status === 'finalizado';
  const [ch, ca] = barColors(H, A);
  const c = compOf(comps, p);
  const d = parseDate(p);
  const evs = events(p).slice(0, 5);
  const s = p.estatisticas;
  const pa = s && s.mandante ? parseFloat(s.mandante.posse_de_bola) || 0 : 0, pb = s && s.visitante ? parseFloat(s.visitante.posse_de_bola) || 0 : 0;
  return (
    <motion.article layout className={`mj-tile ${on ? 'is-live' : ''} ${focus ? 'focus' : ''}`} style={{ '--hc': ch, '--ac': ca }} transition={{ duration: 0.35, ease }}>
      <span className="mj-slab h" /><span className="mj-slab a" />
      <header className="mj-head">
        <span className="mj-comp"><CompLogo c={c} size={16} dark />{c.nome_popular || c.nome}</span>
        <span className={`mj-st ${on ? 'live' : ''}`}>{on ? <><LiveDot /><LiveMinute p={p} /></> : done ? 'Encerrado' : STATUS_NAME[p.status] || (d ? `${d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '')} · ${fmtTime(p)}` : fmtTime(p))}</span>
        <span className="mj-acts">
          <button type="button" onClick={onFocus} aria-label={focus ? 'Voltar à grade' : 'Ampliar'} title={focus ? 'Voltar à grade' : 'Ampliar'}>{focus ? '⤡' : '⤢'}</button>
          <button type="button" onClick={onSwap} aria-label="Trocar jogo" title="Trocar jogo">⇄</button>
          <button type="button" onClick={onRemove} aria-label="Remover" title="Remover">×</button>
        </span>
      </header>
      <Link to={`/partida/${p.partida_id}`} className="mj-score" title="Abrir a partida">
        {[[H, p.placar_mandante, 'h'], [A, p.placar_visitante, 'a']].map(([t, g, k]) => (
          <span key={k} className="mj-team"><Crest t={t} size={focus ? 64 : 44} /><b>{t.nome_popular}</b><em>{on || done ? <Digit v={g ?? 0} /> : ''}</em></span>
        ))}
      </Link>
      {pa + pb > 0 && (
        <div className="mj-poss" title="Posse de bola">
          <i style={{ width: `${pa}%`, background: ch, color: inkFor(ch) }}>{Math.round(pa)}%</i>
          <i style={{ width: `${pb}%`, background: ca, color: inkFor(ca) }}>{Math.round(pb)}%</i>
        </div>
      )}
      <ul className="mj-evs">
        {evs.length ? evs.map((e, i) => (
          <motion.li key={`${e.m.key}-${e.name}-${i}`} className={e.side === 'mandante' ? 'h' : 'a'} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
            <span>{ICON[e.kind]}</span><b>{e.m.label}</b>{e.name}{e.kind === 'contra' ? ' (contra)' : e.kind === 'penalti' ? ' (pên.)' : ''}
          </motion.li>
        )) : <li className="none">{on || done ? 'Sem gols até agora' : 'Ainda não começou'}</li>}
      </ul>
      <AnimatePresence>
        {flash && (
          <motion.div key={flash.k} className="mj-flash" style={{ background: flash.side === 'mandante' ? ch : ca, color: inkFor(flash.side === 'mandante' ? ch : ca) }}
            initial={{ opacity: 0, scale: 1.15 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} onClick={() => setFlash(null)}>
            <Crest t={flash.t} size={70} /><b>GOL!</b><span>{flash.t.nome_popular}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

// escolher jogos: ao vivo primeiro, depois o que a pessoa segue, depois por horário; busca por time ou campeonato
function Picker({ chosen, onToggle, comps, agenda, live, onClose, swap }) {
  const [q, setQ] = useState('');
  const today = dayKey(new Date());
  const pool = useMemo(() => {
    const m = new Map();
    [...live, ...(agenda || []).filter((p) => { const k = dayKey(parseDate(p)); return k === today || isLive(p); })].forEach((p) => m.set(p.partida_id, live.find((x) => x.partida_id === p.partida_id) || p));
    const score = (p) => (isLive(p) ? 0 : 2) + (isFollowedMatch(p) ? 0 : 1) + (p.status === 'finalizado' ? 3 : 0);
    return [...m.values()].sort((a, b) => score(a) - score(b) || (parseDate(a) || 0) - (parseDate(b) || 0));
  }, [live, agenda, today]);
  const k = norm(q);
  const list = k ? pool.filter((p) => norm(`${p.time_mandante.nome_popular} ${p.time_visitante.nome_popular} ${compOf(comps, p).nome_popular || ''}`).includes(k)) : pool;
  const full = chosen.length >= MAX_MULTI && !swap;
  return (
    <div className="mj-pick">
      <div className="mj-pick-head">
        <b>{swap ? 'Trocar por qual jogo?' : `Escolha até ${MAX_MULTI} jogos`}</b>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar time ou campeonato" aria-label="Buscar jogo" />
        {onClose && <button type="button" className="btn primary" onClick={onClose} disabled={!chosen.length}>{swap ? 'Cancelar' : `Ver ${chosen.length} ${chosen.length === 1 ? 'jogo' : 'jogos'}`}</button>}
      </div>
      {!list.length ? <Empty>{q ? 'Nenhum jogo hoje com esse nome.' : 'Nenhum jogo hoje.'}</Empty> : (
        <div className="mj-pick-list">
          {list.map((p) => {
            const on = chosen.includes(+p.partida_id);
            const c = compOf(comps, p);
            return (
              <button type="button" key={p.partida_id} className={`mj-opt ${on ? 'on' : ''}`} disabled={!on && full} onClick={() => onToggle(+p.partida_id)} aria-pressed={on}>
                <span className="mj-opt-c"><CompLogo c={c} size={14} dark />{c.nome_popular || c.nome}</span>
                <span className="mj-opt-t"><Crest t={p.time_mandante} size={20} />{p.time_mandante.nome_popular}<i>{isLive(p) || p.status === 'finalizado' ? `${p.placar_mandante ?? 0} × ${p.placar_visitante ?? 0}` : '×'}</i>{p.time_visitante.nome_popular}<Crest t={p.time_visitante} size={20} /></span>
                <span className={`mj-opt-s ${isLive(p) ? 'live' : ''}`}>{isLive(p) ? <><LiveDot /><LiveMinute p={p} /></> : p.status === 'finalizado' ? 'Encerrado' : fmtTime(p)}</span>
                <span className="mj-opt-ck">{on ? '✓' : '+'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Multi() {
  const [params, setParams] = useSearchParams();
  const fromUrl = (params.get('j') || '').split(',').map(Number).filter(Boolean).slice(0, MAX_MULTI);
  const live = useLive();
  const { data: comps } = useComps();
  const { data: agenda } = useAgenda(comps);
  const [focus, setFocus] = useState(null);
  const [picking, setPicking] = useState(false);
  const [swap, setSwap] = useState(null); // id do quadro sendo trocado
  const [sound, setSound] = useState(() => read(SOUND, false));
  const liveMap = useMemo(() => new Map(live.map((p) => [+p.partida_id, p])), [live]);

  // sem jogos no endereço: volta a última escolha; sem ela, sugere até 4 jogos ao vivo do que a pessoa segue
  const ids = fromUrl.length ? fromUrl : [];
  useEffect(() => {
    if (fromUrl.length) return;
    const last = lastMulti();
    const sug = last.length ? last : live.filter((p) => isFollowedMatch(p)).concat(live).map((p) => +p.partida_id);
    const pick = [...new Set(sug)].slice(0, MAX_MULTI);
    if (pick.length >= 1 && last.length) setParams({ j: pick.join(',') }, { replace: true });
    else setPicking(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ids.length) write(SAVE, ids); setWatching(ids); }, [ids.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => setWatching([]), []); // saiu da página: os avisos voltam ao normal

  const setIds = (next) => setParams(next.length ? { j: next.slice(0, MAX_MULTI).join(',') } : {}, { replace: true });
  const toggle = (id) => {
    if (swap) { setIds(ids.map((x) => (x === swap ? id : x))); setSwap(null); setPicking(false); return; }
    setIds(ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]);
  };
  const toggleSound = () => { const v = !sound; setSound(v); write(SOUND, v); if (v) whistle(); };
  const share = async () => {
    const url = window.location.href;
    try { if (navigator.share) await navigator.share({ title: 'Multijogo · Vyra', url }); else await navigator.clipboard.writeText(url); } catch { /* cancelado */ }
  };
  const nLive = ids.filter((i) => liveMap.has(i)).length;

  return (
    <>
      <div className="mj-top">
        <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>Multijogo</motion.h1>
        <span className="mj-sub">{ids.length ? `${ids.length} ${ids.length === 1 ? 'jogo' : 'jogos'}${nLive ? ` · ${nLive} ao vivo` : ''}` : 'Até 4 jogos lado a lado, com aviso de gol em cada um'}</span>
        <div className="mj-tools">
          <button type="button" className={`chip ${picking && !swap ? 'on' : ''}`} onClick={() => { setSwap(null); setPicking((v) => !v); }}>{picking && !swap ? 'Fechar' : '+ Jogos'}</button>
          <button type="button" className={`chip ${sound ? 'on' : ''}`} onClick={toggleSound} aria-pressed={sound} title="Apito quando sair gol">{sound ? '🔊 Som' : '🔇 Som'}</button>
          {ids.length > 0 && <button type="button" className="chip" onClick={share}>Compartilhar</button>}
        </div>
      </div>
      <AnimatePresence initial={false}>
        {(picking || !ids.length) && (
          <motion.div key="pick" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} style={{ overflow: 'hidden' }}>
            <Picker chosen={ids} onToggle={toggle} comps={comps || []} agenda={agenda} live={live} swap={swap}
              onClose={ids.length || swap ? () => { setPicking(false); setSwap(null); } : null} />
          </motion.div>
        )}
      </AnimatePresence>
      {ids.length > 0 && (
        <motion.div layout className={`mj-grid n${ids.length} ${focus ? 'has-focus' : ''}`}>
          {ids.map((id) => (
            <Tile key={id} id={id} live={liveMap} comps={comps || []} sound={sound} focus={focus === id}
              onFocus={() => setFocus(focus === id ? null : id)} onRemove={() => { setIds(ids.filter((x) => x !== id)); if (focus === id) setFocus(null); }}
              onSwap={() => { setSwap(id); setPicking(true); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
          ))}
        </motion.div>
      )}
      {ids.length === 1 && !picking && <p className="mj-hint">Adicione mais um jogo em <b>+ Jogos</b> para ver lado a lado.</p>}
    </>
  );
}
