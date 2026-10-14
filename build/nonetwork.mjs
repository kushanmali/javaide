import { chromium } from '@playwright/test';
import { preview } from 'vite';
const server = await preview({ preview: { port: 4177 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const store = new Map();
const key = (req) => `${req.url()}|${req.headers().range ?? ''}`;

async function start(label, handler, query = '') {
  const ctx = await browser.newContext();
  await ctx.route('https://cjrtnc.leaningtech.com/**', handler);
  const page = await ctx.newPage();
  const t = Date.now();
  await page.goto(`http://localhost:4177/${query}`);
  await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
  const s = await page.evaluate(() => window.__javaIde.startup);
  console.log(`${label}: wall ${Date.now() - t} ms, runtime ${s.runtimeMs}, warmup ${s.warmupMs}`);
  await ctx.close();
}

// 1. Record every CDN response (network as normal)
await start('record (network)', async (route) => {
  const response = await route.fetch();
  store.set(key(route.request()), { status: response.status(), headers: response.headers(), body: await response.body() });
  await route.fulfill({ response });
});
console.log('recorded', store.size, 'responses');
// 2. Replay from memory: no network cost for the CDN
const replay = async (route) => {
  const hit = store.get(key(route.request()));
  if (hit) await route.fulfill({ status: hit.status, headers: hit.headers, body: hit.body });
  else { console.log('miss', key(route.request())); await route.continue(); }
};
for (const q of ['', '?preload=off', '']) await start(`replay ${q || 'preload on'}`, replay, q);
await browser.close(); server.httpServer.close();
