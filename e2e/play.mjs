// End-to-end: several phones create/join a room over the real public relays and play.
// Usage: node e2e/play.mjs [url] [players] [seconds]
import { chromium } from 'playwright';

const URL = process.argv[2] || 'http://localhost:4173/';
const N = Number(process.argv[3] || 3);
const SECONDS = Number(process.argv[4] || 90);
const SHOTS = process.env.SHOTS || 'e2e/shots';
const browser = await chromium.launch({ channel: 'chrome' });
const errors = [];

async function phone(label) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`${label}: ${e.message}`));
  page.on('console', (m) => m.type() === 'error' && !/WebSocket|ERR_|wss:/.test(m.text()) && errors.push(`${label} console: ${m.text()}`));
  await page.goto(URL);
  return page;
}

const names = ['Sush', 'Mira', 'Rook', 'Dev', 'Theo', 'Ana', 'Kai', 'Lu'];
const host = await phone('host');
await host.getByRole('button', { name: 'Create game' }).click();
await host.getByPlaceholder('Your name').fill(names[0]);
await host.getByRole('dialog').getByRole('button', { name: 'Create game' }).click();
await host.locator('.room-code').waitFor({ timeout: 20000 });
const code = (await host.locator('.room-code').textContent()).trim();
console.log('room', code);

const pages = [host];
for (let i = 1; i < N; i++) {
  const p = await phone(names[i]);
  await p.getByPlaceholder('Room code').fill(code);
  await p.getByRole('button', { name: 'Join', exact: true }).click();
  await p.getByPlaceholder('Your name').fill(names[i]);
  await p.getByRole('dialog').getByRole('button', { name: 'Join game' }).click();
  pages.push(p);
}
const t0 = Date.now();
await host.waitForFunction((n) => document.querySelectorAll('.prow').length >= n, N, { timeout: 40000 });
console.log('all joined in', Date.now() - t0, 'ms');
await pages[1].locator('.room-code').waitFor({ timeout: 20000 });
await host.screenshot({ path: `${SHOTS}/2-lobby.png` });
await host.getByRole('button', { name: 'Start game' }).click();
await Promise.all(pages.map((p) => p.locator('.felt').waitFor({ timeout: 20000 })));
console.log('game started');

let actions = 0, raises = 0, shots = { table: false, raise: false, showdown: false };
const end = Date.now() + SECONDS * 1000;
while (Date.now() < end) {
  let acted = false;
  for (const [i, p] of pages.entries()) {
    const fold = p.locator('.actions .btn-fold');
    if (!(await fold.count())) continue;
    if (!shots.table && i === 0 && (await p.locator('.board .card:not(.slot)').count()) >= 3) {
      await p.screenshot({ path: `${SHOTS}/3-table.png` });
      shots.table = true;
    }
    const r = Math.random();
    const raiseBtn = p.locator('.actions .btn-gold');
    if (r < 0.15 && (await raiseBtn.isEnabled())) {
      await raiseBtn.click();
      await p.locator('.quick button').nth(1).click({ timeout: 5000 });
      if (!shots.raise) {
        await p.waitForTimeout(400);
        await p.screenshot({ path: `${SHOTS}/4-raise.png` });
        shots.raise = true;
      }
      await p.locator('.sheet-actions .btn-gold').click();
      raises++;
    } else if (r < 0.25) {
      await fold.click();
    } else {
      await p.locator('.actions .btn-dark').click();
    }
    actions++;
    acted = true;
    await p.waitForTimeout(150);
  }
  if (!shots.showdown && (await host.locator('.win-line').count()) && (await host.locator('.seat-shown').count())) {
    await host.waitForTimeout(500);
    await host.screenshot({ path: `${SHOTS}/5-showdown.png` });
    shots.showdown = true;
  }
  if (!acted) await host.waitForTimeout(250);
}
console.log('actions', actions, 'raises', raises);

// Loan: a player asks, the host lends.
const asker = pages[1];
await asker.getByRole('button', { name: 'Menu' }).click();
await asker.getByRole('button', { name: /Ask host for a loan/ }).click();
await asker.locator('.sheet .btn-gold').click();
await asker.keyboard.press('Escape');
await host.locator('.loan-card').waitFor({ timeout: 15000 });
await host.screenshot({ path: `${SHOTS}/6-loan.png` });
await host.locator('.loan-card').getByRole('button', { name: 'Lend' }).click();
console.log('loan approved');

// Landscape.
await host.setViewportSize({ width: 844, height: 390 });
await host.waitForTimeout(800);
await host.screenshot({ path: `${SHOTS}/7-landscape.png` });
await host.setViewportSize({ width: 390, height: 844 });

// Everyone votes to end; keep checking until the scoreboard shows.
for (const p of pages) {
  await p.keyboard.press('Escape');
  await p.getByRole('button', { name: 'Menu' }).click();
  await p.getByRole('button', { name: /Vote to end game/ }).click();
  await p.keyboard.press('Escape');
}
const tEnd = Date.now();
while (Date.now() - tEnd < 90000 && !(await host.locator('.over-title').count())) {
  for (const p of pages) {
    const c = p.locator('.actions .btn-dark:not(.pre)');
    if (await c.count()) await c.click().catch(() => {});
  }
  await host.waitForTimeout(300);
}
await Promise.all(pages.map((p) => p.locator('.over-title').waitFor({ timeout: 20000 })));
await host.screenshot({ path: `${SHOTS}/8-gameover.png` });
const nets = await host.locator('.over-row .net').allTextContents();
const total = nets.map((s) => Number(s.replace('−', '-').replace(/[+,]/g, ''))).reduce((a, b) => a + b, 0);
console.log('scoreboard', nets.join(' '), 'sum', total);
console.log('errors', errors.length ? errors : 'none');
await browser.close();
process.exit(errors.length || total !== 0 ? 1 : 0);
