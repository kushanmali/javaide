import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4173 }, logLevel: 'warn' });
const browser = await chromium.launch();
const page = await (await browser.newContext()).newPage();
await page.goto('http://localhost:4173/');
await page.waitForFunction(() => !document.getElementById('run-button').disabled, null, { timeout: 300000 });
for (const n of [1000, 3000, 10000]) {
  await page.evaluate((n) => window.__javaIde.setSource(`public class Main { public static void main(String[] a) { long s = System.currentTimeMillis(); for (int i = 0; i < ${n}; i++) System.out.println("line " + i); System.err.println("elapsed=" + (System.currentTimeMillis() - s)); } }`), n);
  const t = Date.now();
  await page.click('#run-button');
  await page.waitForFunction(() => document.getElementById('stop-button').disabled && /exit code/.test(document.getElementById('console-output').innerText), null, { timeout: 200000 });
  const text = await page.evaluate(() => document.getElementById('console-output').innerText);
  console.log(n, 'lines', text.match(/elapsed=\d+/)?.[0], 'wall', Date.now() - t);
}
await browser.close(); server.httpServer.close();
