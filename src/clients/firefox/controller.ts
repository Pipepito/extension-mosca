import type { MoskaRunner } from '../../core/runner';
import type { RunnerStatus } from '../../core/types';
import { SERVICE_URL, validToken, type Settings, type FirefoxState } from './messages';

type Runner = Pick<MoskaRunner, 'start' | 'startWhenAvailable' | 'stop' | 'snapshot' | 'neuralSnapshot'>;
export type Store = { read(): Promise<unknown>; write(settings: Settings): Promise<void> };

/** Serializa escrituras; Detener invalida también cualquier arranque pendiente. */
export class FirefoxController {
  private settings: Settings = { enabled: false, token: '' };
  private revision = 0;
  private disposed = false;
  private writable = false;
  private queue: Promise<unknown> = Promise.resolve();
  private lastBeat = 0;
  private lastTick = -1;
  private lastProgress = 0;
  private lastHealthCheck = 0;
  status: RunnerStatus = { state: 'idle', detail: 'Introduce un token de dispositivo para iniciar.', updatedAt: Date.now() };
  constructor(private store: Store, private runner: Runner) {}

  restore() {
    const revision = this.revision;
    return this.enqueue(async () => {
      try {
        const saved = await this.store.read();
        if (saved !== undefined && (!saved || typeof saved !== 'object' ||
          typeof (saved as Settings).enabled !== 'boolean' ||
          (((saved as Settings).enabled || (saved as Settings).token !== '') && !validToken((saved as Settings).token)))) throw new Error();
        this.writable = true;
        if (this.disposed || revision !== this.revision) return;
        this.settings = saved as Settings ?? { enabled: false, token: '' };
        if (this.settings.enabled && this.settings.token) this.activate(true);
      } catch {
        this.fail('No se pudo leer la configuración. No se iniciará el cerebro ni se sobrescribirán los datos.');
      }
    });
  }

  start(token?: string) {
    const revision = this.revision;
    return this.enqueue(async () => {
      if (this.disposed || revision !== this.revision) return;
      if (!this.writable) throw new Error('No se puede guardar la configuración.');
      const next = { enabled: true, token: token?.trim() || this.settings.token };
      if (!validToken(next.token)) throw new Error('Revisa el token de dispositivo.');
      // Dos popups no crean sesiones competidoras ni solicitan tickets repetidos.
      if (this.settings.enabled) return;
      await this.persist(next);
      if (this.disposed || revision !== this.revision) return;
      this.settings = next;
      this.activate(false);
    });
  }

  stop(forget = false) {
    ++this.revision;
    this.settings.enabled = false;
    this.runner.stop();
    this.status = { state: 'idle', detail: 'Cerebro detenido. No se reactivará al abrir Firefox.', updatedAt: Date.now() };
    return this.enqueue(async () => {
      if (!this.writable) {
        this.fail('Cerebro detenido; no se pudo guardar la desactivación. Repara el almacenamiento antes de reiniciar Firefox.');
        throw new Error(this.status.detail);
      }
      // Leer tras escrituras anteriores conserva el token de un START cancelado.
      let saved: Settings | undefined;
      try { saved = await this.store.read() as Settings | undefined; }
      catch {
        this.fail('Cerebro detenido; no se pudo guardar la desactivación. Repara el almacenamiento antes de reiniciar Firefox.');
        throw new Error(this.status.detail);
      }
      const next = { enabled: false, token: forget ? '' : this.settings.token || saved?.token || '' };
      await this.persist(next);
      this.settings = next;
    });
  }

  snapshot(): FirefoxState {
    const activity = this.runner.neuralSnapshot();
    return { enabled: this.settings.enabled, hasToken: Boolean(this.settings.token),
      status: this.status, fly: this.runner.snapshot(),
      activity: activity && { tick: activity.tick, neurons: activity.neurons, session: activity.session } };
  }

  /** Firefox no expone eventos de energía: detectar una pausa larga y renovar la baseline. */
  heartbeat(now = Date.now()) {
    const gap = this.lastBeat !== 0 && (now - this.lastBeat > 15_000 || now < this.lastBeat);
    this.lastBeat = now;
    if (!this.settings.enabled || this.disposed) return;
    if (!gap && now >= this.lastHealthCheck && now - this.lastHealthCheck < 2_000) return;
    this.lastHealthCheck = now;
    const activity = this.runner.neuralSnapshot();
    if (!activity || activity.tick !== this.lastTick) {
      this.lastProgress = now;
      this.lastTick = activity?.tick ?? -1;
    }
    if (gap || (activity && activity.neurons > 0 && this.status.state !== 'loading' && now - this.lastProgress > 15_000)) {
      this.runner.stop();
      this.activate(true);
    }
  }

  dispose() {
    this.disposed = true;
    ++this.revision;
    this.runner.stop();
  }
  private activate(passive: boolean) {
    this.lastTick = -1;
    this.lastProgress = Date.now();
    const config = { serverUrl: SERVICE_URL, token: this.settings.token };
    void (passive ? this.runner.startWhenAvailable(config) : this.runner.start(config))
      .catch(() => this.fail('No se pudo iniciar el cerebro. Detén la sesión y vuelve a intentarlo.'));
  }
  private enqueue(operation: () => Promise<void>) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
  private async persist(next: Settings) {
    try { await this.store.write(next); }
    catch { this.fail('No se pudo guardar. Si has detenido el cerebro, evita reiniciar Firefox hasta guardar la desactivación.'); throw new Error(this.status.detail); }
  }
  private fail(detail: string) { this.status = { state: 'error', detail, updatedAt: Date.now() }; }
}
