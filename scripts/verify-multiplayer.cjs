const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { PNG } = require('pngjs');
const { startTestServer } = require('./local-server.cjs');

const output = path.join(__dirname, '../output/playwright/multiplayer');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const server = await startTestServer();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const pages = [];
  const errors = [];
  const report = { hands: [], refreshes: [], layouts: [], errors };
  const read = page => page.evaluate(() => state);
  const signature = game => JSON.stringify([game.handNumber, game.street, game.actionSeat, game.pot, game.currentBet, game.result, game.players.map(p => [p.folded, p.bet, p.chips, p.totalBet])]);
  try {
    for (let i = 0; i < 4; i++) {
      const context = await browser.newContext({ viewport: i === 1 ? { width: 390, height: 844 } : { width: 1440, height: 900 }, isMobile: i === 1, hasTouch: i === 1 });
      const page = await context.newPage();
      page.setDefaultTimeout(12000);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
      pages.push(page);
      await page.goto(server.url);
      await page.waitForFunction(() => document.body.classList.contains('three-ready'));
      await page.locator('#nameInput').fill(['River', 'Herbert', '测试长名字甲乙丙丁戊己庚辛壬癸玩家', 'Maya'][i]);
      await page.locator('#roomInput').fill('4268');
      await page.locator('#joinForm button').click();
      await page.locator('#gameView').waitFor({ state: 'visible' });
    }
    await pages[0].locator('#startButton').click();
    for (const p of pages) await p.waitForFunction(() => state?.game?.players.length === 4);
    let lastDealer = null;
    for (let hand = 1; hand <= 20; hand++) {
      for (const p of pages) await p.waitForFunction(n => state?.game?.handNumber === n && !state.game.result, hand);
      let current = await read(pages[0]);
      assert.equal(current.game.players.length, 4, 'all four players participate in each of the 20 hands');
      if (lastDealer !== null) assert.equal(current.game.dealerSeat, (lastDealer + 1) % 4);
      lastDealer = current.game.dealerSeat;
      const entry = { hand, dealer: lastDealer, actions: [], result: null };
      report.hands.push(entry);
      const streetActions = {};
      const seenStreets = new Set();
      for (let guard = 0; guard < 100; guard++) {
        current = await read(pages[0]);
        if (current.game.presentation) {
          for (const p of pages) await p.waitForFunction(() => Boolean(state?.game?.result));
          current = await read(pages[0]);
        }
        if (current.game.result) break;
        assert.equal(current.game.players.reduce((sum, p) => sum + p.chips, current.game.pot), 4000, 'chips conserved while betting');
        const actorId = current.game.players.find(p => p.seat === current.game.actionSeat).id;
        let actor;
        for (const p of pages) if ((await read(p)).you === actorId) actor = p;
        await actor.waitForFunction(() => state?.game?.canAct);
        const actorState = await read(actor);
        for (const opponent of actorState.game.players.filter(p => !p.isYou)) assert.equal(opponent.holeCards, null, 'opponent hands remain private');
        const game = actorState.game;
        const street = game.street;
        const count = streetActions[street] || 0;
        let selector;
        let amount = null;
        if (hand === 20) {
          selector = await actor.locator('[data-action="allin"]').isEnabled() ? '[data-action="allin"]' : '[data-action="call"]';
        } else if (hand % 6 === 0 && street === 'preflop' && count > 0) {
          selector = '[data-action="fold"]';
        } else if (hand % 4 === 0 && street === 'preflop' && count === 1) {
          selector = '[data-action="fold"]';
        } else if (hand > 1 && street === 'preflop' && count === 0) {
          selector = '[data-action="betMin"]';
        } else if (hand % 3 === 0 && street === 'preflop' && count === 1) {
          selector = '[data-bb="2"]';
        } else if (hand % 5 === 0 && street === 'river' && count === 0) {
          selector = '#customBet'; amount = 10;
        } else selector = game.toCall > 0 ? '[data-action="call"]' : '[data-action="check"]';

        if (hand === 2 && !seenStreets.has(street) && street === 'flop') {
          await pages[0].waitForTimeout(1200);
          for (const [width, height] of [[390, 844], [320, 568], [568, 320], [768, 1024]]) {
            await pages[1].setViewportSize({ width, height });
            await pages[1].evaluate(() => scrollTo(0, 0));
            await pages[1].waitForTimeout(150);
            const layout = await pages[1].evaluate(() => {
              const panels = [...document.querySelectorAll('.felt .player-panel')].map(el => el.getBoundingClientRect());
              const overlaps = panels.some((a, i) => panels.slice(i + 1).some(b => Math.min(a.right, b.right) - Math.max(a.left, b.left) > 2 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 2));
              const quickBottom = Math.max(...[...document.querySelectorAll('.quick-actions button')].map(el => el.getBoundingClientRect().bottom));
              return { overlaps, overflow: document.documentElement.scrollWidth > innerWidth,
                actionOverlap: quickBottom > document.querySelector('.custom-row').getBoundingClientRect().top,
                actionsBottom: document.querySelector('.actions-panel').getBoundingClientRect().bottom,
                historyTop: document.querySelector('.history-panel').getBoundingClientRect().top };
            });
            report.layouts.push({ width, height, ...layout });
            assert.equal(layout.overflow, false, `overflow ${width}`);
            assert.equal(layout.overlaps, false, `seat overlap ${width}`);
            assert.equal(layout.actionOverlap, false, `action overlap ${width}`);
            if (width === 390) {
              assert.ok(layout.actionsBottom < height);
              assert.ok(layout.historyTop < height - 20);
            }
            const pixels = PNG.sync.read(await pages[1].locator('#tableScene canvas').screenshot());
            const colors = new Set();
            for (let i = 0; i < pixels.data.length; i += 64) colors.add(`${pixels.data[i]},${pixels.data[i + 1]},${pixels.data[i + 2]}`);
            assert.ok(colors.size > 100, 'mobile 3D canvas is nonblank');
            await pages[1].screenshot({ path: path.join(output, `four-player-${width}.png`) });
          }
          await pages[1].setViewportSize({ width: 390, height: 844 });
          await pages[0].screenshot({ path: path.join(output, 'four-player-desktop.png') });
        }
        seenStreets.add(street);
        const oldSig = signature(game);
        if (amount) await actor.locator('#customAmount').fill(String(amount));
        await actor.locator(selector).click();
        streetActions[street] = count + 1;
        entry.actions.push({ seat: game.actionSeat, street, control: selector, amount });
        for (const p of pages) await p.waitForFunction(old => {
          const g = state.game;
          return JSON.stringify([g.handNumber, g.street, g.actionSeat, g.pot, g.currentBet, g.result, g.players.map(p => [p.folded, p.bet, p.chips, p.totalBet])]) !== old;
        }, oldSig);
        if ([5, 12].includes(hand) && entry.actions.length === 2) {
          const before = (await read(actor)).game;
          await actor.reload();
          await actor.waitForFunction(() => Boolean(state?.game));
          assert.deepEqual((await read(actor)).game, before, 'refresh restores complete hand state');
          report.refreshes.push(hand);
        }
        assert.ok(guard < 99, 'hand must terminate');
      }
      for (const p of pages) await p.waitForFunction(() => Boolean(state?.game?.result));
      const results = [];
      for (const p of pages) results.push((await read(p)).game);
      const final = results[0];
      assert.equal(final.players.reduce((sum, p) => sum + p.chips, 0), 4000);
      for (const game of results) {
        assert.deepEqual(game.result, final.result);
        assert.deepEqual(game.players.map(p => [p.id, p.chips, p.holeCards]), final.players.map(p => [p.id, p.chips, p.holeCards]));
      }
      const allCards = [...final.community, ...final.players.flatMap(p => p.holeCards)];
      assert.equal(new Set(allCards.map(c => c.rank + c.suit)).size, allCards.length);
      entry.result = final.result;
      entry.chips = final.players.map(p => p.chips);
      console.log(`Hand ${hand}/20: ${entry.actions.length} actions; ${final.result.text}; chips=${entry.chips}`);
      if (hand === 20) {
        await pages[0].screenshot({ path: path.join(output, 'twentieth-result.png') });
        assert.ok(final.result.pots.length >= 2, 'unequal four-way all-in exercises side pots');
      } else {
        assert.equal(final.gameOver, false);
        await pages[0].locator('#resultNextHand').click();
      }
    }
    assert.deepEqual(errors, []);
    report.completedHands = report.hands.length;
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = error.stack;
    for (let i = 0; i < pages.length; i++) await pages[i].screenshot({ path: path.join(output, `failure-${i}.png`) }).catch(() => {});
    throw error;
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
    await server.stop();
  }
  console.log('PASS: 20 complete four-player hands, desktop/mobile 3D, chip conservation, side pots, private cards and reconnect.');
})().catch(error => { console.error(error); process.exitCode = 1; });
