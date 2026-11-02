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
| POST | `/api/auth/google` | `{credential}` (Google Identity Services ID token) | `{token, user, created}`; with a session it links Google to that account |
| GET | `/api/config` | | `{googleClientId}` (null when Google sign-in is off) |
| GET | `/api/me` | | `{user, leagues[]}` |
| GET/POST/DELETE | `/api/me/api-keys[/:id]` | `{name}` | keys (the secret is returned once, on create) |

### Leagues
Roles: the **owner** can do everything; **admins** can change settings, switch markets and remove members; **members** trade.

| Method | Path | Who | Notes |
|---|---|---|---|
| POST | `/api/leagues` | anyone | `{name, mode: 'mirror'\|'exchange', startingBalance, marketScope: 'all'\|'curated', houseLiquidity, description}` |
| POST | `/api/leagues/join` | anyone | `{inviteCode}` |
| GET | `/api/leagues/invite/:code` | public | preview |
| GET | `/api/leagues/:id` | member | settings, `season`, `myRole`, members with roles |
| PATCH | `/api/leagues/:id` | admin | `{name?, description?, marketScope?, houseLiquidity?, startingBalance?, regenerateInvite?}` |
| POST | `/api/leagues/:id/events/:eventId` | admin | `{enabled}`; turns a whole event on or off |
| POST | `/api/leagues/:id/markets/:marketId` | admin | `{enabled}`; turns one outcome market on or off |
| PATCH | `/api/leagues/:id/members/:userId` | owner | `{role: 'admin'\|'member'}` |
| DELETE | `/api/leagues/:id/members/:userId` | admin | removes someone with a lower role; cancels their orders, clears positions |
| POST | `/api/leagues/:id/transfer` | owner | `{userId}`; you become an admin |
| POST | `/api/leagues/:id/leave` | member | an owner must transfer first unless they are the only member |
| POST | `/api/leagues/:id/reset` | owner | `{confirm: '<league name>'}`; new season: orders, positions and trades cleared, cash reset |
| DELETE | `/api/leagues/:id` | owner | `{confirm: '<league name>'}`; deletes everything |
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

## Quant

| Method | Path | Notes |
|---|---|---|
| GET | `/api/backtest/templates` | starter strategies: momentum, mean reversion, market maker, longshot fade, buy & hold |
| POST | `/api/backtest` | `{code, marketIds[1-8], range: '1d'\|'1w'\|'1m'\|'all', cash, spread, feeBps}` (auth required) |
| GET | `/api/quant/scanner` | negRisk overround and arbs, 24h movers, coin flips ending this week, wide spreads, long shots. The top overround candidates carry a `clob` check against the live order books (see below) |
| POST | `/api/backtest/sweep` | `{...backtest body, params: [{name, values[]}]}`: run the strategy over a grid of 1-2 numeric constants, at most 30 runs (auth required) |
| POST | `/api/backtest/params` | `{code}` → `[{name, value}]`, the top-level numeric constants a sweep can vary |
| GET | `/api/quant/volatility?limit=30` | most volatile liquid markets: `vol1d`, `vol7d`, `regime` (1d ÷ 7d), `range7d`, `change7d`, a 7d sparkline and `category` |
| GET | `/api/markets/:id/volcone` | realized-vol cone: per window (1h, 6h, 1d, 3d, 1w) `min, p10, p25, median, p75, p90, max, current, percentile` |
| GET | `/api/markets/:id/microstructure?league=` | spread, microprice, imbalance within 1/2/5/10¢, cumulative depth per side; in exchange leagues also the trade `tape` and `flow` (buy/sell notional, net flow, VWAP) |
| GET | `/api/events/:slug/curve?league=` | term structure of a date-ladder event (see below) |
| GET | `/api/leagues/:id/risk` | your portfolio risk (see below) |

Volatility is in probability points per √day: over a window of `d` days, `√(Σ Δp² / d)`. A reading of 0.05 means the YES price typically moves about 5pp in a day.

Parameter sweeps substitute values into constants declared at the top level, such as `const FAST = 6, SLOW = 24`. A sweep holds one backtester slot and runs its cells one after another, with a 90-second budget; `truncated: true` means the grid is partial. Each cell reports `sharpe, totalReturn, maxDrawdown, trades, winRate`, and `best` is the cell with the highest Sharpe.

