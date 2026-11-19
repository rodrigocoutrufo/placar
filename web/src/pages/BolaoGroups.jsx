// Bolão com amigos: grupos privados (código de convite), ranking da semana e geral, palpites dos amigos.
// As regras ficam no servidor (core/bolao.py): palpite fecha no começo do jogo e os pontos vêm do resultado real.
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { get, post } from '../lib/api.js';
import { account, useStoreVersion } from '../lib/store.js';
import { Panel, Head, Skel, Empty, Stagger, Item, Crest, CountUp, ease } from '../components/ui.jsx';

const inviteUrl = (code) => `${window.location.origin}/#/bolao/entrar/${code}`;
const medal = (i) => (i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}º`);

function NeedLogin({ next = 'bolao' }) {
  return (
    <Panel className="bl-login">
      <b>Entre para jogar com os amigos</b>
      <span>O ranking é entre pessoas: cada um precisa de uma conta (grátis, dá para entrar com o Google).</span>
      <Link className="btn primary" to={`/entrar?next=${next}`}>Entrar ou criar conta</Link>
    </Panel>
  );
}

function useMe() { useStoreVersion(); return account.user; }

/* ---------- lista de grupos, criar e entrar ---------- */
export function BolaoHome() {
  const u = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const groups = useQuery({ queryKey: ['bolao-grupos'], queryFn: () => get('/bolao/grupos'), enabled: !!u, staleTime: 30_000 });
  const [nome, setNome] = useState('');
  const [codigo, setCodigo] = useState('');
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  const run = (kind, fn) => async (e) => {
    e.preventDefault(); setBusy(true); setErr({});
    try { const g = await fn(); qc.invalidateQueries({ queryKey: ['bolao-grupos'] }); navigate(`/bolao/grupo/${g.id}`); } catch (ex) { setErr({ [kind]: ex.message }); } finally { setBusy(false); }
  };
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>Bolão com amigos</motion.h1>
      <p className="bl-intro">Crie um grupo, mande o código para a turma e disputem rodada a rodada. Placar exato vale 3 pontos; acertar o vencedor ou o empate, 1. Os palpites são os mesmos do <Link to="/minijogos/palpites">Bolão</Link> e fecham quando o jogo começa.</p>
      {!account.loaded ? <Skel h={200} /> : !u ? <NeedLogin /> : (
        <div className="grid-main">
          <div className="col">
            <Panel>
              <Head sub={groups.data ? `${groups.data.grupos.length} ${groups.data.grupos.length === 1 ? 'grupo' : 'grupos'}` : ''}>Seus grupos</Head>
              {!groups.data ? <Skel h={120} /> : groups.data.grupos.length ? (
                <Stagger className="bl-groups">{groups.data.grupos.map((g) => (
                  <Item key={g.id}><Link to={`/bolao/grupo/${g.id}`} className="bl-gcard">
                    <b>{g.nome}</b>
                    <span>{g.membros} {g.membros === 1 ? 'pessoa' : 'pessoas'}{g.lider ? ` · líder: ${g.lider}` : ''}</span>
                    <em>{g.posicao ? `${g.posicao}º` : '–'}<small>{g.meus_pontos} pts</small></em>
                  </Link></Item>
                ))}</Stagger>
              ) : <Empty>Você ainda não está em nenhum grupo. Crie um ou entre com um código.</Empty>}
            </Panel>
          </div>
          <aside className="col side">
            <Panel>
              <Head>Criar grupo</Head>
              <form className="bl-form" onSubmit={run('nome', () => post('/bolao/grupos', { nome }))}>
                <input value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome (ex.: Firma, Família, Pelada de quinta)" maxLength={40} aria-label="Nome do grupo" />
                {err.nome && <small className="err">{err.nome}</small>}
                <button className="btn primary" disabled={busy || nome.trim().length < 2}>Criar</button>
              </form>
            </Panel>
            <Panel>
              <Head>Entrar com código</Head>
              <form className="bl-form" onSubmit={run('codigo', () => post('/bolao/entrar', { codigo }))}>
                <input value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} placeholder="Ex.: QD9S8V" maxLength={8} aria-label="Código do grupo" className="code" />
                {err.codigo && <small className="err">{err.codigo}</small>}
                <button className="btn primary" disabled={busy || codigo.trim().length < 6}>Entrar</button>
              </form>
            </Panel>
          </aside>
        </div>
      )}
    </>
  );
}

/* ---------- link de convite: entra e abre o grupo ---------- */
export function BolaoJoin() {
  const { codigo } = useParams();
  const u = useMe();
  const navigate = useNavigate();
  const [err, setErr] = useState(null);
  useEffect(() => {
    if (!u) return;
    post('/bolao/entrar', { codigo }).then((g) => navigate(`/bolao/grupo/${g.id}`, { replace: true })).catch((e) => setErr(e.message));
  }, [u, codigo]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <motion.h1 className="page-title" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>Convite para o bolão</motion.h1>
      {!account.loaded ? <Skel h={160} /> : !u ? <NeedLogin next={`bolao/entrar/${codigo}`} /> : err ? <Panel><Empty>{err} <Link to="/bolao">Ver meus grupos</Link></Empty></Panel> : <Skel h={160} />}
    </>
  );
}

/* ---------- um grupo ---------- */
function Ranking({ rows, me, cols = 'semana' }) {
  if (!rows.length) return <Empty>Ninguém pontuou ainda.</Empty>;
  return (
    <Stagger className="bl-rank">
      {rows.map((r, i) => (
        <Item key={r.id} className={`bl-row ${r.id === me ? 'me' : ''}`}>
          <span className="bl-pos">{medal(i)}</span>
          {r.avatar ? <img className="bl-av" src={r.avatar} alt="" referrerPolicy="no-referrer" /> : <span className="bl-av ini">{String(r.nome || '?')[0].toUpperCase()}</span>}
          <span className="bl-who"><b>{r.nome}{r.id === me ? ' (você)' : ''}</b>{cols === 'geral' && <small>{r.exatos} exatos · {r.acertos} acertos · {r.palpites} palpites</small>}</span>
          <b className="bl-pts"><CountUp value={r.pontos} /><small>pts</small></b>
        </Item>
      ))}
    </Stagger>
  );
}

export function BolaoGroup() {
  const { id } = useParams();
  const u = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['bolao-grupo', id], queryFn: () => get(`/bolao/grupos/${id}`), enabled: !!u, staleTime: 30_000, refetchInterval: 60_000 });
  const [tab, setTab] = useState('semana');
  const [wk, setWk] = useState(0);
  const [copied, setCopied] = useState(false);
  if (!account.loaded) return <Skel h={300} />;
  if (!u) return <NeedLogin next={`bolao/grupo/${id}`} />;
  if (q.isError) return <Panel><Empty>{q.error.message} <Link to="/bolao">Ver meus grupos</Link></Empty></Panel>;
  const g = q.data;
  if (!g) return <Skel h={360} />;
  const invite = async () => {
    const url = inviteUrl(g.codigo), text = `Entra no meu bolão "${g.nome}" no Vyra! Código: ${g.codigo}`;
    try {
      if (navigator.share) await navigator.share({ title: 'Bolão no Vyra', text, url });
      else { await navigator.clipboard.writeText(`${text}\n${url}`); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    } catch { /* cancelado */ }
  };
  const leave = async () => {
    if (!window.confirm(`Sair do grupo "${g.nome}"? Seus palpites continuam valendo no Bolão.`)) return;
    await post(`/bolao/grupos/${g.id}/sair`, {}).catch(() => {});
    qc.invalidateQueries({ queryKey: ['bolao-grupos'] });
    navigate('/bolao', { replace: true });
  };
  const semana = g.semanas[wk];
  const atual = g.semanas.find((s) => s.atual);
  return (
    <>
      <section className="bl-hero">
        <div>
          <small><Link to="/bolao">Bolão com amigos</Link></small>
          <motion.h1 initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease }}>{g.nome}</motion.h1>
          <span>{g.membros} {g.membros === 1 ? 'pessoa' : 'pessoas'} · desde {new Date(g.criado * 1000).toLocaleDateString('pt-BR')}</span>
        </div>
        <div className="bl-code">
          <small>Código do grupo</small>
          <b>{g.codigo}</b>
          <button type="button" className="btn primary" onClick={invite}>{copied ? 'Convite copiado!' : 'Convidar amigos'}</button>
        </div>
      </section>
      <div className="sticky-tabs"><nav className="tabs">{[['semana', 'Semana'], ['geral', 'Geral'], ['jogos', 'Palpites da turma']].map(([k, l]) => (
        <button key={k} className={`tab ${tab === k ? 'on' : ''}`} onClick={() => setTab(k)}>{l}{tab === k && <motion.span layoutId="tab-bl" className="tab-ind" />}</button>
      ))}</nav></div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }}>
          <div className="grid-main">
            <div className="col">
              {tab === 'semana' && (
                <Panel>
                  <Head sub={semana ? `${semana.periodo}${semana.atual ? ' · em andamento' : semana.vencedor ? ` · venceu ${semana.vencedor}` : ''}` : ''}>Ranking da semana</Head>
                  {g.semanas.length > 1 && (
                    <div className="bl-weeks">{g.semanas.map((s, i) => <button key={s.semana} type="button" className={`chip ${i === wk ? 'on' : ''}`} onClick={() => setWk(i)}>{s.atual ? 'Esta semana' : s.periodo}</button>)}</div>
                  )}
                  {semana ? <Ranking rows={semana.ranking} me={g.eu} /> : <Empty>A semana começa a contar quando os primeiros jogos com palpite terminarem.</Empty>}
                </Panel>
              )}
              {tab === 'geral' && <Panel><Head sub="desde a criação do grupo">Ranking geral</Head><Ranking rows={g.geral} me={g.eu} cols="geral" /></Panel>}
              {tab === 'jogos' && (
                <Panel>
                  <Head sub="os palpites aparecem quando o jogo começa">Palpites da turma</Head>
                  {g.jogos.length ? <Stagger className="bl-games">{g.jogos.map((j) => (
                    <Item key={j.partida_id} className="bl-game">
                      <Link to={`/partida/${j.partida_id}`} className="bl-gh">
                        <small>{j.campeonato}</small>
                        <span><Crest t={{ nome_popular: j.mandante, escudo: j.escudo_m }} size={22} /><b>{j.mandante}</b>
                          <em>{j.placar_m != null ? `${j.placar_m} × ${j.placar_v}` : '×'}</em><b>{j.visitante}</b><Crest t={{ nome_popular: j.visitante, escudo: j.escudo_v }} size={22} /></span>
                        <small>{j.status === 'finalizado' ? 'Encerrado' : 'Em andamento'}</small>
                      </Link>
                      <div className="bl-picks">{j.palpites.map((p) => (
                        <span key={p.nome} className={`bl-pick p${p.pts ?? 'n'}`}><b>{p.nome}</b> {p.h}×{p.a}{p.pts != null && <em>+{p.pts}</em>}</span>
                      ))}</div>
                    </Item>
                  ))}</Stagger> : <Empty>Ainda não começou nenhum jogo com palpite da turma.</Empty>}
                </Panel>
              )}
            </div>
            <aside className="col side">
              <Panel className="bl-tip">
                <b>Como pontua</b>
                <span>Placar exato: <b>3 pontos</b>. Vencedor ou empate certo: <b>1 ponto</b>. A semana vai de segunda a domingo.</span>
                <Link className="btn primary" to="/minijogos/palpites">Fazer palpites</Link>
              </Panel>
              {atual && atual.ranking[0] && atual.ranking[0].pontos > 0 && <Panel className="bl-tip"><b>Liderando esta semana</b><span>{atual.ranking[0].nome} com {atual.ranking[0].pontos} pontos</span></Panel>}
              <button type="button" className="bl-leave" onClick={leave}>Sair do grupo</button>
            </aside>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
