// Deterministic frame renderer for a timeline page exposing window.ready (Promise) and window.render(t).
// usage:
//   node render.mjs <page.html> stills 1.5,7,9            -> <dir>/stills/t1.50.png
//   node render.mjs <page.html> frames <dur> [fps=60] [workers=8] [--jpeg] [--from=s --to=s]  -> <dir>/frames/f00000.(png|jpg)
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const req = createRequire(path.join(process.cwd(), 'x.js'));
let pw; try { pw = req('playwright'); } catch { pw = createRequire(import.meta.url)('playwright'); }
const [html, mode, a1, a2, a3] = process.argv.slice(2).filter(x => !x.startsWith('--'));
const jpeg = process.argv.includes('--jpeg');
const argv = k => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? +a.split('=')[1] : null; };
const file = path.resolve(html), dir = path.dirname(file);
const browser = await pw.chromium.launch({ channel: 'chrome', args: ['--hide-scrollbars'] });
async function page() {
  const p = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  p.on('pageerror', e => console.error('pageerror:', e.message));
  await p.goto('file://' + file);
  await p.evaluate(() => window.ready);
  await p.waitForTimeout(300);
  return p;
}
if (mode === 'stills') {
  fs.mkdirSync(dir + '/stills', { recursive: true });
  const p = await page();
  for (const t of a1.split(',').map(Number)) {
    await p.evaluate(t => render(t), t);
    await p.screenshot({ path: `${dir}/stills/t${t.toFixed(2)}.png` });
  }
} else {
  const dur = +a1, fps = +(a2 || 60), W = +(a3 || 8), N = Math.round(dur * fps), ext = jpeg ? 'jpg' : 'png';
  fs.mkdirSync(dir + '/frames', { recursive: true });
  // --from=<sec> --to=<sec> re-renders only a time range (keeps other frames)
  const F0 = argv('from') != null ? Math.floor(argv('from') * fps) : 0, F1 = argv('to') != null ? Math.ceil(argv('to') * fps) : N;
  let next = F0, done = 0;
  await Promise.all(Array.from({ length: W }, async () => {
    const p = await page();
    for (;;) {
      const i = next++; if (i >= Math.min(N, F1)) break;
      await p.evaluate(t => render(t), i / fps);
      await p.screenshot({ path: `${dir}/frames/f${String(i).padStart(5, '0')}.${ext}`, ...(jpeg ? { type: 'jpeg', quality: 95 } : {}) });
      if (++done % 200 === 0) console.log(done + '/' + N);
    }
  }));
}
await browser.close();
