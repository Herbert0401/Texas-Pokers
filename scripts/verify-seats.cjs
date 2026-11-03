const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startTestServer } = require('./local-server.cjs');

(async () => {
  const server = await startTestServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = [];
  const errors = [];
  const output = path.join(__dirname, '../output/playwright/multiplayer');
  fs.mkdirSync(output, { recursive: true });
  try {
    let oldHand;
    for (let i = 0; i < 7; i++) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await context.newPage(); pages.push(p);
      p.on('pageerror', error => errors.push(error.message));
      await p.goto(server.url);
      await p.waitForFunction(() => document.body.classList.contains('three-ready'));
      await p.locator('#nameInput').fill(`Seat ${i + 1}`);
      await p.locator('#roomInput').fill('8844');
      await p.locator('#joinForm button').click();
      if (i === 6) {
        await p.locator('#toast').filter({ hasText: '满员' }).waitFor({ state: 'visible' });
        assert.equal(await p.locator('#joinView').isVisible(), true);
        await context.close(); pages.pop();
        break;
      }
      await p.locator('#gameView').waitFor({ state: 'visible' });
      if (i === 1) {
        await pages[0].locator('#startButton').click();
        for (const page of pages) await page.waitForFunction(() => Boolean(state?.game));
        const actor = await pages[0].evaluate(() => state.game.canAct) ? pages[0] : pages[1];
        await actor.locator('[data-action="betMin"]').click();
        await pages[0].waitForFunction(() => state.game.pot === 10);
        oldHand = await pages[0].evaluate(() => state.game);
      }
      if (i > 1) {
        assert.equal(await p.evaluate(() => state.game.canAct), false);
        assert.match(await p.locator('#actionHint').innerText(), /下一手/);
        assert.deepEqual(await pages[0].evaluate(() => state.game), oldHand);
      }
    }
    const actor = await pages[0].evaluate(() => state.game.canAct) ? pages[0] : pages[1];
    await actor.locator('[data-action="fold"]').click();
    await pages[0].locator('#gameOverDialog').waitFor({ state: 'visible' });
    await pages[0].locator('#resultNextHand').click();
    for (const p of pages) await p.waitForFunction(() => state?.game?.players.length === 6 && state.game.handNumber === 2);
    for (let i = 0; i < 6; i++) {
      const seat = await pages[0].evaluate(() => state.game.actionSeat);
      await pages[seat].waitForFunction(() => state.game.canAct);
      await pages[seat].locator('[data-action="check"]').click();
      for (const p of pages) await p.waitForFunction(old => state.game.actionSeat !== old || state.game.street === 'flop', seat);
    }
    for (const [width, height] of [[390, 844], [320, 568], [1440, 900]]) {
      await pages[0].setViewportSize({ width, height });
      await pages[0].waitForTimeout(1000);
      const layout = await pages[0].evaluate(() => {
        const panels = [...document.querySelectorAll('.felt .player-panel')].map(el => el.getBoundingClientRect());
        return { count: panels.length, overflow: document.documentElement.scrollWidth > innerWidth,
          overlap: panels.some((a, i) => panels.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2)) };
      });
      await pages[0].screenshot({ path: path.join(output, `six-player-${width}.png`) });
      assert.deepEqual(layout, { count: 6, overflow: false, overlap: false }, `six seats at ${width}`);
    }
    assert.deepEqual(errors, []);
    console.log('PASS: late joins preserve cards/chips/pot, sixth seat opens automatically, seventh rejected, six-way action order and layouts.');
  } finally {
    await browser.close();
    await server.stop();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
