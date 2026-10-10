import { test, expect } from '@playwright/test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FirefoxSession } from './session';
import { ExtensionSession } from '../e2e/extension';
import { OutageProxy } from '../e2e/outage-proxy';
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let session: FirefoxSession;
let proxy: OutageProxy;
test.beforeEach(async () => { proxy = new OutageProxy(); await proxy.start(); session = new FirefoxSession(proxy.url); await session.launch(); });
test.afterEach(async () => { try { await session?.dispose(); } finally { await proxy?.dispose(); } });

test('autentica, carga assets locales, avanza minimizado, restaura y libera al deshabilitar', async () => {
  await session.start();
  const first = (await session.state()).activity!;
  expect(first.neurons).toBe(139255);
  expect(await session.backgroundCount()).toBe(1);
  const before = proxy.forwardedBytes;
  await session.closePopup();
  await session.minimize();
  await wait(65_000); // Supera los plazos de inactividad habituales sin mantener vistas abiertas.
  expect(proxy.forwardedBytes).toBeGreaterThan(before + 1_000);
  await session.restoreWindow();
  await session.popup();
  const second = (await session.state()).activity!;
  expect(second.session).toBe(first.session);
  expect(second.tick - first.tick).toBeGreaterThan(300);
  await session.restart();
  await session.online();
  expect((await session.state()).enabled).toBe(true);
  await session.closePopup();
  await session.disable();
  expect(await session.backgroundCount()).toBe(0);
  await wait(3_000);
  const stoppedBytes = proxy.forwardedBytes;
  await wait(3_000);
  expect(proxy.forwardedBytes).toBe(stoppedBytes);
  await session.enable();
  await session.online();
  await session.click('stop');
  await expect.poll(async () => (await session.state()).enabled).toBe(false);
  expect((await session.state()).activity == null).toBe(true);
  expect((await session.state()).fly == null).toBe(true);
  await session.restart();
  const stopped = await session.state();
  expect(stopped.enabled).toBe(false);
  expect(stopped.hasToken).toBe(true);
  expect(stopped.activity == null).toBe(true);
  await session.click('forget');
  await expect.poll(async () => (await session.state()).hasToken).toBe(false);
});

test('recupera cortes TCP, reinicio durante corte y arranque sin red', async () => {
  proxy.cut();
  // Activación mediante UI; no esperar online hasta restaurar la red.
  const token = process.env.MOSCAS_DEVICE_TOKEN!;
  await session.message({ type: 'START', token });
  await expect.poll(() => proxy.blockedAttempts).toBeGreaterThan(0);
  expect((await session.state()).enabled).toBe(true);
  proxy.restore();
  await session.online();
  for (let round = 0; round < 2; round++) {
    const tunnels = proxy.established;
    await session.closePopup();
    proxy.cut();
    await wait(4_000);
    if (round === 1) await session.restart();
    else await session.popup();
    expect((await session.state()).status.state).not.toBe('online');
    expect((await session.state()).activity == null).toBe(true);
    proxy.restore();
    await session.online();
    expect(proxy.established).toBeGreaterThan(tunnels);
  }
});

test('detecta silencio y cancela una petición atascada sin reactivarse', async () => {
  await session.start();
  proxy.stall();
  await session.closePopup();
  await wait(48_000);
  await session.popup();
  expect((await session.state()).status.state).not.toBe('online');
  expect((await session.state()).activity == null).toBe(true);
  // Deadline HTTP real de 15 s; el núcleo debe salir de una solicitud sin respuesta.
  await expect.poll(async () => (await session.state()).status.state, { timeout: 20_000, intervals: [250] }).toBe('error');
  proxy.restore();
  await session.online();
  await session.click('stop');
  await expect.poll(async () => (await session.state()).enabled).toBe(false);
  proxy.cut(); proxy.stall();
  const attempts = proxy.blockedAttempts;
  await session.click('start');
  await expect.poll(() => proxy.blockedAttempts).toBeGreaterThan(attempts);
  await session.click('stop');
  await expect.poll(async () => (await session.state()).enabled).toBe(false);
  proxy.restore();
  for (let i = 0; i < 17; i++) {
    const state = await session.state();
    expect(state.enabled).toBe(false);
    expect(state.activity == null).toBe(true);
    await wait(1_000);
  }
  await session.restart();
  expect((await session.state()).enabled).toBe(false);
});

test('cede a Chromium, respeta su control tras reiniciar y recupera cuando queda libre', async () => {
  const other = new ExtensionSession(await mkdtemp(join(tmpdir(), 'moskas-playwright-')));
  try {
    await session.start();
    await other.launch();
    const popup = await other.popup();
    await popup.evaluate(async (token) => {
      await chrome.runtime.sendMessage({ type: 'START', config: { serverUrl: 'https://moscas.lol', token } });
    }, process.env.MOSCAS_DEVICE_TOKEN!);
    await expect.poll(async () => (await other.storedState()).status?.state, { timeout: 80_000 }).toBe('online');
    await expect.poll(async () => (await session.state()).status.state).toBe('paused');
    expect((await session.state()).activity == null).toBe(true);
    await session.restart();
    expect((await session.state()).status.state).toBe('paused');
    await wait(17_000);
    expect((await other.storedState()).status?.state).toBe('online');
    await popup.evaluate(async () => { await chrome.runtime.sendMessage({ type: 'STOP' }); });
    await session.online();
  } finally { await other.dispose(); }
});
