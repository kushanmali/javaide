import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ base: '/java-ide/', build: { outDir: 'build/dist-subpath' }, preview: { port: 4190, strictPort: true }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext()).newPage();
const failed = [];
page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
await page.goto('http://localhost:4190/java-ide/');
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
try {
  await page.waitForFunction(() => !document.getElementById('run-button').disabled, null, { timeout: 120000 });
} catch (e) {
  console.log('NOT READY. status:', await page.locator('#status-text').innerText());
  console.log('console panel:', (await page.locator('#console-output').innerText()).slice(0, 400));
  console.log('failed requests:', failed);
  console.log('browser logs:', logs.filter((l) => !l.includes('[debug]')).slice(-10));
  await browser.close(); server.httpServer.close(); process.exit(1);
}
await page.click('#run-button');
await page.waitForFunction(() => /exit code/.test(document.getElementById('console-output').innerText), null, { timeout: 60000 });
const out = await page.locator('#console-output').innerText();
const jarRequests = await page.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.endsWith('.jar')));
console.log('output ok:', out.includes('Hello, World!') && out.includes('exit code 0'));
console.log('local jars requested from:', [...new Set(jarRequests.map((u) => new URL(u).pathname))]);
console.log('failed requests:', failed.length ? failed : 'none');
await browser.close(); server.httpServer.close();
