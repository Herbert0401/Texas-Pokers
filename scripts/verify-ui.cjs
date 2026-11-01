const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');

const url = process.env.TEST_URL || 'http://localhost:3133';
const output = path.join(__dirname, '../output/playwright');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const errors = [];
  const pages = [];
  try {
    const first = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const second = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    const a = await first.newPage(); const b = await second.newPage();
    pages.push(a, b);
    for (const page of [a, b]) {
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(url);
      await page.waitForFunction(() => document.body.classList.contains('three-ready'));
    }
    await a.waitForTimeout(1000);
    await a.screenshot({ path: path.join(output, 'landing-desktop.png') });
    await b.screenshot({ path: path.join(output, 'landing-mobile.png') });
    const room = String(1000 + Math.floor(Math.random() * 9000));
    for (const [page, name] of [[a, 'River'], [b, 'Herbert']]) {
      await page.locator('#nameInput').fill(name);
      await page.locator('#roomInput').fill(room);
      await page.locator('#joinForm button').click();
      await page.locator('#gameView').waitFor({ state: 'visible' });
    }
    await a.locator('#startButton').click();
    await b.waitForFunction(() => state?.game?.players.length === 2);
    await a.waitForTimeout(1300);
    const view = await a.evaluate(() => state.game);
    assert.equal(view.players.find((player) => !player.isYou).holeCards, null);
    const beforeRefresh = await b.evaluate(() => ({
      cards: state.game.players.find((player) => player.isYou).holeCards,
      chips: state.game.players.find((player) => player.isYou).chips, pot: state.game.pot
    }));
    await b.reload();
    await b.waitForFunction(() => state?.game);
    assert.deepEqual(await b.evaluate(() => ({
      cards: state.game.players.find((player) => player.isYou).holeCards,
      chips: state.game.players.find((player) => player.isYou).chips, pot: state.game.pot
    })), beforeRefresh);
    const actor = await a.evaluate(() => state.game.canAct) ? a : b;
    const other = actor === a ? b : a;
    await actor.locator('[data-action="betMin"]').click();
    await other.waitForFunction(() => state.game.canAct && state.game.toCall === 10);
    await other.locator('[data-action="call"]').click();
    await a.waitForFunction(() => state.game.street === 'flop');
    await a.waitForTimeout(1200);
    await a.screenshot({ path: path.join(output, 'table-desktop.png') });
    const canvas = a.locator('#tableScene canvas');
    const pixels = PNG.sync.read(await canvas.screenshot());
    const colors = new Set();
    for (let i = 0; i < pixels.data.length; i += 64) {
      colors.add(`${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]}`);
    }
    assert.ok(colors.size > 100, '3D canvas must have rendered nonblank geometry and textures');
    const bounds = await canvas.boundingBox();
    let changedPixels = 0;
    for (const [x, y] of [[.66, .72], [.67, .76], [.70, .70]]) {
      await a.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y);
      await a.waitForTimeout(350);
      const after = PNG.sync.read(await canvas.screenshot());
      for (let i = 0; i < pixels.data.length; i += 4) {
        if (pixels.data[i] !== after.data[i] || pixels.data[i + 1] !== after.data[i + 1]) changedPixels++;
      }
      if (changedPixels > 20) break;
    }
    assert.ok(changedPixels > 20, 'hovering a 3D card changes actual canvas pixels');
    for (const [width, height] of [[390, 844], [320, 640], [768, 1024]]) {
      await b.setViewportSize({ width, height });
      await b.waitForTimeout(300);
      await b.screenshot({ path: path.join(output, `table-${width}.png`) });
      const layout = await b.evaluate(() => {
        const rect = (selector) => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          action: rect('.actions-panel'), history: rect('.history-panel'), players: rect('.room-panel') };
      });
      assert.ok(layout.scrollWidth <= layout.width, `no horizontal overflow at ${width}`);
      if (width <= 700) {
        assert.ok(layout.action.bottom <= layout.height, 'mobile actions visible without scrolling');
        assert.ok(layout.players.bottom <= layout.height, 'mobile players visible without scrolling');
        assert.ok(layout.history.top < layout.height - 20, 'mobile history visible without scrolling');
      }
    }
    await b.setViewportSize({ width: 390, height: 844 });
    for (let i = 0; i < 6; i++) {
      const active = await a.evaluate(() => state.game.canAct) ? a : b;
      const previous = await active.evaluate(() => `${state.game.street}:${state.game.actionSeat}`);
      await active.locator('[data-action="check"]').click();
      for (const page of pages) {
        await page.waitForFunction((before) => `${state.game.street}:${state.game.actionSeat}` !== before, previous, { timeout: 15000 });
      }
    }
    await a.locator('#gameOverDialog').waitFor({ state: 'visible' });
    await b.locator('#gameOverDialog').waitFor({ state: 'visible' });
    await a.screenshot({ path: path.join(output, 'result-desktop.png') });
    await b.screenshot({ path: path.join(output, 'result-mobile.png') });
    await a.locator('#resultNextHand').click();
    await a.waitForFunction(() => state.game.handNumber === 2);
    await b.waitForFunction(() => state.game.handNumber === 2);
    await b.locator('#rulesButton').click();
    await b.locator('#rulesDialog').waitFor({ state: 'visible' });
    assert.equal(await b.locator('.mini-cards').count(), 9);
    await b.screenshot({ path: path.join(output, 'rules-mobile.png') });
    await b.locator('#closeRules').click();
    for (const page of [a, b]) await page.locator('#exitButton').click();
    assert.deepEqual(errors, []);
    console.log('PASS: 3D pixels, concealed cards, reconnect, bet/call, all streets, settlement, next hand, rules, exit, desktop/mobile layouts.');
  } finally {
    for (const page of pages) {
      if (await page.locator('#exitButton').isVisible().catch(() => false)) {
        await page.locator('#exitButton').click({ timeout: 3000 }).catch(() => {});
      }
    }
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
