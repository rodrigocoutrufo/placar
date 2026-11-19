// Campeonatos que a pessoa segue (★): a página inicial mostra o que ela segue, não as ~40 ligas.
// Seguir também liga os avisos do campeonato (como nos times); o sino silencia. Fica em "placar.campeonatos".
import { store, getFavs } from './store.js';
import { getNotif, setNotif, followsTeam } from './notify.js';

const KEY = 'placar.campeonatos';
// sem nada seguido: os principais (Brasil, Conmebol, Champions e as 5 grandes ligas)
export const DEFAULT_COMPS = [10, 14, 2, 7, 9, 106, 101, 102, 103, 104, 105];

export const followedComps = () => (store.get(KEY, []) || []).map(Number);
export const followsCompHome = (id) => followedComps().includes(+id);
export const homeComps = () => (followedComps().length ? followedComps() : DEFAULT_COMPS);

export function toggleFollowComp(id) {
  const list = followedComps();
  const on = !list.includes(+id);
  store.set(KEY, on ? [...list, +id] : list.filter((x) => x !== +id));
  const raw = store.get('placar.notif', null);
  const n = getNotif();
  if (on) { // seguir liga os avisos; se a pessoa nunca mexeu nos avisos, troca o padrão (Brasileirão) pelo que ela escolheu
    if (!raw || !raw.comps) setNotif({ comps: [+id] });
    else if (!n.comps.includes(+id)) setNotif({ comps: [...n.comps, +id] });
  } else if (n.comps.includes(+id)) {
    setNotif({ comps: n.comps.filter((x) => x !== +id) });
  }
  return on;
}

// o jogo é de algo que a pessoa segue: campeonato seguido (ou os principais, se não segue nenhum) ou time seguido/avisado
const favHas = (t) => !!t && Object.values(getFavs()).some((f) => +f.time_id === +t.time_id);
export function isFollowedMatch(p, comps = homeComps()) {
  const cid = p.campeonato && +p.campeonato.campeonato_id;
  return comps.includes(cid) || favHas(p.time_mandante) || favHas(p.time_visitante) || followsTeam(p.time_mandante) || followsTeam(p.time_visitante);
}