The event curve applies to events whose outcomes are dates:
- `kind: 'by'` is a cumulative ladder ("X by June / by Sept"), so prices must rise with the date.
- `kind: 'through'` is a survival ladder ("ceasefire holds through…"), so prices must fall.
- Each rung has `price`, `survival`, `conditional` (the chance the event happens in that window, given it hadn't yet), and `hazardPerDay = −ln(S₂/S₁)/Δdays`.
- `violations` lists adjacent dates priced the wrong way round, with the calendar trade that captures the gap.
- For other events, `kind` is `'none'`.

The scanner's `clob` field, on the top overround candidates:
- `sumAsk` and `sumBid` are recomputed from the live CLOB books.
- `arb` is set only if the live books confirm it.
- `size` is the number of complete sets available at the top of book on every leg.
- `profit` is `edge × size`.

Portfolio risk returns:
- `expected`: payout and P&L if every market resolves with the probability it trades at now.
- `resolution`: payout σ assuming independence and weighted by 7-day price-change correlations, their ratio, and best and worst case.
- `var1d95`: one-day 95% mark-to-market VaR.
- `concentration`: HHI and effective number of positions.
- `categories`: exposure by category.
- Per position: `ifYes`/`ifNo` scenario P&L, `netDelta`, `dailyVol` and `riskContribution`.
- The correlation matrix.

How the backtester works:
- It runs the same `onTick(pm)` code as hosted scripts. You can also define `initialize(pm)`, which runs once.
- The code is replayed bar by bar over Polymarket price history on a regular time grid.
- `pm.history(id, n)` returns the last `n` bars, and the strategy never sees data from the future.
- Fills are simulated against a book of ±`spread/2` around the historical price.
- Markets that Polymarket has resolved settle at their payout.

Results include:
- the equity curve, with drawdown and an equal-weight buy-and-hold benchmark;
- total and annualized return, Sharpe, Sortino, volatility and max drawdown;
- beta and alpha against the benchmark;
- win rate, exposure, fees, the list of fills and your logs.

Live scripts also get `pm.history(id, n)`, so a strategy you backtested runs unchanged when you deploy it.

## MCP

Endpoint `POST {BASE}/mcp`, stateless Streamable HTTP, `Authorization: Bearer pm_…`.

```bash
claude mcp add --transport http polymates https://YOUR-API/mcp --header "Authorization: Bearer pm_..."
```

```json
{ "mcpServers": { "polymates": { "url": "https://YOUR-API/mcp", "headers": { "Authorization": "Bearer pm_..." } } } }
```

Tools: `whoami, list_leagues, create_league, join_league, get_league, update_league, set_event_enabled, set_market_enabled, set_member_role, remove_member, transfer_ownership, leave_league, reset_season, delete_league, search_markets, get_price_history, scan_markets, list_strategy_templates, run_backtest, run_parameter_sweep, list_sweep_params, get_volatility, get_market_microstructure, get_event_curve, get_portfolio_risk, get_event, get_market, get_order_book, get_portfolio, place_order, cancel_order, cancel_all_orders, list_orders, list_trades, get_leaderboard, list_scripts, upload_script, run_script, get_script_logs, set_script_enabled, delete_script`. Omit `league_id` to use your first league.

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

`pm` API: `markets({q, tag, limit})`, `event(slug)`, `market(id)`, `book(id)`, `history(id, n)`, `portfolio()`, `orders()`, `leaderboard()`, `order({...})`, `buy(id, outcome, price, size)`, `sell(...)`, `marketBuy(id, outcome, dollars)`, `marketSell(id, outcome, shares)`, `cancel(orderId)`, `cancelAll(marketId?)`, `log(...)`, plus `store` (JSON persisted between runs, up to 64KB), `now`, `mode`, `leagueId`.

Sandbox limits:
- Scripts run in QuickJS compiled to WebAssembly, with no network, filesystem, timers or Node APIs.
- Each tick gets 5 seconds of wall time, 32 MB of memory and at most 200 `pm` calls.
- Each person can have up to 10 scripts.
- A script that errors 10 times in a row is switched off.
