import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Request, Response } from 'express'
import { z } from 'zod'
import { agentApi } from './agent-api.ts'
import { leagueAdmin } from './leagues.ts'
import { runBacktest, scanner, STRATEGY_TEMPLATES } from './backtest.ts'
import { createScript, deleteScript, listScripts, scriptLogsFor, updateScript } from './script-api.ts'
import { runScript } from './scripts.ts'
import { db } from './state.ts'

const INSTRUCTIONS = `Polymates is a private fantasy prediction market for friend groups.
Markets are real Polymarket markets and resolve exactly as Polymarket resolves them; money is fantasy dollars.
Each league is either "mirror" (orders fill against Polymarket's live order book) or "exchange" (the league runs its own order book; you trade with other members).
Prices are probabilities in dollars per share (0.42 = 42¢); a winning share pays $1.
Typical flow: list_leagues -> search_markets -> get_order_book -> place_order -> get_portfolio.
Omit league_id to use your first league.
League management: create_league, join_league, get_league, update_league, set_event_enabled / set_market_enabled, set_member_role, remove_member, transfer_ownership, leave_league, reset_season, delete_league.
The owner can do everything; admins can change settings, switch markets and remove members. reset_season and delete_league need confirm = the exact league name; always ask the user before calling them.`

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] })
const leagueId = z.string().optional().describe('League id (default: your first league)')

