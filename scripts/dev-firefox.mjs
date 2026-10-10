import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { download } from 'geckodriver';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const profile = await mkdtemp(join(tmpdir(), 'moscas-firefox-dev-'));
let driver;
try {
  const options = new firefox.Options().addArguments('-no-remote', '-profile', profile);
  const binary = process.env.FIREFOX_BINARY || (process.platform === 'darwin' ? '/Applications/Firefox.app/Contents/MacOS/firefox' : undefined);
  if (binary) options.setBinary(binary);
  const service = new firefox.ServiceBuilder(await download('0.37.0')).addArguments('--log', 'fatal');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(options).setFirefoxService(service).build();
  await driver.installAddon(resolve('dist-firefox'), true);
  console.log('Moscas instalado temporalmente en Firefox. Abre el panel desde Extensiones. Ctrl+C cierra y elimina el perfil de desarrollo.');
  await new Promise((done) => { process.once('SIGINT', done); process.once('SIGTERM', done); });
} finally {
  try { await driver?.quit(); } finally { await rm(profile, { recursive: true, force: true }); }
}
