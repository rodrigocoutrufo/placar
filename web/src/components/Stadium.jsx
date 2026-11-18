// Estádio do clube: vista aérea em 3D (gira 360°, inclina e aproxima), foto e, se houver chave, Street View 360°.
// A vista 3D é um "chão" de imagens de satélite (Esri World Imagery, grátis com atribuição) inclinado com CSS 3D:
// não precisa de biblioteca de mapas nem de chave.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { useApi } from '../lib/api.js';
import { Panel, Crest, ease } from './ui.jsx';

const Z = 18, TILE = 256, N = 7; // zoom do satélite e grade de 7x7 imagens (~1 km de lado)
const TILE_URL = (x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${Z}/${y}/${x}`;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function tileXY(lat, lon) {
  const n = 2 ** Z;
  return [((lon + 180) / 360) * n, ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n];
}

function Aerial({ lat, lon, team, name }) {
  const reduce = useReducedMotion();
  const [fx, fy] = tileXY(lat, lon);
  const x0 = Math.floor(fx) - (N >> 1), y0 = Math.floor(fy) - (N >> 1);
  const px = (fx - x0) * TILE, py = (fy - y0) * TILE; // posição do estádio dentro do chão
  const tiles = useMemo(() => {
    const out = [];
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) out.push([i, j, TILE_URL(x0 + i, y0 + j)]);
    return out;
  }, [x0, y0]);

  const start = () => ({ bearing: -20, tilt: 58, zoom: box.current ? clamp(box.current.clientWidth / 820, 0.6, 1) : 1 }); // celular começa mais afastado
  const view = useRef({ bearing: -20, tilt: 58, zoom: 1 });
  const [, force] = useState(0);
  const [orbit, setOrbit] = useState(!reduce);
  const [hint, setHint] = useState(true);
  useEffect(() => { if (hint !== 'ctrl') return undefined; const t = setTimeout(() => setHint(false), 1800); return () => clearTimeout(t); }, [hint]);
  const plane = useRef(null), pin = useRef(null), box = useRef(null);
  const apply = () => {
    const { bearing, tilt, zoom } = view.current;
    if (plane.current) plane.current.style.transform = `translate(-${px}px, -${py}px) rotateX(${tilt}deg) rotateZ(${bearing}deg) scale(${zoom})`;
    if (pin.current) pin.current.style.transform = `translate(-50%, -100%) scale(${0.85 + zoom * 0.15})`;
  };
  useEffect(() => { view.current = start(); apply(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(apply); // eslint-disable-line react-hooks/exhaustive-deps

  // giro automático lento até a pessoa mexer
  useEffect(() => {
    if (!orbit) return undefined;
    let raf, last = performance.now();
    const step = (t) => { view.current.bearing += (t - last) * 0.006; last = t; apply(); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [orbit]); // eslint-disable-line react-hooks/exhaustive-deps

  // arrastar gira (horizontal) e inclina (vertical); dois dedos ou a roda do mouse aproximam
  const ptrs = useRef(new Map());
  const pinch = useRef(0);
  const down = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    setOrbit(false); setHint(false);
  };
  const move = (e) => {
    const p = ptrs.current.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p[0], dy = e.clientY - p[1];
    ptrs.current.set(e.pointerId, [e.clientX, e.clientY]);
    const v = view.current;
    if (ptrs.current.size >= 2) {
      const [a, b] = [...ptrs.current.values()];
      const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch.current) v.zoom = clamp(v.zoom * (d / pinch.current), 0.6, 2.4);
      pinch.current = d;
    } else {
      v.bearing += dx * 0.35;
      v.tilt = clamp(v.tilt - dy * 0.25, 0, 72);
    }
    apply();
  };
  const up = (e) => { ptrs.current.delete(e.pointerId); if (ptrs.current.size < 2) pinch.current = 0; };
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    // só com Ctrl (ou o gesto de pinça do touchpad, que chega como Ctrl): sem ele, a roda continua rolando a página
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) { setHint('ctrl'); return; }
      e.preventDefault(); view.current.zoom = clamp(view.current.zoom * (e.deltaY < 0 ? 1.1 : 0.9), 0.6, 2.4); setHint(false); apply();
    };
    el.addEventListener('wheel', wheel, { passive: false }); // passivo não deixa impedir o zoom da página no Ctrl+roda
    return () => el.removeEventListener('wheel', wheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const nudge = (k, d) => {
    const v = view.current;
    if (k === 'b') v.bearing += d; else if (k === 'z') v.zoom = clamp(v.zoom * d, 0.6, 2.4); else v.tilt = clamp(v.tilt + d, 0, 72);
    setOrbit(false); setHint(false); apply(); force((n) => n + 1);
  };
  const reset = () => { view.current = start(); apply(); setOrbit(!reduce); };
  const key = (e) => {
    const map = { ArrowLeft: ['b', -15], ArrowRight: ['b', 15], ArrowUp: ['t', 6], ArrowDown: ['t', -6], '+': ['z', 1.15], '=': ['z', 1.15], '-': ['z', 0.87] };
    if (map[e.key]) { e.preventDefault(); nudge(...map[e.key]); }
  };

  return (
    <div className="st3d" ref={box} tabIndex={0} onKeyDown={key} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      role="application" aria-label={`Vista aérea em 3D de ${name}. Arraste para girar e inclinar; use as setas e + ou - no teclado.`}>
      <div className="st3d-stage">
        <div className="st3d-plane" ref={plane} style={{ width: N * TILE, height: N * TILE, transformOrigin: `${px}px ${py}px` }}>
          {tiles.map(([i, j, u]) => <img key={u} src={u} alt="" draggable={false} style={{ left: i * TILE, top: j * TILE }} />)}
          <span className="st3d-ring" style={{ left: px, top: py }} />
        </div>
      </div>
      <span className="st3d-fog" />
      <div className="st3d-pinwrap"><div className="st3d-pin" ref={pin}><span className="st3d-badge"><Crest t={team} size={30} /></span><b>{name}</b></div></div>
      <AnimatePresence>
        {hint && <motion.span key={String(hint)} className="st3d-hint" initial={{ opacity: 0, y: 8, x: '-50%' }} animate={{ opacity: 1, y: 0, x: '-50%' }} exit={{ opacity: 0 }} transition={{ delay: hint === 'ctrl' ? 0 : 0.8 }}>
          {hint === 'ctrl' ? 'Use Ctrl + rolar (ou dois dedos) para aproximar' : 'Arraste para girar 360° e inclinar'}</motion.span>}
      </AnimatePresence>
      <div className="st3d-ctrl" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" onClick={() => nudge('b', -30)} aria-label="Girar para a esquerda">⟲</button>
        <button type="button" onClick={() => nudge('b', 30)} aria-label="Girar para a direita">⟳</button>
        <button type="button" onClick={() => nudge('z', 1.2)} aria-label="Aproximar">+</button>
        <button type="button" onClick={() => nudge('z', 0.83)} aria-label="Afastar">−</button>
        <button type="button" className={orbit ? 'on' : ''} onClick={() => (orbit ? setOrbit(false) : reset())} aria-label={orbit ? 'Parar o giro' : 'Girar sozinho'}>{orbit ? '❚❚' : '▶'}</button>
      </div>
      <small className="st3d-credit">Imagens © Esri, Maxar, Earthstar Geographics</small>
    </div>
  );
}

const fmtInt = (n) => (n == null ? null : Number(n).toLocaleString('pt-BR'));

export function StadiumPanel({ name, capacity, team }) {
  const path = `/estadio?nome=${encodeURIComponent(name || '')}&clube=${encodeURIComponent((team && team.nome_popular) || '')}`;
  const q = useApi(path, { ttl: 24 * 3_600_000 });
  const s = q.data;
  const views = s ? [['3d', 'Vista 3D'], s.foto && ['foto', 'Foto'], s.streetview && ['360', 'Street View 360°']].filter(Boolean) : [];
  const [tab, setTab] = useState('3d');
  const facts = s ? [s.capacidade ? `${fmtInt(s.capacidade)} lugares` : capacity, s.inauguracao && `Inaugurado em ${s.inauguracao}`].filter(Boolean) : [capacity].filter(Boolean);

  return (
    <Panel className="stadium-x flush">
      <header className="stx-head">
        <span className="st-ico" aria-hidden>🏟</span>
        <div>
          <small>Estádio</small>
          <b>{name || (s && s.nome)}</b>
          {facts.length > 0 && <small>{facts.join(' · ')}</small>}
        </div>
        {views.length > 1 && (
          <div className="stx-tabs" role="tablist">
            {views.map(([k, l]) => (
              <button type="button" role="tab" aria-selected={tab === k} key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
                {tab === k && <motion.span layoutId="stx-tab" className="stx-tab-bg" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
                <span>{l}</span>
              </button>
            ))}
          </div>
        )}
      </header>
      {q.isLoading && <div className="stx-view stx-loading"><span>Procurando o estádio…</span></div>}
      {s && (
        <div className="stx-view">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} className="stx-pane" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease }}>
              {tab === '3d' && <Aerial lat={s.lat} lon={s.lon} team={team} name={name || s.nome} />}
              {tab === 'foto' && (
                <figure className="stx-photo">
                  <img src={s.foto} alt={`Foto do ${s.nome}`} loading="lazy" />
                  <figcaption><a href={s.foto_pagina} target="_blank" rel="noopener noreferrer">Foto: Wikimedia Commons</a></figcaption>
                </figure>
              )}
              {tab === '360' && (
                <iframe className="stx-sv" title={`Street View de ${s.nome}`} src={s.streetview} loading="lazy" allowFullScreen referrerPolicy="no-referrer-when-downgrade" />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      )}
      {s && (
        <footer className="stx-foot">
          {s.descricao && <span>{s.descricao.charAt(0).toUpperCase() + s.descricao.slice(1)}</span>}
          <span className="stx-links">
            <a href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lon}`} target="_blank" rel="noopener noreferrer">Como chegar</a>
            {s.wikipedia && <a href={s.wikipedia} target="_blank" rel="noopener noreferrer">Wikipédia</a>}
          </span>
        </footer>
      )}
    </Panel>
  );
}
