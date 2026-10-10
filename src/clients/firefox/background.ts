import { MoskaRunner } from '../../core/runner';
import { webClock } from '../../adapters/web/clock';
import { createDeviceClient } from '../../adapters/web/device-client';
import { FlyWireAdapter } from '../../adapters/web/flywire';
import { volunteerCapacity } from '../../adapters/web/volunteer-capacity';
import { FirefoxController } from './controller';
import { lifecycleClock } from './clock';
import { SERVICE_URL, type FirefoxMessage } from './messages';

const runner = new MoskaRunner({
  device: createDeviceClient((input, init) => fetch(input, { ...init, credentials: 'omit' })),
  // Detectar el despertar antes de avanzar la física o procesar un timeout antiguo.
  clock: lifecycleClock(webClock, () => controller.heartbeat()),
  createBrain: (rate) => new FlyWireAdapter((path) => browser.runtime.getURL(path), rate),
  volunteerCapacity: volunteerCapacity(),
  onStatus: (status) => {
    // Los cuerpos remotos y errores de red nunca se propagan a la interfaz.
    controller.status = status.state === 'error'
      ? { state: 'error', detail: 'No se pudo conectar. Comprueba la red y que el token siga vigente.', updatedAt: status.updatedAt }
      : status;
  },
});
const controller = new FirefoxController({
  read: async () => (await browser.storage.local.get('settings')).settings,
  write: async (settings) => { await browser.storage.local.set({ settings }); },
}, runner);
const ready = controller.restore();
const heartbeat = setInterval(() => controller.heartbeat(), 2_000);

browser.runtime.onMessage.addListener((message: FirefoxMessage, sender) => {
  if (sender.id !== browser.runtime.id || sender.url !== browser.runtime.getURL('popup.html')) return;
  if (!message || typeof message !== 'object') return;
  // STOP se aplica inmediatamente, incluso durante una lectura o escritura pendiente.
  if (message.type === 'STOP' || message.type === 'FORGET')
    return controller.stop(message.type === 'FORGET').then(() => ({ ok: true }), replyError);
  return ready.then(async () => {
    switch (message.type) {
      case 'GET_STATE': return controller.snapshot();
      case 'START':
        if (message.token !== undefined && typeof message.token !== 'string') return { error: 'Token no válido.' };
        await controller.start(message.token);
        return { ok: true };
      case 'OPEN_GARDEN': await browser.tabs.create({ url: SERVICE_URL }); return { ok: true };
    }
  }).catch(replyError);
});
function replyError() { return { error: 'No se pudo guardar el cambio. Revisa el token y el almacenamiento de Firefox.' }; }
window.addEventListener('unload', () => { clearInterval(heartbeat); controller.dispose(); }, { once: true });
