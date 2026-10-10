import { describe, expect, it, vi } from 'vitest';
import { FirefoxController, type Store } from '../src/clients/firefox/controller';
import { lifecycleClock } from '../src/clients/firefox/clock';
import { webClock } from '../src/adapters/web/clock';
import type { Settings } from '../src/clients/firefox/messages';
const token = `fly_device_${'b'.repeat(64)}`;
function setup(saved?: Settings) {
  let data: unknown = saved;
  const store: Store = { read: vi.fn(async () => structuredClone(data)), write: vi.fn(async (next) => { data = structuredClone(next); }) };
  const runner = { start: vi.fn(async () => {}), startWhenAvailable: vi.fn(async () => {}), stop: vi.fn(), snapshot: vi.fn(), neuralSnapshot: vi.fn() };
  const controller = new FirefoxController(store, runner);
  return { store, runner, controller, saved: () => data as Settings };
}
describe('ciclo de vida Firefox', () => {
  it('restaura de forma pasiva y nunca devuelve el token al popup', async () => {
    const { controller, runner } = setup({ token, enabled: true });
    await controller.restore();
    expect(runner.startWhenAvailable).toHaveBeenCalledOnce();
    expect(runner.start).not.toHaveBeenCalled();
    expect(JSON.stringify(controller.snapshot()).includes(token)).toBe(false);
  });
  it('serializa inicios simultáneos sin duplicar la sesión', async () => {
    const { controller, runner } = setup();
    await controller.restore();
    await Promise.all([controller.start(token), controller.start(token)]);
    expect(runner.start).toHaveBeenCalledOnce();
  });
  it('Detener invalida la restauración pendiente y persiste la desactivación', async () => {
    const { controller, runner, saved, store } = setup({ token, enabled: true });
    let release!: (value: unknown) => void;
    vi.mocked(store.read).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const restoring = controller.restore();
    await Promise.resolve();
    const stopping = controller.stop();
    expect(runner.stop).toHaveBeenCalledOnce();
    release({ token, enabled: true });
    await Promise.all([restoring, stopping]);
    expect(runner.startWhenAvailable).not.toHaveBeenCalled();
    expect(saved()).toEqual({ token, enabled: false });
  });
  it('Detener durante una escritura de inicio evita activar y conserva el token', async () => {
    const { controller, runner, saved, store } = setup();
    await controller.restore();
    let release!: () => void;
    vi.mocked(store.write).mockImplementationOnce(async (next) => {
      await new Promise<void>((resolve) => { release = resolve; });
      await writeOriginal(next);
    });
    const writeOriginal = async (next: Settings) => {
      vi.mocked(store.read).mockResolvedValue(next);
    };
    const starting = controller.start(token);
    await Promise.resolve();
    const stopping = controller.stop();
    release();
    await Promise.all([starting, stopping]);
    expect(runner.start).not.toHaveBeenCalled();
    expect(saved().enabled).toBe(false);
    expect(saved().token === token).toBe(true);
  });
  it('fallar al guardar Detener libera recursos y avisa de persistencia', async () => {
    const { controller, runner, store } = setup({ token, enabled: true });
    await controller.restore();
    vi.mocked(store.write).mockRejectedValue(new Error('disco privado'));
    await expect(controller.stop()).rejects.toThrow('No se pudo guardar');
    expect(runner.stop).toHaveBeenCalled();
    expect(controller.snapshot().enabled).toBe(false);
    expect(controller.status.detail).not.toContain('disco privado');
  });
  it('un fallo de lectura al detener mantiene la sesión apagada y permite reintentar', async () => {
    const { controller, runner, store, saved } = setup({ token, enabled: true });
    await controller.restore();
    vi.mocked(store.read).mockRejectedValueOnce(new Error('almacén no disponible'));
    await expect(controller.stop()).rejects.toThrow('no se pudo guardar');
    expect(runner.stop).toHaveBeenCalled();
    expect(controller.status.state).toBe('error');
    expect(controller.snapshot().enabled).toBe(false);
    await controller.stop();
    expect(saved().enabled).toBe(false);
  });
  it('la vigilancia no interrumpe una carga dentro del timeout del adaptador', async () => {
    const { controller, runner } = setup({ token, enabled: true });
    await controller.restore();
    controller.status = { state: 'loading', detail: '', updatedAt: 0 };
    runner.neuralSnapshot.mockReturnValue({ tick: 0, neurons: 139255, session: 1 });
    for (let now = 1_000; now < 28_000; now += 2_000) controller.heartbeat(now);
    expect(runner.startWhenAvailable).toHaveBeenCalledOnce();
  });
  it.each([{ enabled: true, token: 123 }, { enabled: true, token: '' }])('no arranca ni sobrescribe configuración corrupta', async (invalid) => {
    const { controller, runner, store } = setup();
    vi.mocked(store.read).mockResolvedValue(invalid);
    await controller.restore();
    await expect(controller.start(token)).rejects.toThrow();
    expect(runner.start).not.toHaveBeenCalled();
    expect(store.write).not.toHaveBeenCalled();
  });
  it('recupera una pausa larga sin tomar el control y respeta Detener', async () => {
    const { controller, runner } = setup({ token, enabled: true });
    await controller.restore();
    controller.heartbeat(1_000);
    controller.heartbeat(40_000);
    expect(runner.startWhenAvailable).toHaveBeenCalledTimes(2);
    await controller.stop();
    controller.heartbeat(100_000);
    expect(runner.startWhenAvailable).toHaveBeenCalledTimes(2);
  });
  it('recupera un cerebro sin ticks y cancela la recuperación al descargar', async () => {
    const { controller, runner } = setup({ token, enabled: true });
    await controller.restore();
    runner.neuralSnapshot.mockReturnValue({ tick: 1, neurons: 139255, session: 1 });
    for (let now = 1_000; now < 20_000; now += 2_000) controller.heartbeat(now);
    expect(runner.startWhenAvailable).toHaveBeenCalledTimes(2);
    controller.dispose();
    controller.heartbeat(200_000);
    await controller.start(token);
    expect(runner.start).not.toHaveBeenCalled();
  });
  it('Olvidar detiene y borra la credencial', async () => {
    const { controller, saved } = setup({ token, enabled: true });
    await controller.restore();
    await controller.stop(true);
    expect(saved()).toEqual({ enabled: false, token: '' });
  });
});

describe('reloj Firefox tras una suspensión', () => {
  it.each(['setTimeout', 'setInterval'] as const)('no ejecuta %s cancelado por la vigilancia al despertar', (method) => {
    vi.useFakeTimers();
    try {
      const callback = vi.fn();
      let cancel!: () => void;
      const clock = lifecycleClock(webClock, () => cancel());
      cancel = clock[method](callback, 1_000);
      vi.advanceTimersByTime(20_000);
      expect(callback).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
