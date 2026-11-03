# Texas-Pokers

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Herbert0401/Texas-Pokers)

Online Short Deck Hold'em for 2-6 players, built with Node.js, WebSocket, and a static browser client.

## Features

- Players enter the same room with a four-digit code; seats open automatically up to six.
- The room owner starts once at least two players are online.
- Mid-hand arrivals wait for the next hand without changing existing cards, stacks or bets.
- Leaving folds the player's live hand (an all-in remains eligible). Refresh/reconnect preserves the hand for ten minutes.
- Main and side pots settle separately, with unmatched wagers refunded and odd chips awarded clockwise after the dealer.
- Busted players watch while remaining players continue. The owner can reset stacks only after the match ends.
- Short Deck rules: 36-card deck, A-6-7-8-9 low straight, flush beats full house.
- No small blind or big blind, with dealer position rotating every hand.
- Each player starts with 1000 chips.
- Supports fold, check, call, half-pot, two-thirds-pot, pot-size, all-in, and custom chip actions.
- Three.js 3D table, rounded cards, denomination-based chip stacks, and responsive desktop/mobile controls. Rendering libraries are vendored locally; no CDN is required.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser windows and join with the same four-digit room code.

## Deploy Online

Click the Deploy to Render button above, sign in to Render, connect GitHub if prompted, and approve the `texas-pokers` web service. Render will build with `npm install`, start with `npm start`, and provide an `onrender.com` URL when the deploy finishes.

## Tests

```bash
npm test
```

For browser verification, start the app and run `node scripts/verify-ui.cjs` with Playwright, pngjs, and Google Chrome available. The default target is `http://localhost:3133`; override it with `TEST_URL`. Screenshots are saved to `output/playwright/` (gitignored). This checks two-player actions, reconnect, settlement, 3D pixels/hover, and mobile layouts.

Run `node scripts/verify-multiplayer.cjs` for 20 complete four-player hands in isolated browser sessions. It starts and stops its own test server and saves per-hand actions, payouts, screenshots and errors in `output/playwright/multiplayer/`. It checks conservation of 4000 chips, private cards, dealer rotation, mobile layouts, side pots and mid-hand refresh recovery. `npm test` also covers short all-in raise rights, late joining/leaving and restoration after a server restart.

The existing short-deck hand evaluator is unchanged. Multiplayer betting follows the [Poker TDA side-pot and re-opening rules](https://www.pokertda.com/view-poker-tda-rules/); the no-blind structure remains a house rule. Entertainment mode remains opt-in for the whole room; its scripted pair is assigned randomly among the seats, while extra hands are dealt from the remaining deck.
