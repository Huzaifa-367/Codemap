// Optional, for development: opens a built map in a real browser (Playwright, not a dependency of Codemap:
// install it yourself) and walks Follow it -> Trace the flow, the Functions map and Layers, reporting page errors.
// usage: node tools/visual-check.cjs <path to codemap/index.html> <file path on the map with functions>
const { chromium } = require('playwright');
(async () => {
  const [file, target] = process.argv.slice(2);
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = []; p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await p.goto('file://' + file); await p.waitForTimeout(1200);
  await p.evaluate((t) => { window.__t = t; }, target);
  await p.evaluate(async () => { window.Codemap.setTechnical(true); await window.Codemap.go('f:' + window.__t); });
  await p.waitForTimeout(1500);
  await p.click('text=Trace the flow'); await p.waitForTimeout(2000);
  const board = await p.evaluate(() => ({ title: document.querySelector('#context h1')?.textContent, cards: document.querySelectorAll('.card').length }));
  await p.screenshot({ path: '/tmp/trace-board.png' });
  await p.evaluate(async () => { window.Codemap.setTechnical(true); await window.Codemap.go('f:' + window.__t); }); await p.waitForTimeout(1200);
  await p.click('text=Functions map'); await p.waitForTimeout(800);
  const modal = await p.evaluate(() => ({ boxes: document.querySelectorAll('#modal rect').length, arrows: document.querySelectorAll('#modal path').length }));
  await p.screenshot({ path: '/tmp/fnmap.png' });
  await p.keyboard.press('Escape'); await p.evaluate(() => document.querySelector('#modal')?.classList.remove('open'));
  await p.evaluate(() => document.getElementById('fp-layers').click()); await p.waitForTimeout(500);
  const layers = await p.evaluate(() => document.querySelectorAll('#modal [data-lens-layer]').length);
  console.log(JSON.stringify({ errors, board, modal, layers }));
  await b.close();
})();
