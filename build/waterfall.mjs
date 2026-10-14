import { chromium } from '@playwright/test';
import { preview } from 'vite';
const mode = process.argv[2];
const server = await preview({ preview: { port: 4176 }, logLevel: 'warn' });
const browser = await chromium.launch({ channel: 'msedge' });
const ctx = await browser.newContext();
const page = await ctx.newPage();
const t0 = Date.now();
const rows = [];
page.on('requestfinished', async (r) => {
  const t = r.timing(); const sizes = await r.sizes().catch(() => ({ responseBodySize: 0 }));
  const start = t.startTime - t0;
  rows.push({ start: Math.round(start), dur: Math.round(t.responseEnd), wait: Math.round(t.responseStart - t.requestStart), conn: Math.round(Math.max(0, t.connectEnd - t.connectStart)), kb: Math.round(sizes.responseBodySize / 1024), range: r.headers().range ?? '', url: r.url().replace('https://cjrtnc.leaningtech.com/4.3', 'CDN').replace('http://localhost:4176', 'APP').slice(0, 60) });
});
await page.goto(`http://localhost:4176/${mode === 'off' ? '?preload=off' : ''}`);
await page.waitForFunction(() => window.__javaIde?.startup, null, { timeout: 300000 });
const s = await page.evaluate(() => window.__javaIde.startup);
await page.waitForTimeout(500);
console.log(mode, JSON.stringify(s), 'wall', Date.now() - t0);
rows.sort((a, b) => a.start - b.start);
// concurrency over time + totals per origin
const cdn = rows.filter((r) => r.url.startsWith('CDN')), app = rows.filter((r) => r.url.startsWith('APP'));
const sum = (a, k) => a.reduce((x, r) => x + r[k], 0);
console.log(`CDN: ${cdn.length} req, ${sum(cdn, 'kb')} KB, sum dur ${sum(cdn, 'dur')} ms, median wait(TTFB) ${cdn.map(r=>r.wait).sort((a,b)=>a-b)[cdn.length>>1]} ms; APP: ${app.length} req, ${sum(app, 'kb')} KB, sum dur ${sum(app,'dur')} ms`);
let maxc = 0; for (const r of rows) { const c = rows.filter((x) => x.start <= r.start && x.start + x.dur > r.start).length; maxc = Math.max(maxc, c); }
console.log('max concurrent requests', maxc);
const buckets = {}; for (const r of rows) { const b = Math.floor(r.start / 2000) * 2; buckets[b] = (buckets[b] ?? 0) + 1; }
console.log('requests started per 2 s:', JSON.stringify(buckets));
console.log(rows.filter(r=>r.dur>1500).map(r => `${r.start}+${r.dur} wait${r.wait} ${r.kb}KB ${r.range} ${r.url}`).join('\n'));
await browser.close(); server.httpServer.close();
