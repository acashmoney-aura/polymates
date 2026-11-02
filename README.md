# Polymates

Polymarket with your friends. Real Polymarket markets, fantasy dollars, private leagues, and an API that coding agents can trade through.

**Live site:** https://acashmoney-aura.github.io/polymates/

## What it does

- **Two league modes.**
  - **Mirror:** your orders fill against the live Polymarket order book. It's paper trading, with a leaderboard for you and your friends.
  - **Exchange:** the league runs its own central limit order book, where 20–30 people post bids and asks and trade only with each other. An optional house market maker quotes around the Polymarket price so books are never empty.
- **The markets are Polymarket's.** The catalog syncs from Polymarket every 90 seconds. Positions settle automatically when Polymarket resolves a market: winning shares pay $1, and open orders are cancelled.
- **League owners choose the markets.** They can leave every market on and switch individual events or outcomes off, or start hand-picked and switch on only what they want.
- **Agents can trade.**
  - A REST API with API keys.
  - An MCP server (`/mcp`) for Claude Code, Codex, Cursor and similar tools.
  - Hosted JavaScript bots that run on the backend every N seconds in a QuickJS/WebAssembly sandbox.
- **The UI is a Polymarket clone:** dark theme, category tabs, market cards with gauges, event pages with a price chart, order book and trade panel, a portfolio and a leaderboard. It's built mobile-first, with a bottom nav and a trade sheet on phones.

## Layout

```
src/          React + Vite frontend (GitHub Pages)
server/       Node 24 API (Cloud Run): matching engine, Polymarket sync, MCP, script runner
docs/API.md   REST / MCP / script reference
docs/polymarket-ui-spec.md   reverse-engineered UI spec the frontend follows
```

## Run locally

```bash
cd server && npm install && npm run dev        # API on :8787
```

```bash
npm install && npm run dev                     # web on :5173, talks to VITE_API_URL (default http://localhost:8787)
```

```bash
cd server && node test/smoke.mjs               # end-to-end test against a running API (API=http://localhost:8787)
```

With no `STATE_BUCKET` set, the API keeps its state in `server/data/state.json`.

## Deploy

1. Deploy the API to Cloud Run. This creates a GCS bucket for state and prints the service URL:

   ```bash
   ./server/deploy.sh
   ```

2. Point the website at the API, then push to `main`. GitHub Actions builds and publishes Pages:

   ```bash
   gh variable set POLYMATES_API_URL --body https://polymates-api-xxxx.run.app
   ```

The API runs as a single Cloud Run instance with CPU always on. The order books live in memory, and state is snapshotted to GCS every few seconds and on shutdown. That fits leagues of a few dozen people and avoids a database hop on every order.

## Rules

Fantasy dollars have no cash value: there are no deposits, withdrawals or prizes. This project isn't affiliated with Polymarket.
