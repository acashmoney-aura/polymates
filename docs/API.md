# Polymates API

Everything the website does goes through this API, so anything a person can do, an agent can do too. There are three ways in:

1. **REST:** plain HTTPS + JSON.
2. **MCP:** a Streamable HTTP MCP server at `/mcp` for Claude Code, Codex, Cursor and other agents.
3. **Hosted scripts:** JavaScript bots you upload; they run on the Polymates backend on a timer.

Base URL: your deployment, e.g. `https://polymates-api-xxxxx.us-east1.run.app`. Locally: `http://localhost:8787`.

## Concepts

- **League:** a private game. Members start with the same fantasy bankroll.
  - `mirror` mode: orders fill against the **live Polymarket order book** (paper trading with friends).
  - `exchange` mode: the league runs **its own order book** and members trade only with each other. Optionally a house market maker quotes ±2¢ around the Polymarket price so books are never empty.
- **Markets** are Polymarket markets (same ids as Polymarket's Gamma API). They **resolve exactly as Polymarket resolves them**. When Polymarket settles a market, open orders are cancelled and each winning share pays $1.
- League owners can turn individual events or outcome markets on or off. "All on" leagues allow every Polymarket market; "hand-picked" leagues allow only what the owner enables.
- **Prices** are dollars per share in `0..1` (`0.42` = 42¢ = 42% implied probability).
- **Order book model:** same as Polymarket. Each binary market has one book quoted in **YES** price:
  - buy YES @ p is a bid at p; sell YES @ p is an ask at p.
  - buy NO @ q is an ask at `1-q`; sell NO @ q is a bid at `1-q`.
  - So a YES buyer and a NO buyer can match each other (shares are minted), and so can two sellers (shares are merged).

## Auth

| Credential | How to get it | Use |
|---|---|---|
| Session token | `POST /api/auth/signup` or `/api/auth/login` | Website |
| API key `pm_…` | Website → Agents & API → Create key (or `POST /api/me/api-keys` with a session) | Agents, scripts, curl |

Send either as `Authorization: Bearer <token>`. API keys act as you in every league you belong to.

## REST endpoints

### Account
| Method | Path | Body / query | Returns |
|---|---|---|---|
| POST | `/api/auth/signup` | `{username, password, displayName?}` | `{token, user}` |
| POST | `/api/auth/login` | `{username, password}` | `{token, user}` |
| GET | `/api/me` | | `{user, leagues[]}` |
| GET/POST/DELETE | `/api/me/api-keys[/:id]` | `{name}` | keys (the secret is returned once, on create) |

### Leagues
| Method | Path | Notes |
|---|---|---|
| POST | `/api/leagues` | `{name, mode: 'mirror'\|'exchange', startingBalance, marketScope: 'all'\|'curated', houseLiquidity}` |
| POST | `/api/leagues/join` | `{inviteCode}` |
| GET | `/api/leagues/invite/:code` | public preview |
| GET | `/api/leagues/:id` | settings + members |
| PATCH | `/api/leagues/:id` | owner: `{name?, marketScope?, houseLiquidity?, regenerateInvite?}` |
| POST | `/api/leagues/:id/events/:eventId` | owner: `{enabled}`; turns a whole event on or off |
| POST | `/api/leagues/:id/markets/:marketId` | owner: `{enabled}`; turns one outcome market on or off |
| GET | `/api/leagues/:id/leaderboard` | ranked by P&L |
| GET | `/api/leagues/:id/activity` | feed |

### Markets
`?league=<id>` is optional on all of these. With it, prices and books are the league's (exchange mode) and `enabled` reflects the league's toggles.

| Method | Path | Query |
|---|---|---|
| GET | `/api/events` | `tag` (`trending`, `new`, `breaking`, `league`, `politics`, `sports`, `crypto`, …), `q`, `sort` (`trending`, `volume`, `volume24h`, `new`, `ending`), `limit`, `offset` |
| GET | `/api/events/:slug` | full event with every outcome market and the rules text |
| GET | `/api/markets` | flat list of tradable markets (`q`, `tag`, `limit`); the handiest for bots |
| GET | `/api/markets/:id` | one market |
| GET | `/api/markets/:id/book` | `{source: 'league'\|'polymarket', bids, asks, last, tick}` in YES price |
| GET | `/api/markets/:id/history` | `range` = `1h`, `6h`, `1d`, `1w`, `1m`, `all` (Polymarket price history) |

Market object fields: `id, eventId, question, title, outcomes, price` (league YES price), `polymarketPrice, bestBid, bestAsk, lastTrade, volume, leagueVolume, endDate, tick, active, resolved, payout, enabled`.

### Trading
| Method | Path | Body |
|---|---|---|
| POST | `/api/leagues/:id/orders` | see below |
| GET | `/api/leagues/:id/orders?status=open\|all` | your orders |
| DELETE | `/api/orders/:orderId` | cancel one |
| DELETE | `/api/leagues/:id/orders?market=<id>` | cancel all (optionally one market) |
| GET | `/api/leagues/:id/portfolio` | `{cash, availableCash, positionsValue, value, pnl, realized, positions[]}` |
| GET | `/api/leagues/:id/trades?mine=1&market=<id>&limit=` | fills |

Order bodies:

```jsonc
// limit: rests on the book until filled or cancelled (GTC)
{ "marketId": "540816", "side": "buy", "outcome": "yes", "type": "limit", "price": 0.42, "size": 100 }

// market buy: spend up to $25, fill-and-kill
{ "marketId": "540816", "side": "buy", "outcome": "no", "type": "market", "amount": 25 }

// market sell: sell 40 shares, fill-and-kill
{ "marketId": "540816", "side": "sell", "outcome": "yes", "type": "market", "size": 40 }
```

The response is `{order, fills: [{price, size}], avgPrice, cash}`. Buy orders reserve `price × size` of cash and sell orders reserve shares, so you can't over-commit.

### Live stream
`GET /api/stream?league=<id>&token=<token>` is Server-Sent Events. Message types: `trade, book, orders, activity, resolve, league`, each with `marketId` where relevant. Refetch what you need when a message arrives.

## MCP

Endpoint `POST {BASE}/mcp`, stateless Streamable HTTP, `Authorization: Bearer pm_…`.

```bash
claude mcp add --transport http polymates https://YOUR-API/mcp --header "Authorization: Bearer pm_..."
```

```json
{ "mcpServers": { "polymates": { "url": "https://YOUR-API/mcp", "headers": { "Authorization": "Bearer pm_..." } } } }
```

Tools: `whoami, list_leagues, search_markets, get_event, get_market, get_order_book, get_portfolio, place_order, cancel_order, cancel_all_orders, list_orders, list_trades, get_leaderboard, list_scripts, upload_script, run_script, get_script_logs, set_script_enabled, delete_script`. Omit `league_id` to use your first league.

## Hosted scripts

Upload with the website editor, `upload_script` over MCP, or REST:

| Method | Path | Body |
|---|---|---|
| GET | `/api/leagues/:id/scripts` | |
| POST | `/api/leagues/:id/scripts` | `{name, code, intervalSec ≥ 10, enabled}` |
| PATCH | `/api/scripts/:sid` | any of `{name, code, intervalSec, enabled, resetStore}` |
| POST | `/api/scripts/:sid/run` | run once now → `{result, logs}` |
| GET | `/api/scripts/:sid/logs` | last 200 lines |
| DELETE | `/api/scripts/:sid` | |

A script defines `onTick(pm)`:

```js
function onTick(pm) {
  for (const m of pm.markets({ tag: 'politics', limit: 10 })) {
    const book = pm.book(m.id)                    // YES-price book
    const mid = (book.bids[0]?.price + book.asks[0]?.price) / 2
    if (!Number.isFinite(mid)) continue
    pm.cancelAll(m.id)
    pm.buy(m.id, 'yes', Math.max(0.01, mid - 0.03), 20)   // quote both sides
    pm.buy(m.id, 'no', Math.max(0.01, 1 - mid - 0.03), 20)
  }
  pm.store.ticks = (pm.store.ticks ?? 0) + 1
  pm.log('tick', pm.store.ticks, 'cash', pm.portfolio().cash)
}
```

`pm` API: `markets({q, tag, limit})`, `event(slug)`, `market(id)`, `book(id)`, `portfolio()`, `orders()`, `leaderboard()`, `order({...})`, `buy(id, outcome, price, size)`, `sell(...)`, `marketBuy(id, outcome, dollars)`, `marketSell(id, outcome, shares)`, `cancel(orderId)`, `cancelAll(marketId?)`, `log(...)`, plus `store` (JSON persisted between runs, up to 64KB), `now`, `mode`, `leagueId`.

Sandbox limits:
- Scripts run in QuickJS compiled to WebAssembly, with no network, filesystem, timers or Node APIs.
- Each tick gets 5 seconds of wall time, 32 MB of memory and at most 200 `pm` calls.
- Each person can have up to 10 scripts.
- A script that errors 10 times in a row is switched off.
