// Sala do jogo: a resenha da partida. Bate-papo, termômetro da torcida (reações), enquetes puxadas pelos lances e,
// depois do jogo, a nota da torcida para cada jogador. Tempo real por um canal só desta partida (/api/sala/{id}/eventos).
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { get, post } from '../lib/api.js';
import { barColors } from '../lib/format.js';
import { Panel, Head, Skel, Empty, Crest, LiveDot, ease } from '../components/ui.jsx';

const hhmm = (t) => new Date(t * 1000).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const initials = (n) => String(n || '?').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase();

function useRoom(pid) {
  const [room, setRoom] = useState(null);
  const [error, setError] = useState(null);
  const [floats, setFloats] = useState([]); // emojis subindo na tela (reações da torcida)
  const lastMinute = useRef({});
  useEffect(() => {
    let alive = true, es = null;
    get(`/sala/${pid}`).then((d) => { if (alive) { setRoom(d); lastMinute.current = d.reacoes.minuto; } }).catch((e) => alive && setError(e));
    const set = (fn) => setRoom((r) => (r ? fn(r) : r));
    if ('EventSource' in window) {
      es = new EventSource(`/api/sala/${pid}/eventos`);
      es.addEventListener('online', (e) => set((r) => ({ ...r, online: JSON.parse(e.data).online })));
      es.addEventListener('msg', (e) => {
        const m = JSON.parse(e.data);
        // o canal é igual para todos: "minha" sai da comparação com quem está logado (a mensagem pode chegar antes da resposta do envio)
        set((r) => (r.mensagens.some((x) => x.id === m.id) ? r : { ...r, mensagens: [...r.mensagens, { ...m, minha: !!(r.eu && m.autor.id === r.eu.id) }].slice(-300) }));
      });
      es.addEventListener('apagada', (e) => { const { id } = JSON.parse(e.data); set((r) => ({ ...r, mensagens: r.mensagens.filter((x) => x.id !== id) })); });
      es.addEventListener('enquete', (e) => { const p = JSON.parse(e.data); set((r) => ({ ...r, enquetes: [p, ...r.enquetes.filter((x) => x.id !== p.id)] })); });
      es.addEventListener('votos', (e) => { const v = JSON.parse(e.data); set((r) => ({ ...r, enquetes: r.enquetes.map((x) => (x.id === v.id ? { ...x, votos: v.votos } : x)) })); });
      es.addEventListener('nota', (e) => { const n = JSON.parse(e.data); set((r) => (r.notas ? { ...r, notas: { ...r.notas, jogadores: r.notas.jogadores.map((j) => (j.atleta_id === n.atleta_id ? { ...j, media: n.media, votos: n.votos } : j)) } } : r)); });
      es.addEventListener('reacoes', (e) => {
        const d = JSON.parse(e.data);
        // o que chegou de novo desde o último termômetro sobe na tela (no máximo 8 por vez)
        const burst = [];
        Object.entries(d.minuto).forEach(([em, n]) => { for (let i = 0; i < Math.min(n - (lastMinute.current[em] || 0), 3); i++) burst.push(em); });
        lastMinute.current = d.minuto;
        if (burst.length) setFloats((f) => [...f, ...burst.slice(0, 8).map((em) => ({ em, k: Math.random(), x: 10 + Math.random() * 80 }))].slice(-24));
        set((r) => ({ ...r, reacoes: d }));
      });
    }
    return () => { alive = false; if (es) es.close(); };
  }, [pid]);
  return { room, setRoom, error, floats, setFloats };
}

/* ---------- termômetro da torcida ---------- */
function Reactions({ pid, room, floats, setFloats }) {
  const [err, setErr] = useState('');
  const total = Object.values(room.reacoes.minuto).reduce((a, b) => a + b, 0);
  const send = async (em) => {
    setFloats((f) => [...f, { em, k: Math.random(), x: 10 + Math.random() * 80, mine: true }].slice(-24));
    try { await post(`/sala/${pid}/reagir`, { emoji: em }); setErr(''); } catch (e) { setErr(e.message); }
  };
  return (
    <div className="room-reac">
      <div className="room-floats" aria-hidden>
        <AnimatePresence>{floats.map((f) => (
          <motion.span key={f.k} style={{ left: `${f.x}%` }} initial={{ y: 0, opacity: 1, scale: 0.6 }} animate={{ y: -140, opacity: 0, scale: 1.4 }}
            transition={{ duration: 1.8, ease: 'easeOut' }} onAnimationComplete={() => setFloats((l) => l.filter((x) => x.k !== f.k))}>{f.em}</motion.span>
        ))}</AnimatePresence>
      </div>
      <div className="room-reac-row">
        {room.emojis.map((em) => (
          <motion.button key={em} type="button" className="room-reac-btn" whileTap={{ scale: 1.35 }} onClick={() => send(em)} aria-label={`Reagir com ${em}`}>
            <span>{em}</span><small>{room.reacoes.minuto[em] || 0}</small>
            <i style={{ width: `${total ? (100 * (room.reacoes.minuto[em] || 0)) / total : 0}%` }} />
          </motion.button>
        ))}
      </div>
      <small className="muted">{total ? `${total} reações no último minuto` : 'Reaja ao jogo: o termômetro mostra o clima da torcida agora.'}{err && ` · ${err}`}</small>
    </div>
  );
}

