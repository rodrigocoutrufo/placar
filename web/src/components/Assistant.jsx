import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useApi, post } from '../lib/api.js';
import { account } from '../lib/store.js';
import { Icon, ease } from './ui.jsx';

const SUGS = ['Quais jogos tem hoje?', 'Quem lidera o Brasileirão?', 'Quando é o próximo GP de F1?', 'Quais as chances do meu time ser campeão?'];

// texto do modelo com **negrito** e listas simples, sem HTML
function Rich({ text }) {
  const lines = String(text || '').split('\n');
  const out = [];
  let list = [];
  const flush = () => { if (list.length) { out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{bold(l)}</li>)}</ul>); list = []; } };
  const bold = (s) => s.split(/\*\*(.+?)\*\*/g).map((x, i) => (i % 2 ? <b key={i}>{x}</b> : x));
  lines.forEach((l) => { const m = l.match(/^\s*(?:[-•*]|\d+\.)\s+(.*)/); if (m) list.push(m[1]); else { flush(); if (l.trim()) out.push(<p key={out.length}>{bold(l)}</p>); } });
  flush();
  return <>{out}</>;
}

export default function Assistant() {
  const { data: st } = useApi('/ia/status', { ttl: 600_000 });
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState(() => { try { return JSON.parse(sessionStorage.getItem('placar.ask') || '[]'); } catch { return []; } });
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [secs, setSecs] = useState(0);
  const end = useRef(null);
  useEffect(() => { try { sessionStorage.setItem('placar.ask', JSON.stringify(hist.slice(-12))); } catch { /* */ } end.current && end.current.scrollIntoView({ block: 'end' }); }, [hist, busy]);
  useEffect(() => { if (!busy) return undefined; setSecs(0); const t = setInterval(() => setSecs((s) => s + 1), 1000); return () => clearInterval(t); }, [busy]);
  if (!st || !st.ativo) return null;

  const send = async (text) => {
    const pergunta = (text ?? q).trim();
    if (!pergunta || busy) return;
    setQ(''); setBusy(true);
    const before = hist;
    setHist([...before, { role: 'user', content: pergunta }]);
    try {
      const d = await post('/ia/perguntar', { pergunta, historico: before.slice(-6) });
      setHist((h) => [...h, { role: 'assistant', content: d.resposta }]);
    } catch (e) {
      setHist((h) => [...h, { role: 'assistant', error: true, content: e.status === 401 ? 'Entre na sua conta para usar o assistente.' : e.message }]);
    } finally { setBusy(false); }
  };

  return (
    <>
      <motion.button className="ask-fab" onClick={() => setOpen((o) => !o)} whileHover={{ y: -2 }} whileTap={{ scale: 0.96 }} aria-label="Pergunte ao Placar">
        {Icon.chat}<span>{open ? 'Fechar' : 'Pergunte ao Placar'}</span>
      </motion.button>
      <AnimatePresence>
        {open && (
          <motion.aside className="ask" initial={{ opacity: 0, y: 30, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 20, scale: 0.98 }} transition={{ duration: 0.35, ease }}>
            <header><b>Pergunte ao Placar</b><small>Respostas com os dados do site · {st.provedor === 'gemini' ? 'Gemini' : st.local ? 'IA local' : 'Claude'}</small></header>
            <div className="ask-body">
              {!hist.length && (
                <div className="ask-sugs">{SUGS.map((s) => <button key={s} onClick={() => send(s)}>{s}</button>)}</div>
              )}
              {hist.map((m, i) => (
                <motion.div key={i} className={`msg ${m.role} ${m.error ? 'err' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  {m.role === 'assistant' ? <Rich text={m.content} /> : m.content}
                  {m.error && !account.user && <a href="#/entrar">Entrar</a>}
                </motion.div>
              ))}
              {busy && <div className="msg assistant typing"><i /><i /><i /><small>{secs}s</small></div>}
              <div ref={end} />
            </div>
            <form onSubmit={(e) => { e.preventDefault(); send(); }}>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pergunte sobre jogos, tabelas, F1, NBA…" maxLength={500} />
              <button disabled={busy || !q.trim()}>Enviar</button>
            </form>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  );
}
