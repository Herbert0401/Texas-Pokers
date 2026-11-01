# Texas-Pokers

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Herbert0401/Texas-Pokers)

Two-player online Short Deck Hold'em table built with Node.js, WebSocket, and a static browser client.

## Features

- Two players enter the same room with a four-digit code.
- The room owner starts the game after both players join.
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
