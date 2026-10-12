// Renders submission/logo-512.png and submission/cover-1280x720.png with headless Chromium.
// The cover shows the receipt table component, styled with the app stylesheet, filled with the example data.
import { readFileSync } from "node:fs";
import { chromium } from "playwright";

const root = new URL("..", import.meta.url).pathname;
const logo = readFileSync(`${root}web/public/logo.svg`, "utf8");
const css = readFileSync(`${root}web/styles.css`, "utf8");
const lines = [
  ["0x5dad…0501", "Ana Petrova · logo design", "1,200.00"],
  ["0x3440…96a2", "Jonas K. · backend sprint 41", "2,450.50"],
  ["0xAcFB…64FF", "Mia Rossi · translation DE", "380.00"],
  ["0x3e03…8a87", "Docs bounty #12", "500.00"],
  ["0x53c9…0A61", "Leo Martin · QA October", "715.25"],
];
const table = `<div class="card mock">
  <div class="mock-head"><div class="receipt-brand">${logo.replace("<svg ", '<svg width="34" height="34" ')}<div><h1>Payment receipt</h1><span class="muted">October contractors · 5 recipients</span></div></div>
  <div class="receipt-total"><strong class="mono">5,245.75</strong> USDC</div></div>
  <table class="lines"><thead><tr><th class="num">#</th><th>Recipient</th><th>Label</th><th class="num">Amount</th></tr></thead><tbody>
  ${lines.map((l, i) => `<tr><td class="num muted">${i + 1}</td><td class="mono">${l[0]}</td><td>${l[1]}</td><td class="num mono">${l[2]}</td></tr>`).join("")}
  </tbody><tfoot><tr><td></td><td colspan="2">Total</td><td class="num mono">5,245.75</td></tr></tfoot></table>
  <div class="mock-actions"><span class="btn btn-primary">Print or save as PDF</span><span class="btn btn-secondary">Accounting CSV (EUR)</span></div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 } });
await page.setContent(`<html><body style="margin:0;background:transparent">${logo.replace("<svg ", '<svg width="512" height="512" ')}</body></html>`);
await page.screenshot({ path: `${root}submission/logo-512.png`, omitBackground: true });

await page.setViewportSize({ width: 1280, height: 720 });
await page.setContent(`<!doctype html><html><head><style>
  ${css}
  * { box-sizing: border-box; }
  body { margin: 0; width: 1280px; height: 720px; overflow: hidden; font-family: system-ui, -apple-system, "Segoe UI", Roboto, "DejaVu Sans", sans-serif;
         background: radial-gradient(1200px 600px at 85% 20%, #dbe7ff 0%, rgba(219,231,255,0) 60%), linear-gradient(160deg, #f8fbff 0%, #eef3fb 100%); color: #0f172a; }
  .left { position: absolute; left: 80px; top: 92px; width: 560px; }
  .left .brand { display: flex; align-items: center; gap: 18px; font-size: 40px; font-weight: 800; letter-spacing: -0.02em; }
  .left .brand svg { width: 72px; height: 72px; }
  .left h1 { font-size: 50px; line-height: 1.08; margin: 40px 0 22px; letter-spacing: -0.025em; }
  .left h1 span { color: #1d4ed8; }
  .left p { font-size: 22px; line-height: 1.45; color: #334155; margin: 0 0 30px; }
  .left .chips { display: flex; flex-wrap: wrap; gap: 10px; }
  .left .chip { background: #fff; border: 1px solid #dbe3ef; border-radius: 999px; padding: 9px 16px; font-size: 17px; font-weight: 600; color: #1e293b; box-shadow: 0 1px 2px rgba(15,23,42,.05); }
  body { background: radial-gradient(1200px 600px at 85% 20%, #dbe7ff 0%, rgba(219,231,255,0) 60%), linear-gradient(160deg, #f8fbff 0%, #eef3fb 100%); }
  .mock { position: absolute; left: 680px; top: 140px; width: 540px; padding: 24px; border-radius: 18px; box-shadow: 0 30px 80px rgba(15,23,42,.18), 0 2px 8px rgba(15,23,42,.08); }
  .mock-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 14px; margin-bottom: 14px; }
  .mock-head h1 { font-size: 21px; margin: 0; }
  .mock-head .muted { font-size: 13px; }
  .mock .receipt-total { font-size: 19px; }
  .mock .lines { font-size: 13px; }
  .mock-actions { display: flex; gap: 10px; margin-top: 16px; }
  .mock-actions .btn { font-size: 14px; }
  .foot { position: absolute; left: 80px; bottom: 54px; font-size: 18px; color: #64748b; }
  .foot b { color: #0f172a; }
</style></head><body>
  <div class="left">
    <div class="brand">${logo}<span>Remitsheet</span></div>
    <h1>Pay a whole spreadsheet in <span>one Arc transaction</span></h1>
    <p>Batch payouts in USDC or EURC for contractors, bounties, grants and payroll, with receipts and an accounting export in EUR.</p>
    <div class="chips"><span class="chip">USDC &amp; EURC</span><span class="chip">All-or-nothing</span><span class="chip">PDF receipts</span><span class="chip">ECB EUR export</span></div>
  </div>
  ${table}
  <div class="foot">Open source · no custody · no fees · built on <b>Arc</b></div>
</body></html>`);
await page.screenshot({ path: `${root}submission/cover-1280x720.png` });
await browser.close();
console.log("wrote submission/logo-512.png and submission/cover-1280x720.png");
