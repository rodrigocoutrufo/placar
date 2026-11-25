// Miniatura de um resultado da busca: logo do campeonato, escudo do time ou foto do jogador
// (sem foto na ESPN: escudo do clube; sem escudo: iniciais).
import { useState } from 'react';
import { CompLogo, Crest } from './ui.jsx';

const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

export function HitThumb({ x, size = 22 }) {
  const [step, setStep] = useState(0);
  if (x.tipo === 'campeonato') return <CompLogo c={x} size={size} />;
  if (x.tipo === 'time') return <Crest t={{ escudo: x.img }} size={size} />;
  const src = [x.img, x.time_logo].filter(Boolean)[step];
  if (!src) return <span className="hit-face ini" style={{ width: size, height: size, fontSize: size * 0.4 }}>{initials(x.nome)}</span>;
  return <img className={`hit-face ${src === x.time_logo ? 'logo' : ''}`} src={src} width={size} height={size} alt="" loading="lazy" onError={() => setStep((s) => s + 1)} />;
}