/* ---------- enquetes ---------- */
function Poll({ pid, e, onVoted }) {
  const [err, setErr] = useState('');
  const sum = e.votos.reduce((a, b) => a + b, 0);
  const voted = e.meu_voto != null || !e.aberta;
  const vote = async (i) => {
    try { onVoted(await post(`/sala/${pid}/votar`, { enquete: e.id, opcao: i })); setErr(''); } catch (x) { setErr(x.message); }
  };
  return (
    <div className={`room-poll ${e.aberta ? '' : 'closed'}`}>
      <b>{e.pergunta}</b>
      <div className="room-poll-opts">
        {e.opcoes.map((o, i) => {
          const pct = sum ? Math.round((100 * e.votos[i]) / sum) : 0;
          return voted ? (
            <div key={o} className={`room-poll-res ${e.meu_voto === i ? 'mine' : ''}`}>
              <motion.i initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, ease }} />
              <span>{o}</span><em>{pct}%</em>
            </div>
          ) : <button key={o} type="button" className="btn" onClick={() => vote(i)}>{o}</button>;
        })}
      </div>
      <small className="muted">{sum} {sum === 1 ? 'voto' : 'votos'}{e.aberta ? '' : ' · encerrada'}{err && ` · ${err}`}</small>
    </div>
  );
}

