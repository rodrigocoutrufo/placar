import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useModeState, endIntro } from '../lib/mode.js';
import { LOGO } from '../lib/themes.js';
import { ease } from './ui.jsx';

// Vinhetas de entrada: luzes de largada (F1), bola na quadra (NBA), abertura com o logo (campeonatos)
export default function Intro() {
  const { intro } = useModeState();
  useEffect(() => {
    if (!intro) return undefined;
    const t = setTimeout(endIntro, intro.kind === 'f1' ? 2500 : 1700);
    return () => clearTimeout(t);
  }, [intro]);
  return (
    <AnimatePresence>
      {intro && (
        <motion.div key={intro.id} className={`intro intro-${intro.kind}`} onClick={endIntro}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          exit={intro.kind === 'f1' ? { x: '-105%', skewX: -12, transition: { duration: 0.55, ease: [0.7, 0, 0.3, 1] } }
            : intro.kind === 'nba' ? { clipPath: 'circle(0% at 50% 50%)', transition: { duration: 0.6, ease: [0.7, 0, 0.3, 1] } }
              : { clipPath: 'inset(0 0 100% 0)', transition: { duration: 0.6, ease: [0.7, 0, 0.3, 1] } }}
          style={intro.kind === 'nba' ? { clipPath: 'circle(150% at 50% 50%)' } : intro.kind === 'comp' ? { clipPath: 'inset(0 0 0% 0)' } : undefined}>
          {intro.kind === 'f1' ? <F1 /> : intro.kind === 'nba' ? <NBA /> : <Comp info={intro.info} />}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function F1() {
  const [on, setOn] = useState(0);
  const [out, setOut] = useState(false);
  useEffect(() => {
    const ts = [1, 2, 3, 4, 5].map((n) => setTimeout(() => setOn(n), 150 + n * 230));
    ts.push(setTimeout(() => setOut(true), 150 + 5 * 230 + 420));
    return () => ts.forEach(clearTimeout);
  }, []);
  return (
    <>
      <div className="i-carbon" />
      <div className="i-gantry">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`pod ${on > i && !out ? 'on' : ''}`}><i /><i /></div>
        ))}
      </div>
      <motion.div className="i-f1" initial={false} animate={out ? { opacity: 1, x: 0, skewX: 0 } : { opacity: 0, x: -80, skewX: -14 }} transition={{ duration: 0.35, ease }}>
        <img src={LOGO.f1} alt="Fórmula 1" />
        <small>Luzes apagadas. Valendo.</small>
      </motion.div>
      {out && <motion.div className="i-streak" initial={{ left: '-60%' }} animate={{ left: '130%' }} transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }} />}
    </>
  );
}

function NBA() {
  return (
    <>
      <div className="i-court" />
      <motion.div className="i-ball"
        initial={{ y: '-70vh', rotate: 0 }}
        animate={{ y: ['-70vh', '0vh', '-22vh', '0vh', '-6vh', '0vh'], rotate: 360, scaleY: [1, 0.88, 1, 0.94, 1, 1] }}
        transition={{ duration: 1, times: [0, 0.38, 0.55, 0.72, 0.84, 1], ease: 'easeIn' }}>
        <svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" /><path d="M4 50h92M50 4v92M17 17c18 18 18 48 0 66M83 17c-18 18-18 48 0 66" /></svg>
      </motion.div>
      <motion.img className="i-nba" src={LOGO.nba} alt="NBA" initial={{ opacity: 0, scale: 1.8 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.55, type: 'spring', stiffness: 260, damping: 16 }} />
    </>
  );
}

function Comp({ info }) {
  return (
    <>
      <motion.div className="i-pat" initial={{ scale: 1.15 }} animate={{ scale: 1 }} transition={{ duration: 1.8, ease: 'linear' }} />
      <motion.div className="i-glow" initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, ease }} />
      {info.logo && (
        <motion.img className="i-logo" src={info.logo} alt="" initial={{ opacity: 0, scale: 0.4, rotate: -12 }} animate={{ opacity: 1, scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 200, damping: 14 }} />
      )}
      <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.28, duration: 0.5, ease }}>{info.name}</motion.h1>
      {info.sub && <motion.small initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.42, duration: 0.5, ease }}>{info.sub}</motion.small>}
      <motion.div className="i-sweep" initial={{ left: '-30%' }} animate={{ left: '130%' }} transition={{ delay: 0.3, duration: 0.9, ease: 'easeInOut' }} />
    </>
  );
}
