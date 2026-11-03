const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const path = require('node:path');
const fs = require('node:fs');
const output = path.join(__dirname, '../output/playwright');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = [];
  const failures = [];
  const check = (condition, message) => { if (!condition) failures.push(message); };
  try {
    const room = String(1000 + Math.floor(Math.random() * 9000));
    for (const name of ['测试长名字甲乙丙丁戊己庚辛壬癸玩家', 'LongPlayerName12345']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await context.newPage(); pages.push(page);
      page.setDefaultTimeout(15000);
      page.on('pageerror', error => failures.push(error.message));
      await page.goto(process.env.TEST_URL || 'http://localhost:3133');
      await page.waitForFunction(() => document.body.classList.contains('three-ready'));
      await page.locator('#nameInput').fill(name);
      await page.locator('#roomInput').fill(room);
      await page.locator('#joinForm button').click();
      await page.locator('#gameView').waitFor({ state: 'visible' });
    }
    const [a, b] = pages;
    await a.locator('#startButton').click();
    for (const p of pages) await p.waitForFunction(() => state?.game);
    const actor = await a.evaluate(() => state.game.canAct) ? a : b;
    const other = actor === a ? b : a;
    await actor.locator('#customAmount').fill('300');
    await actor.locator('#customBet').click();
    for (const p of pages) await p.waitForFunction(() => state.game.pot === 300);
    check((await actor.locator('.waterline-row').innerText()).includes('持平 0'), 'unsettled bet must not show a loss');
    check((await actor.locator('#heroPanel .chip-row').first().innerText()).includes('本手投入 300'), 'show contribution separately');
    await actor.reload();
    await actor.waitForFunction(() => state?.game?.pot === 300);
    check((await actor.locator('.waterline-row').innerText()).includes('持平 0'), 'reload must preserve settled profit');
    for (const [width, height] of [[320, 568], [568, 320], [844, 390], [390, 844]]) {
      await other.setViewportSize({ width, height });
      await other.waitForTimeout(200);
      const layout = await other.evaluate(() => {
        const quickBottom = Math.max(...Array.from(document.querySelectorAll('.quick-actions button'), button => button.getBoundingClientRect().bottom));
        const custom = document.querySelector('.custom-row').getBoundingClientRect();
        return { overlap: quickBottom > custom.top, overflow: document.documentElement.scrollWidth > innerWidth };
      });
      check(!layout.overlap && !layout.overflow, `no overlapping controls/overflow at ${width}x${height}`);
      for (const selector of ['[data-action="call"]', '[data-action="allin"]', '#customBet']) {
        await other.locator(selector).evaluate(element => window.scrollTo(0, scrollY + element.getBoundingClientRect().top - 100));
        const accessible = await other.locator(selector).evaluate(element => {
          const r = element.getBoundingClientRect();
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
          return r.top >= 0 && r.bottom <= innerHeight && element.contains(hit);
        });
        check(accessible, `${selector} reachable at ${width}x${height}`);
      }
      await other.screenshot({ path: path.join(output, `fixed-controls-${width}.png`) });
    }
    await other.locator('[data-action="fold"]').click();
    await actor.locator('#gameOverDialog').waitFor({ state: 'visible' });
    check((await actor.locator('.waterline-row').innerText()).includes('持平 0'), 'uncalled bet is returned on fold');
    await actor.locator('#resultNextHand').click();
    for (const p of pages) await p.waitForFunction(() => state.game.handNumber === 2);
    const first = await a.evaluate(() => state.game.canAct) ? a : b;
    const second = first === a ? b : a;
    await first.locator('[data-action="allin"]').click();
    await second.waitForFunction(() => state.game.toCall === 1000);
    await second.evaluate(() => {
      window.presentationEvents = [];
      window.addEventListener('poker:state', event => {
        if (event.detail?.game) window.presentationEvents.push({
          at: performance.now(), board: event.detail.game.community.length,
          pot: event.detail.game.pot, result: Boolean(event.detail.game.result)
        });
      });
    });
    await second.locator('[data-action="call"]').click();
    await second.waitForTimeout(200);
    check(!(await second.locator('#gameOverDialog').isVisible()), 'result must wait for runout');
    check(await second.locator('#potText').innerText() === '底池 2000', 'keep final call in visible pot');
    check(!/赢得|获胜/.test(await second.locator('#historyList').innerText()), 'history must not reveal the result during runout');
    await second.screenshot({ path: path.join(output, 'fixed-allin-push.png') });
    await second.waitForTimeout(1900);
    await second.screenshot({ path: path.join(output, 'fixed-allin-flop.png') });
    await second.locator('#gameOverDialog').waitFor({ state: 'visible' });
    const events = await second.evaluate(() => window.presentationEvents);
    check(JSON.stringify(events.filter(e => !e.result).map(e => e.board)) === '[0,3,4,5]', 'runout must show flop, turn and river in order');
    check(events.at(-1).at - events[0].at >= 4000, 'result follows finished animations');
    const expected = await second.evaluate(() => state.game.players.find(p => p.isYou).chips - 1000);
    const profit = await second.locator('.waterline-row').innerText();
    check(profit.includes(expected === 0 ? '持平 0' : expected > 0 ? `水上 +${expected}` : `水下 ${-expected}`), 'settled profit uses payout, not contributions');
    await second.reload();
    await second.locator('#gameOverDialog').waitFor({ state: 'visible' });
    check(await second.locator('#potText').innerText() === '底池 0', 'refresh must not replay already-settled pot');
    const startNext = async () => {
      await a.locator('#gameOverDialog').waitFor({ state: 'visible' });
      const restart = await a.locator('#resultRestart').isVisible();
      await a.locator(restart ? '#resultRestart' : '#resultNextHand').click();
      for (const p of pages) await p.waitForFunction(() => state?.game && !state.game.result && !state.game.presentation);
      const bettor = await a.evaluate(() => state.game.canAct) ? a : b;
      const caller = bettor === a ? b : a;
      await bettor.locator('[data-action="allin"]').click();
      await caller.waitForFunction(() => state.game.toCall > 0);
      await caller.locator('[data-action="call"]').click();
      for (const p of pages) await p.waitForFunction(() => Boolean(state?.game?.presentation));
    };
    await startNext();
    await b.reload();
    await b.locator('#gameOverDialog').waitFor({ state: 'visible' });
    check(await b.locator('#potText').innerText() === '底池 0', 'reload during runout restores authoritative settlement');
    await b.waitForTimeout(5100);
    check(await b.evaluate(() => Boolean(state.game.result) && !state.game.presentation), 'reload must not resume stale animation');
    await startNext();
    await b.locator('#exitButton').click();
    await b.locator('#joinView').waitFor({ state: 'visible' });
    await b.waitForTimeout(5100);
    check(await b.locator('#joinView').isVisible() && !(await b.locator('#gameOverDialog').isVisible()), 'exit during runout must cancel delayed result');
    console.log(JSON.stringify({ failures, allinEvents: events }, null, 2));
    assert.deepEqual(failures, []);
  } finally {
    for (const p of pages) {
      if (await p.locator('#closeGameOver').isVisible()) await p.locator('#closeGameOver').click();
      if (await p.locator('#exitButton').isVisible()) await p.locator('#exitButton').click();
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