function build(userId: string) {
  const api = agentApi(userId, 'mcp')
  const server = new McpServer({ name: 'polymates', version: '1.0.0' }, { instructions: INSTRUCTIONS })
  const tool = <S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    fn: (args: z.infer<z.ZodObject<S>>) => unknown,
  ) =>
    server.registerTool(name, { description, inputSchema: shape }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        return text(await fn(args))
      } catch (err) {
        return { ...text({ error: (err as Error).message }), isError: true }
      }
    }) as never)

  tool('whoami', 'Your account and the leagues you belong to.', {}, () => api.whoami())
  tool('list_leagues', 'Leagues you belong to, with mode (mirror/exchange) and cash.', {}, () => api.listLeagues())

  /* ---- league management ---- */
  const admin = leagueAdmin(userId)
  const lid = (x?: string) => x ?? api.listLeagues()[0]?.id ?? ''
  const member = z.string().describe('Member username (e.g. "maya") or user id')
  tool('create_league', 'Create a new league; you become its owner. Returns the league with its invite code.', {
    name: z.string().min(1).max(60),
    mode: z.enum(['mirror', 'exchange']).default('mirror').describe('mirror: fill against live Polymarket book; exchange: league runs its own order book'),
    starting_balance: z.number().min(100).max(10_000_000).default(10_000),
    market_scope: z.enum(['all', 'curated']).default('all').describe('all: every Polymarket market tradable; curated: only events you switch on'),
    house_liquidity: z.boolean().default(true).describe('exchange mode only: house market maker quotes around the Polymarket price'),
    description: z.string().max(280).optional(),
  }, (a) => admin.create({ name: a.name, mode: a.mode, startingBalance: a.starting_balance, marketScope: a.market_scope, houseLiquidity: a.house_liquidity, description: a.description }))
  tool('join_league', 'Join a league with an invite code.', { invite_code: z.string() }, (a) => admin.join(a.invite_code))
  tool('get_league', 'League settings, invite code, your role and the member list with roles.', { league_id: leagueId }, (a) => admin.get(lid(a.league_id)))
  tool('update_league', 'Admins: change the name, description, market scope, house liquidity or starting balance (applies to new joiners and the next season), or regenerate the invite code.', {
    league_id: leagueId,
    name: z.string().max(60).optional(),
    description: z.string().max(280).optional(),
    market_scope: z.enum(['all', 'curated']).optional(),
    house_liquidity: z.boolean().optional(),
    starting_balance: z.number().min(100).max(10_000_000).optional(),
    regenerate_invite: z.boolean().optional(),
  }, (a) => admin.update(lid(a.league_id), { name: a.name, description: a.description, marketScope: a.market_scope, houseLiquidity: a.house_liquidity, startingBalance: a.starting_balance, regenerateInvite: a.regenerate_invite }))
  tool('set_event_enabled', 'Admins: turn a whole event (all its outcomes) on or off for the league. Use search_markets to find the event id.', {
    event_id: z.string(), enabled: z.boolean(), league_id: leagueId,
  }, (a) => admin.setEventEnabled(lid(a.league_id), a.event_id, a.enabled))
  tool('set_market_enabled', 'Admins: turn one outcome market on or off for the league.', {
    market_id: z.string(), enabled: z.boolean(), league_id: leagueId,
  }, (a) => admin.setMarketEnabled(lid(a.league_id), a.market_id, a.enabled))
  tool('set_member_role', 'Owner: make a member an admin, or an admin a member.', { member, role: z.enum(['admin', 'member']), league_id: leagueId },
    (a) => admin.setRole(lid(a.league_id), a.member, a.role))
  tool('remove_member', 'Admins: remove someone with a lower role from the league. Cancels their orders and clears their positions.', { member, league_id: leagueId },
    (a) => admin.removeMember(lid(a.league_id), a.member))
  tool('transfer_ownership', 'Owner: hand the league to another member. You become an admin.', { member, league_id: leagueId },
    (a) => admin.transferOwnership(lid(a.league_id), a.member))
  tool('leave_league', 'Leave a league. Cancels your orders and clears your positions there. An owner must transfer ownership first unless they are the only member.', {
    league_id: z.string(),
  }, (a) => admin.leave(a.league_id))
  tool('reset_season', 'Owner: start a new season. Cancels all orders, clears positions and trades, and resets everyone to the starting balance. Ask the user first.', {
    league_id: z.string(), confirm: z.string().describe('The exact league name'),
  }, (a) => admin.resetSeason(a.league_id, a.confirm))
  tool('delete_league', 'Owner: permanently delete a league and all its data. Ask the user first.', {
    league_id: z.string(), confirm: z.string().describe('The exact league name'),
  }, (a) => admin.delete(a.league_id, a.confirm))

  tool(
    'search_markets',
    'Search tradable events. Returns events with their binary markets (market id, title, YES price 0..1, best bid/ask, volume).',
    {
      query: z.string().optional().describe('Text search over event and outcome titles'),
      category: z.string().optional().describe('trending | new | breaking | politics | sports | crypto | finance | tech | geopolitics | elections | pop-culture | economy | league'),
      limit: z.number().int().min(1).max(50).optional(),
      offset: z.number().int().min(0).optional(),
      league_id: leagueId,
    },
    (a) => api.listEvents({ leagueId: a.league_id ?? api.listLeagues()[0]?.id, q: a.query, tag: a.category, limit: a.limit ?? 10, offset: a.offset }),
  )
  tool('get_event', 'Full event by slug with every outcome market, rules text and prices.', { slug: z.string(), league_id: leagueId },
    (a) => api.getEvent(a.slug, a.league_id ?? api.listLeagues()[0]?.id))
  tool('get_market', 'One market by id with league price and Polymarket price.', { market_id: z.string(), league_id: leagueId },
    (a) => api.getMarket(a.market_id, a.league_id ?? api.listLeagues()[0]?.id))
  tool(
    'get_order_book',
    'Order book quoted in YES price. In exchange leagues this is the league book, in mirror leagues the live Polymarket book. NO price = 1 - YES price.',
    { market_id: z.string(), league_id: leagueId },
    (a) => api.getBook(a.market_id, a.league_id),
  )
  tool('get_portfolio', 'Cash, positions (with avg price, mark, P&L) and total value.', { league_id: leagueId }, (a) => api.getPortfolio(a.league_id))
  tool(
    'place_order',
    'Place an order. Limit: give price (0.01-0.99 for the chosen outcome) and size (shares). Market buy: give amount (dollars). Market sell: give size (shares).',
    {
      market_id: z.string(),
      side: z.enum(['buy', 'sell']),
      outcome: z.enum(['yes', 'no']),
      type: z.enum(['limit', 'market']).default('limit'),
      price: z.number().gt(0).lt(1).optional(),
      size: z.number().positive().optional(),
      amount: z.number().positive().optional(),
      league_id: leagueId,
    },
    (a) => api.placeOrder({ leagueId: a.league_id, marketId: a.market_id, side: a.side, outcome: a.outcome, type: a.type, price: a.price, size: a.size, amount: a.amount }),
  )
  tool('cancel_order', 'Cancel one of your open orders.', { order_id: z.string() }, (a) => api.cancelOrder(a.order_id))
  tool('cancel_all_orders', 'Cancel all your open orders (optionally only one market).', { market_id: z.string().optional(), league_id: leagueId },
    (a) => api.cancelAll(a.league_id, a.market_id))
  tool('list_orders', 'Your orders in a league.', { status: z.enum(['open', 'all']).default('open'), league_id: leagueId },
    (a) => api.listOrders(a.league_id, a.status))
  tool('list_trades', 'Recent fills in the league (optionally yours only / one market).', {
    market_id: z.string().optional(), mine: z.boolean().optional(), limit: z.number().int().max(200).optional(), league_id: leagueId,
  }, (a) => api.listTrades(a.league_id, { marketId: a.market_id, mine: a.mine, limit: a.limit }))
  const period = z.enum(['day', 'week', 'month', 'all'])
  const category = z.string().optional().describe('Polymarket category tag slug, e.g. "politics", "sports", "crypto" (prediction markets only)')
  tool('get_leaderboard', 'League standings over a period. Each row: rank, pnl, pnlPct (return), volume, trades, winRate on resolved markets, bestTrade, current streak and a per-source breakdown. Bots and scripts count toward their owner.', {
    league_id: leagueId,
    period: period.default('all').describe('day = last 24h, week = 7 days, month = 30 days, all = whole season'),
    sort: z.enum(['pnl', 'volume', 'return']).default('pnl'),
    category,
  }, (a) => api.getLeaderboard(a.league_id, { period: a.period, sort: a.sort, category: a.category }))
  tool('get_biggest_wins', 'Largest winning closed positions in the league over a period: who, which market, and cost -> payout.', {
    league_id: leagueId,
    period: period.default('month'),
    category,
    limit: z.number().int().min(1).max(50).default(10),
  }, (a) => api.getBiggestWins(a.league_id, { period: a.period, category: a.category, limit: a.limit }))
  tool('get_member_profile', 'A league member\'s stats for a period plus their open positions, recent trades and closed positions.', {
    member: z.string().describe('Member username or user id'),
    league_id: leagueId,
    period: period.default('all'),
  }, (a) => api.getMemberProfile(a.member, a.league_id, { period: a.period }))

  tool('get_price_history', 'Polymarket YES price history for a market: [{t (unix s), p (0..1)}].', {
    market_id: z.string(), range: z.enum(['1h', '6h', '1d', '1w', '1m', 'all']).default('1w'), n: z.number().int().min(1).max(5000).default(200),
  }, (a) => api.getHistory(a.market_id, a.n, a.range))
  tool('scan_markets', 'Quant scanner: negRisk overround (sum of YES != 100%), biggest 24h movers, coin-flips ending this week, widest spreads, high-volume long shots.', {}, () => scanner())
  tool('list_strategy_templates', 'Example strategies (momentum, mean reversion, market maker, longshot fade, buy & hold) you can backtest or upload.', {}, () => STRATEGY_TEMPLATES)
  tool(
    'run_backtest',
    'Backtest a strategy over Polymarket price history. Same code as upload_script: define onTick(pm) (and optionally initialize(pm)); pm.history(id, n) gives the last n bars with no lookahead. ' +
      'Returns stats (total return, Sharpe, Sortino, max drawdown, beta/alpha vs equal-weight buy-and-hold, win rate), the equity curve, fills and logs.',
    {
      code: z.string().min(1).max(100_000),
      market_ids: z.array(z.string()).min(1).max(8),
      range: z.enum(['1d', '1w', '1m', 'all']).default('1m'),
      cash: z.number().positive().default(1000),
      spread: z.number().min(0).max(0.2).default(0.02).describe('Simulated full bid/ask spread (0.02 = 2¢)'),
      fee_bps: z.number().min(0).max(1000).default(0),
      full: z.boolean().default(false).describe('Include the full equity curve and fill list'),
    },
    async (a) => {
      const r = await runBacktest({ code: a.code, marketIds: a.market_ids, range: a.range, cash: a.cash, spread: a.spread, feeBps: a.fee_bps })
      if (a.full) return r
      const step = Math.max(1, Math.floor(r.equity.length / 60))
      return { ...r, equity: r.equity.filter((_, i) => i % step === 0), fills: r.fills.slice(-50), logs: r.logs.slice(-50) }
    },
  )

  tool('list_scripts', 'Your hosted trading scripts.', { league_id: leagueId }, (a) => listScripts(userId, a.league_id ?? api.listLeagues()[0]?.id))
  tool(
    'upload_script',
    'Create or update a JavaScript bot that runs on the Polymates server every interval_sec seconds. Define function onTick(pm) { ... }. ' +
      'pm API: markets({q,tag,limit}), event(slug), market(id), book(id), portfolio(), orders(), leaderboard(), buy(id, outcome, price, size), sell(...), ' +
      'marketBuy(id, outcome, dollars), marketSell(id, outcome, shares), cancel(orderId), cancelAll(marketId?), log(...), store (persisted object).',
    {
      name: z.string().min(1).max(60),
      code: z.string().min(1).max(100_000),
      interval_sec: z.number().int().min(10).max(86_400).default(60),
      enabled: z.boolean().default(true),
      script_id: z.string().optional().describe('Update this script instead of creating a new one'),
      league_id: leagueId,
    },
    (a) =>
      a.script_id
        ? updateScript(userId, a.script_id, { name: a.name, code: a.code, intervalSec: a.interval_sec, enabled: a.enabled })
        : createScript(userId, { leagueId: a.league_id ?? api.listLeagues()[0]?.id, name: a.name, code: a.code, intervalSec: a.interval_sec, enabled: a.enabled }),
  )
  tool('run_script', 'Run a script once right now and return its result and recent logs.', { script_id: z.string() }, async (a) => {
    const s = db.scripts.get(a.script_id)
    if (!s || s.userId !== userId) throw new Error('Script not found')
    const result = await runScript(s)
    return { result, logs: scriptLogsFor(userId, s.id).slice(-30) }
  })
  tool('get_script_logs', 'Recent log lines from a script.', { script_id: z.string() }, (a) => scriptLogsFor(userId, a.script_id))
  tool('set_script_enabled', 'Turn a script on or off.', { script_id: z.string(), enabled: z.boolean() },
    (a) => updateScript(userId, a.script_id, { enabled: a.enabled }))
  tool('delete_script', 'Delete a script.', { script_id: z.string() }, (a) => deleteScript(userId, a.script_id))
  return server
}

/** Stateless Streamable HTTP MCP endpoint; the user comes from the Bearer API key. */
export async function handleMcp(req: Request, res: Response, userId: string) {
  const server = build(userId)
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  res.on('close', () => {
    void transport.close()
    void server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(req, res, req.body)
}
