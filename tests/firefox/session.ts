import { createRequire } from 'node:module';
import type { Driver } from 'selenium-webdriver/firefox.js';
const require = createRequire(import.meta.url);
const { Builder, By } = require('selenium-webdriver') as typeof import('selenium-webdriver');
const firefox = require('selenium-webdriver/firefox.js') as typeof import('selenium-webdriver/firefox.js');
import { download } from 'geckodriver';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect } from '@playwright/test';
import type { FirefoxState } from '../../src/clients/firefox/messages';

export const ADDON_ID = 'moscas-firefox@moscas.lol';
/** Playwright es solo el lanzador de aserciones; Selenium instala el addon real en Firefox. */
export class FirefoxSession {
  driver!: Driver;
  profile = '';
  uuid = '';
  constructor(private proxy?: string) {}
  async launch() {
    if (!this.profile) this.profile = await mkdtemp(join(tmpdir(), 'moscas-firefox-'));
    const binary = process.env.FIREFOX_BINARY || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : undefined);
    const options = new firefox.Options().addArguments('-no-remote', '-profile', this.profile);
    if (binary) options.setBinary(binary);
    // No se modifican los temporizadores, políticas de segundo plano ni TLS.
    if (process.env.MOSCAS_FIREFOX_HEADLESS === '1') options.addArguments('-headless');
    if (this.proxy) {
      const url = new URL(this.proxy);
      options.setPreference('network.proxy.type', 1)
        .setPreference('network.proxy.ssl', url.hostname).setPreference('network.proxy.ssl_port', Number(url.port))
        .setPreference('network.proxy.http', url.hostname).setPreference('network.proxy.http_port', Number(url.port))
        .setPreference('network.proxy.no_proxies_on', '').setPreference('network.http.http3.enable', false);
    }
    const service = new firefox.ServiceBuilder(await download('0.37.0')).addArguments('--allow-system-access', '--log', 'fatal');
    this.driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build() as Driver;
    await this.driver.manage().setTimeouts({ script: 15_000, pageLoad: 30_000 });
    await this.driver.installAddon(resolve('dist-firefox'), true);
    await this.chrome();
    this.uuid = await this.driver.executeScript<string>(`return JSON.parse(Services.prefs.getStringPref('extensions.webextensions.uuids'))[arguments[0]];`, ADDON_ID);
    await this.content();
    await this.popup();
  }
  async chrome() { await this.driver.setContext(firefox.Context.CHROME); }
  async content() { await this.driver.setContext(firefox.Context.CONTENT); }
  async popup() {
    await this.driver.get(`moz-extension://${this.uuid}/popup.html`);
    await this.driver.wait(async () => this.driver.executeScript('return Boolean(document.querySelector("#start"));'), 10_000);
    await this.state();
  }
  async message(message: object) {
    return this.driver.executeAsyncScript(`const done = arguments[arguments.length - 1]; browser.runtime.sendMessage(arguments[0]).then(done, () => done({error:'Comunicación fallida'}));`, message);
  }
  async state(): Promise<FirefoxState> { return await this.message({ type: 'GET_STATE' }) as FirefoxState; }
  async click(id: string) { await this.driver.findElement(By.id(id)).click(); }
  async start() {
    const token = process.env.MOSCAS_DEVICE_TOKEN;
    if (!/^fly_device_[a-f0-9]{64}$/.test(token ?? '')) throw new Error('Falta MOSCAS_DEVICE_TOKEN.');
    // Sin sendKeys, logs, trazas ni aserciones que puedan mostrar la credencial.
    await this.driver.executeScript(`const input=document.querySelector('#token'); input.value=arguments[0]; input.dispatchEvent(new Event('input'));`, token);
    await this.click('start');
    await this.online();
  }
  async online() {
    await expect.poll(async () => {
      const state = await this.state();
      return state.status?.state === 'online' && Boolean(state.fly) && (state.activity?.tick ?? 0) > 2;
    }, { timeout: 80_000 }).toBe(true);
  }
  async closePopup() { await this.driver.get('about:blank'); }
  async minimize() { await this.driver.manage().window().minimize(); }
  async restoreWindow() { await this.driver.manage().window().setRect({ x: 30, y: 30, width: 900, height: 700 }); }
  async disable() {
    await this.chrome();
    await this.driver.executeAsyncScript(`const done=arguments[arguments.length-1]; const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); AddonManager.getAddonByID(arguments[0]).then(a=>a.disable()).then(()=>done(true),()=>done(false));`, ADDON_ID);
    await this.content();
  }
  async enable() {
    await this.chrome();
    await this.driver.executeAsyncScript(`const done=arguments[arguments.length-1]; const {AddonManager}=ChromeUtils.importESModule('resource://gre/modules/AddonManager.sys.mjs'); AddonManager.getAddonByID(arguments[0]).then(a=>a.enable()).then(()=>done(true),()=>done(false));`, ADDON_ID);
    await this.content();
    await this.popup();
  }
  async backgroundCount() {
    await this.chrome();
    const count = await this.driver.executeScript<number>(`const {ExtensionParent}=ChromeUtils.importESModule('resource://gre/modules/ExtensionParent.sys.mjs'); const ext=ExtensionParent.GlobalManager.getExtension(arguments[0]); return ext ? [...ext.views].filter(v=>v.viewType==='background').length : 0;`, ADDON_ID);
    await this.content(); return count;
  }
  async restart() { await this.driver.quit(); await this.launch(); }
  async dispose() {
    try { await this.driver?.quit(); } finally { if (this.profile) await rm(this.profile, { recursive: true, force: true }); }
  }
}
