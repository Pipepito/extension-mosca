import { test, expect } from '@playwright/test';
import { FirefoxSession } from './session';
let session: FirefoxSession;
test.beforeEach(async () => { session = new FirefoxSession(); await session.launch(); });
test.afterEach(async () => { await session?.dispose(); });
test('instala el manifiesto real, valida el popup y rechaza un token inválido', async () => {
  expect(await session.backgroundCount()).toBe(1);
  const state = await session.state();
  expect(state.enabled).toBe(false);
  expect(state.hasToken).toBe(false);
  expect(state.activity == null).toBe(true);
  await session.driver.executeScript(`const input=document.querySelector('#token');input.value='incompleto';input.dispatchEvent(new Event('input'));`);
  await session.click('start');
  expect(await session.driver.executeScript(`return document.querySelector('#detail').textContent`)).toContain('Revisa');
  expect((await session.state()).enabled).toBe(false);
  expect(await session.message({ type: 'START', token: 'incompleto' })).toHaveProperty('error');
});
test('Detener persiste al reiniciar; deshabilitar elimina el background', async () => {
  await session.message({ type: 'STOP' });
  await session.restart();
  expect((await session.state()).enabled).toBe(false);
  expect((await session.state()).activity == null).toBe(true);
  await session.closePopup();
  await session.disable();
  expect(await session.backgroundCount()).toBe(0);
  await session.enable();
  expect(await session.backgroundCount()).toBe(1);
  expect((await session.state()).enabled).toBe(false);
});
test('el background sobrevive al cierre del popup y la minimización', async () => {
  await session.closePopup();
  await session.minimize();
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect(await session.backgroundCount()).toBe(1);
  await session.restoreWindow();
  await session.popup();
  expect((await session.state()).status.state).toBe('idle');
});
