import { spawnSync } from 'node:child_process';
if (!/^fly_device_[a-f0-9]{64}$/.test(process.env.MOSCAS_DEVICE_TOKEN ?? '')) {
  console.error('Falta MOSCAS_DEVICE_TOKEN con un token de dispositivo válido.'); process.exit(1);
}
const result = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.firefox.config.ts', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, MOSCAS_FIREFOX_LIVE: '1' },
});
process.exit(result.status ?? 1);
