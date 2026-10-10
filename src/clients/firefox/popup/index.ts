import { renderFly } from '../../shared/portrait';
import { validToken, type FirefoxMessage, type FirefoxState } from '../messages';
import './style.css';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const token = $<HTMLInputElement>('token');
const start = $<HTMLButtonElement>('start');
const stop = $<HTMLButtonElement>('stop');
const forget = $<HTMLButtonElement>('forget');
let latest: FirefoxState | undefined;
let busy = false;
let refreshing = false;
let localError = '';
const names = { idle: 'Detenida', connecting: 'Conectando', loading: 'Cargando cerebro', online: 'En línea', paused: 'Control cedido', error: 'Error' };
const send = (message: FirefoxMessage) => browser.runtime.sendMessage(message);
function controls() {
  start.disabled = busy || Boolean(latest?.enabled) || (!token.value.trim() && !latest?.hasToken);
  stop.disabled = busy || (!latest?.enabled && latest?.status.state !== 'error');
  forget.disabled = busy || !latest?.hasToken;
  token.disabled = Boolean(latest?.enabled);
}
function error(message: string) { localError = message; $('detail').textContent = message; $('status').textContent = 'Error'; $('status').dataset.kind = 'error'; }
async function refresh() {
  if (refreshing || busy) return;
  refreshing = true;
  try {
    latest = await send({ type: 'GET_STATE' }) as FirefoxState;
    $('status').textContent = names[latest.status.state];
    $('status').dataset.kind = latest.status.state;
    $('detail').textContent = latest.status.detail;
    $('credential').textContent = latest.hasToken ? 'Token guardado. Deja el campo vacío para reutilizarlo.' : 'Crea un token en tu cuenta de moscas.lol.';
    $('activity').textContent = latest.activity ? `${latest.activity.neurons.toLocaleString('es')} neuronas · tick ${latest.activity.tick.toLocaleString('es')}` : '';
    if (localError) error(localError);
    renderFly(latest.fly);
    controls();
  } catch { error('No se pudo consultar el cerebro. Vuelve a abrir el panel.'); }
  finally { refreshing = false; }
}
async function command(message: FirefoxMessage) {
  busy = true; controls();
  try {
    const result = await send(message);
    if (result?.error) { error(result.error); return; }
    localError = '';
    token.value = '';
    if (message.type === 'START') $<HTMLDetailsElement>('connection').open = false;
    if (message.type === 'FORGET') $<HTMLDetailsElement>('connection').open = true;
  } catch { error('No se pudo comunicar con el cerebro.'); return; }
  finally { busy = false; controls(); }
  await refresh();
}
token.addEventListener('input', () => { localError = ''; controls(); });
start.onclick = () => {
  const value = token.value.trim();
  if (value && !validToken(value)) { error('Revisa el token de dispositivo.'); return; }
  void command({ type: 'START', token: value || undefined });
};
stop.onclick = () => void command({ type: 'STOP' });
forget.onclick = () => void command({ type: 'FORGET' });
$('garden').onclick = () => { void send({ type: 'OPEN_GARDEN' }).catch(() => error('No se pudo abrir el jardín.')); };
window.addEventListener('pagehide', () => { token.value = ''; clearInterval(timer); });
const timer = setInterval(() => void refresh(), 750);
void refresh();
