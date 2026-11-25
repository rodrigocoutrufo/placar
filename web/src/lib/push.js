// Avisos com o Vyra fechado (Web Push). O navegador se inscreve no serviço de push dele e o servidor manda o gol,
// o começo/fim de jogo, a NBA e a F1 por lá; o service worker (public/sw.js) mostra a notificação mesmo sem o site aberto.
// Vale por aparelho (não vai para a conta): o que avisar sai das mesmas preferências do painel de notificações.
import { post, get } from './api.js';
import { subscribe as onStore } from './store.js';
import { getNotif, alertTeams } from './notify.js';

const KEY = 'vyra.push'; // "1" = ligado neste aparelho
const flag = { get: () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } },
  set: (v) => { try { if (v) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY); } catch { /* sem armazenamento */ } } };

export const pushSupported = () => typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
export const pushOn = () => pushSupported() && flag.get() && Notification.permission === 'granted';
// iPhone/iPad: o push só existe com o Vyra instalado na tela de início
export const needsInstall = () => /iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches;

const b64ToBytes = (s) => {
  const raw = atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// só o que o servidor precisa para decidir quem recebe cada aviso
export function pushPrefs() {
  const n = getNotif();
  const teams = alertTeams();
  return {
    comps: n.comps, times: teams.map((t) => +t.time_id).filter(Boolean), nomes: teams.map((t) => t.nome_popular).filter(Boolean),
    tipos: n.tipos, nbaTodos: n.nbaTodos, nbaTimes: n.nbaTimes.map((x) => +(x && x.id != null ? x.id : x)),
    f1: n.f1, f1Pilotos: n.f1Pilotos.map((p) => p.id), f1Equipes: n.f1Equipes.map((t) => t.id),
  };
}

async function subscription(create) {
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub && create) {
    const { chave } = await get('/push/chave');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(chave) });
  }
  return sub;
}

const send = (sub) => post('/push/inscrever', { inscricao: sub.toJSON(), prefs: pushPrefs() });

// liga: pede a permissão, inscreve o aparelho e manda as preferências
export async function enablePush() {
  if (!pushSupported()) return 'unsupported';
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') return perm;
  await send(await subscription(true));
  flag.set(true);
  return 'granted';
}

export async function disablePush() {
  flag.set(false);
  try {
    const sub = await subscription(false);
    if (sub) { await post('/push/cancelar', { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
  } catch { /* já estava desligado */ }
}

export async function testPush() {
  const sub = await subscription(false);
  if (!sub) throw new Error('Este aparelho não está inscrito.');
  return post('/push/teste', { endpoint: sub.endpoint });
}

// mantém o servidor em dia: ao abrir o site e sempre que a pessoa segue ou silencia algo
let timer = null, lastSent = '';
async function sync() {
  if (!pushOn()) return;
  try {
    const sub = await subscription(true); // a inscrição pode ter sido renovada pelo navegador
    const sig = `${sub.endpoint}|${JSON.stringify(pushPrefs())}`;
    if (sig === lastSent) return;
    await send(sub);
    lastSent = sig;
  } catch { /* sem conexão: tenta na próxima mudança */ }
}
export function startPushSync() {
  if (!pushSupported()) return;
  sync();
  onStore(() => { clearTimeout(timer); timer = setTimeout(sync, 1500); });
}
