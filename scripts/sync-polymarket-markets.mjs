import { Client } from 'pg'

const databaseUrl = process.env.DATABASE_URL
const inviteCode = process.env.LEAGUE_INVITE_CODE ?? 'START123'
const pageSize = Number(process.env.POLYMARKET_SYNC_PAGE_SIZE ?? 100)
const maxMarkets = Number(process.env.POLYMARKET_SYNC_LIMIT ?? 2000)

if (!databaseUrl) {
  console.error('DATABASE_URL is required.')
  process.exit(1)
}

function parseStringArray(value) {
  if (Array.isArray(value)) return value.map(String)
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.map(String) : []
    } catch {
      return []
    }
  }
  return []
}

function toBinaryMarket(item) {
  const outcomes = parseStringArray(item.outcomes)
  const prices = parseStringArray(item.outcomePrices).map(Number)
  const yesIndex = outcomes.findIndex((label) => label.toLowerCase() === 'yes')
  const noIndex = outcomes.findIndex((label) => label.toLowerCase() === 'no')
  const title = item.question || item.title
  if (!title || yesIndex === -1 || noIndex === -1) return null

  const volume = Number(item.volume ?? 0)
  const volumeLabel = Number.isFinite(volume)
    ? volume >= 1_000_000
      ? `$${(volume / 1_000_000).toFixed(1)}M live volume`
      : volume >= 1_000
        ? `$${(volume / 1_000).toFixed(1)}k live volume`
        : `$${volume.toFixed(0)} live volume`
    : 'Volume unavailable'

  return {
    externalId: String(item.id ?? title),
    title,
    stage: 'Live Polymarket Market',
    closes: item.endDate ? `Live on Polymarket · closes ${new Date(item.endDate).toLocaleString()}` : 'Close time unavailable',
    yesPrice: Math.round((prices[yesIndex] ?? 0.5) * 100),
    noPrice: Math.round((prices[noIndex] ?? 0.5) * 100),
    volume: volumeLabel,
    rawPayload: {
      status: item.closed ? 'Resolved' : 'Open',
      rules: 'Live read from Polymarket Gamma API and mirrored into fantasy play only.',
      gamma: item,
    },
  }
}

async function fetchGammaPage(offset) {
  const gammaUrl = new URL('https://gamma-api.polymarket.com/markets')
  gammaUrl.searchParams.set('limit', String(pageSize))
  gammaUrl.searchParams.set('offset', String(offset))
  gammaUrl.searchParams.set('closed', 'false')
  gammaUrl.searchParams.set('active', 'true')

  const response = await fetch(gammaUrl, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Polymarket Gamma fetch failed at offset ${offset}: ${response.status}`)
  }

  return response.json()
}

const marketsById = new Map()
for (let offset = 0; offset < maxMarkets; offset += pageSize) {
  const page = await fetchGammaPage(offset)
  if (!Array.isArray(page) || page.length === 0) break

  for (const item of page) {
    const market = toBinaryMarket(item)
    if (market) marketsById.set(market.externalId, market)
  }

  console.log(`Fetched ${page.length} Gamma markets at offset ${offset}; kept ${marketsById.size} binary markets.`)
  if (page.length < pageSize) break
}

const markets = [...marketsById.values()]

const client = new Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
})

await client.connect()
try {
  await client.query('begin')
  const league = await client.query('select id from leagues where invite_code = $1', [inviteCode])
  if (!league.rowCount) throw new Error(`League invite code not found: ${inviteCode}`)
  const leagueId = league.rows[0].id

  for (const market of markets) {
    const external = await client.query(
      `
        insert into external_markets (
          source, external_id, title, stage_label, closes_label, yes_price, no_price, volume_label, raw_payload
        )
        values ('polymarket', $1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        on conflict (source, external_id) do update set
          title = excluded.title,
          stage_label = excluded.stage_label,
          closes_label = excluded.closes_label,
          yes_price = excluded.yes_price,
          no_price = excluded.no_price,
          volume_label = excluded.volume_label,
          raw_payload = excluded.raw_payload,
          imported_at = now()
        returning id
      `,
      [
        market.externalId,
        market.title,
        market.stage,
        market.closes,
        market.yesPrice,
        market.noPrice,
        market.volume,
        JSON.stringify(market.rawPayload),
      ],
    )

    await client.query(
      `
        insert into league_markets (league_id, external_market_id, approval_source, status)
        values ($1, $2, 'polymarket_sync', 'approved')
        on conflict (league_id, external_market_id) do update set
          approval_source = excluded.approval_source,
          status = excluded.status
      `,
      [leagueId, external.rows[0].id],
    )
  }

  await client.query('commit')
  console.log(`Synced and approved ${markets.length} live Polymarket markets for ${inviteCode}.`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  await client.end()
}
