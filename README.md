# Texas-Pokers

Two-player online Short Deck Hold'em table built with Node.js, WebSocket, and a static browser client.

## Features

- Two players enter the same room with a four-digit code.
- The room owner starts the game after both players join.
- Short Deck rules: 36-card deck, A-6-7-8-9 low straight, flush beats full house.
- No small blind or big blind, with dealer position rotating every hand.
- Each player starts with 2000 chips.
- Supports fold, check, call, half-pot, two-thirds-pot, pot-size, all-in, and custom chip actions.

## Run Locally

```bash
npm install
npm start
```

Open `http://localhost:3000` in two browser windows and join with the same four-digit room code.

## Tests

```bash
npm test
```