/* ---------- bate-papo ---------- */
function Chat({ pid, room, setRoom }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [more, setMore] = useState(room.mensagens.length >= 60);
  const box = useRef(null), stick = useRef(true);
  useEffect(() => { const b = box.current; if (b && stick.current) b.scrollTop = b.scrollHeight; }, [room.mensagens.length]);
  const onScroll = () => { const b = box.current; stick.current = b.scrollHeight - b.scrollTop - b.clientHeight < 60; };
  const send = async (e) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      const m = await post(`/sala/${pid}/mensagens`, { texto: text });
      stick.current = true;
      setRoom((r) => (r.mensagens.some((x) => x.id === m.id) ? r : { ...r, mensagens: [...r.mensagens, m] }));
      setText(''); setErr('');
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  const older = async () => {
    const first = room.mensagens[0];
    if (!first) return;
    const d = await get(`/sala/${pid}/mensagens?antes=${first.id}`);
    setMore(d.mensagens.length >= 60);
    setRoom((r) => ({ ...r, mensagens: [...d.mensagens, ...r.mensagens] }));
  };
  const act = async (kind, id) => {
    try { await post(`/sala/${pid}/${kind}`, { id }); if (kind === 'apagar') setRoom((r) => ({ ...r, mensagens: r.mensagens.filter((x) => x.id !== id) })); else setErr('Denúncia enviada. Obrigado por cuidar da resenha.'); }
    catch (x) { setErr(x.message); }
  };
  return (
    <div className="room-chat">
      <div className="room-msgs" ref={box} onScroll={onScroll} aria-live="polite">
        {more && <button type="button" className="room-older" onClick={older}>Mensagens anteriores</button>}
        {!room.mensagens.length && <Empty>Ninguém falou nada ainda. Começa a resenha!</Empty>}
        {room.mensagens.map((m) => (
          <motion.div key={m.id} className={`room-msg ${m.minha ? 'mine' : ''}`} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
            {m.autor.avatar ? <img className="room-av" src={m.autor.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="room-av">{initials(m.autor.nome)}</span>}
            <div className="room-bubble">
              <small><b>{m.autor.nome}</b> · {hhmm(m.quando)}</small>
              <p>{m.texto}</p>
            </div>
            {room.eu && (m.minha
              ? <button type="button" className="room-act" onClick={() => act('apagar', m.id)} title="Apagar a minha mensagem" aria-label="Apagar mensagem">×</button>
              : <button type="button" className="room-act" onClick={() => act('denunciar', m.id)} title="Denunciar mensagem" aria-label="Denunciar mensagem">⚑</button>)}
          </motion.div>
        ))}
      </div>
      {room.eu ? (
        <form className="room-form" onSubmit={send}>
          <input value={text} onChange={(e) => setText(e.target.value.slice(0, room.max_texto))} placeholder="Manda a resenha…" aria-label="Mensagem para a sala" />
          <span className="room-count">{room.max_texto - text.length}</span>
          <button type="submit" className="btn primary" disabled={busy || !text.trim()}>Enviar</button>
        </form>
      ) : (
        <div className="room-login"><span>Entre na sua conta para comentar.</span><Link className="btn primary" to="/entrar">Entrar</Link></div>
      )}
      {err && <p className="room-err">{err}</p>}
    </div>
  );
}

/* ---------- nota da torcida ---------- */
function Ratings({ pid, room, setRoom, p }) {
  const n = room.notas;
  const [err, setErr] = useState('');
  const [ch, ca] = barColors(p.time_mandante, p.time_visitante);
  const rate = async (j, nota) => {
    if (!room.eu) { setErr('Entre na sua conta para dar nota.'); return; }
    try {
      const r = await post(`/sala/${pid}/nota`, { atleta_id: j.atleta_id, nota });
      setRoom((x) => ({ ...x, notas: { ...x.notas, jogadores: x.notas.jogadores.map((y) => (y.atleta_id === j.atleta_id ? { ...y, ...r } : y)) } }));
      setErr('');
    } catch (x) { setErr(x.message); }
  };
  const side = (s) => n.jogadores.filter((j) => j.lado === s);
  return (
    <Panel className="room-rate">
      <Head sub={`${n.pessoas} ${n.pessoas === 1 ? 'pessoa avaliou' : 'pessoas avaliaram'}`}>Nota da torcida</Head>
      {n.craque && (
        <div className="room-craque"><small>Craque da torcida</small><b>{n.craque.nome}</b><span>{n.craque.time} · nota {String(n.craque.media).replace('.', ',')} ({n.craque.votos} votos)</span></div>
      )}
      <div className="room-rate-grid">
        {['mandante', 'visitante'].map((s) => (
          <div key={s} style={{ '--tc': s === 'mandante' ? ch : ca }}>
            <h4><Crest t={s === 'mandante' ? p.time_mandante : p.time_visitante} size={20} /> {(s === 'mandante' ? p.time_mandante : p.time_visitante).nome_popular}</h4>
            {side(s).map((j) => (
              <div key={j.atleta_id} className="room-player">
                <span className="room-pos">{j.posicao}</span>
                <b>{j.nome}</b>
                <em className={j.media >= 7 ? 'hi' : j.media && j.media < 5 ? 'lo' : ''}>{j.votos >= 1 ? String(j.media).replace('.', ',') : '–'}</em>
                <div className="room-stars" role="group" aria-label={`Nota para ${j.nome}`}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((v) => (
                    <button key={v} type="button" className={j.minha === v ? 'on' : j.minha && v < j.minha ? 'below' : ''} onClick={() => rate(j, v)} aria-label={`Nota ${v}`}>{v}</button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      {err && <p className="room-err">{err}</p>}
      <p className="foot muted">Média de quem deu nota; o craque precisa de pelo menos {n.min_votos} votos.</p>
    </Panel>
  );
}

export default function MatchRoom({ p }) {
  const pid = p.partida_id;
  const { room, setRoom, error, floats, setFloats } = useRoom(pid);
  const open = useMemo(() => (room ? room.enquetes.filter((e) => e.aberta) : []), [room]);
  const closed = useMemo(() => (room ? room.enquetes.filter((e) => !e.aberta).slice(0, 2) : []), [room]);
  if (error) return <Panel><Empty>Não foi possível abrir a sala agora. {error.message}</Empty></Panel>;
  if (!room) return <Skel h={480} />;
  const onVoted = (e) => setRoom((r) => ({ ...r, enquetes: r.enquetes.map((x) => (x.id === e.id ? e : x)) }));
  const live = p.status === 'andamento';
  return (
    <div className="room">
      {room.notas && <Ratings pid={pid} room={room} setRoom={setRoom} p={p} />}
      <div className="room-grid">
        <Panel className="room-main">
          <Head sub={`${room.online} ${room.online === 1 ? 'pessoa' : 'pessoas'} na sala agora`}>{live && <LiveDot />} Sala do jogo</Head>
          <Reactions pid={pid} room={room} floats={floats} setFloats={setFloats} />
          <Chat pid={pid} room={room} setRoom={setRoom} />
        </Panel>
        <aside className="room-side">
          {(open.length > 0 || closed.length > 0) && (
            <Panel><Head sub="puxadas pelos lances">Enquetes</Head>
              <div className="room-polls">{[...open, ...closed].map((e) => <Poll key={e.id} pid={pid} e={e} onVoted={onVoted} />)}</div>
            </Panel>
          )}
          <Panel className="note">Resenha com respeito: ofensa é recusada, links não passam e três denúncias escondem a mensagem.</Panel>
        </aside>
      </div>
    </div>
  );
}
