// Botão "Compartilhar" do placar e o modal com a prévia do card (story, post, quadrado).
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { drawCard, FORMATS, cardFileName } from '../lib/sharecard.js';
import { ease } from './ui.jsx';

const shareIco = <svg viewBox="0 0 24 24" className="ico"><circle cx="18" cy="5.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="6" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><circle cx="18" cy="18.5" r="2.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" stroke="currentColor" strokeWidth="1.8" /></svg>;

export function ShareButton({ p, camp }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <motion.button type="button" className="sb-share" onClick={() => setOpen(true)} whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}>
        {shareIco}<span>Compartilhar</span>
      </motion.button>
      {createPortal(<AnimatePresence>{open && <ShareModal key="m" p={p} camp={camp} onClose={() => setOpen(false)} />}</AnimatePresence>, document.body)}
    </>
  );
}

const toBlob = (c) => new Promise((r) => c.toBlob(r, 'image/png'));

function ShareModal({ p, camp, onClose }) {
  const ref = useRef(null);
  const [fmt, setFmt] = useState('story');
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState('');
  const [blob, setBlob] = useState(null);

  // redesenha quando muda o formato ou o placar (jogo ao vivo)
  const key = `${fmt}|${p.placar_mandante}|${p.placar_visitante}|${p.status}|${((p.gols || {}).mandante || []).length}|${((p.gols || {}).visitante || []).length}`;
  useEffect(() => {
    let alive = true;
    setBusy(true); setBlob(null);
    drawCard(ref.current, p, camp, fmt).then((c) => toBlob(c)).then((b) => { if (alive) { setBlob(b); setBusy(false); } })
      .catch(() => { if (alive) { setBusy(false); setMsg('Não foi possível gerar a imagem.'); } });
    return () => { alive = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    const prev = document.body.style.overflow; document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = prev; };
  }, [onClose]);
  useEffect(() => { if (!msg) return undefined; const t = setTimeout(() => setMsg(''), 2600); return () => clearTimeout(t); }, [msg]);

  const name = cardFileName(p);
  const file = blob && new File([blob], name, { type: 'image/png' });
  const canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
  const canCopy = !!(blob && navigator.clipboard && window.ClipboardItem);
  const title = `${p.time_mandante.nome_popular} ${p.placar_mandante ?? ''} × ${p.placar_visitante ?? ''} ${p.time_visitante.nome_popular}`.replace(/\s+/g, ' ');

  const share = async () => {
    try { await navigator.share({ files: [file], title, text: title }); } catch (e) { if (e && e.name !== 'AbortError') setMsg('O compartilhamento falhou. Tente baixar a imagem.'); }
  };
  const download = () => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMsg('Imagem baixada.');
  };
  const copy = async () => {
    try { await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': blob })]); setMsg('Imagem copiada. É só colar na conversa.'); } catch { setMsg('O navegador não deixou copiar. Use "Baixar".'); }
  };

  return (
    <motion.div className="share-back" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <motion.div className="share-box" role="dialog" aria-modal="true" aria-label="Compartilhar placar" onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 30, scale: 0.97 }} transition={{ duration: 0.35, ease }}>
        <header className="share-head">
          <b>Compartilhar placar</b>
          <button type="button" className="share-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <div className="share-body">
          <div className={`share-prev f-${fmt}`}>
            <canvas ref={ref} />
            <AnimatePresence>{busy && <motion.span className="share-load" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />}</AnimatePresence>
          </div>
          <div className="share-side">
            <div className="share-fmts">
              {Object.entries(FORMATS).map(([k, f]) => (
                <button type="button" key={k} className={k === fmt ? 'on' : ''} onClick={() => setFmt(k)}>
                  {k === fmt && <motion.span layoutId="share-fmt" className="share-fmt-bg" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                  <b>{f.label}</b><small>{f.hint}</small>
                </button>
              ))}
            </div>
            <div className="share-acts">
              {canShare && <button type="button" className="btn primary" disabled={busy} onClick={share}>Compartilhar</button>}
              <button type="button" className={`btn ${canShare ? '' : 'primary'}`} disabled={busy || !blob} onClick={download}>Baixar imagem</button>
              {canCopy && <button type="button" className="btn" disabled={busy} onClick={copy}>Copiar imagem</button>}
            </div>
            <AnimatePresence>{msg && <motion.p className="share-msg" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>{msg}</motion.p>}</AnimatePresence>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
