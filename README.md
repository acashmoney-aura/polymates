# Polymates

Polymates is a **private fantasy prediction league platform**.

A league admin chooses which market sets the league allows, members receive fantasy bankrolls, trade simulated YES/NO markets, and compete with friends on portfolio value.

## Core product definition

To build this app properly, it needs six core pieces:

1. Product rules
2. Market engine
3. Data feed(s) for the chosen market sets
4. League / social system
5. Frontend app
6. Admin / settlement tools

The MVP should **not** start with real-money trading, sportsbooks, or a complex financial order book.
It should start with **simulated Polymarket-style markets** using fantasy dollars.

It can still use a **real Polymarket connection as a discovery/input layer** for whitelisting or mirroring live public markets into fantasy leagues.

## Product shape

Important correction:
- This should **not** be only World Cup.
- World Cup can be a strong **starter market pack**, but leagues should be able to allow different sets of markets.

Examples of market packs a league might allow later:
- World Cup
- NBA playoffs
- Champions League
- Elections
- Awards / entertainment
- Creator economy / internet events

For MVP, the system should support the concept of **league-approved market sets**, even if the first seeded content is a World Cup pack.

## MVP default rules

Recommended default format:

- Private friend league
- $10,000 fantasy starting balance
- Weekly bonus: $2,000 fantasy dollars
- YES / NO prediction markets
- Markets close at event start / lock time
- Markets settle after final outcome
- Leaderboard by portfolio value
- No real-money deposits or withdrawals

Important language:

- Fantasy dollars have **no cash value**
- No deposits
- No withdrawals
- No redeemable prizes unless compliance is handled later

## Core user flows

### User onboarding
- Sign up
- Create username
- Join or create league
- Receive fantasy bankroll

### League creation
- Create league
- Choose allowed market set(s)
- Invite friends by link / code
- Set bankroll rules

### Market browsing
- See open / upcoming markets
- View YES / NO prices
- Buy shares
- Sell shares
- Track portfolio

### Settlement
- Outcome resolves
- Balances update
- Leaderboard updates

## MVP feature list

### Accounts
- Email/password or Google login
- Username
- Profile picture

### Leagues
- Create league
- Invite friends
- Join league
- League settings
- Member list
- Allowed market sets

### Fantasy bankroll
- Starting balance
- Buying power
- Portfolio value
- Realized P/L
- Unrealized P/L

### Markets
Start simple:
- Binary YES / NO markets
- Event winner / result markets
- Advancement markets
- Draw / non-draw style markets where useful

### Trading
- Buy YES
- Buy NO
- Sell position
- View order receipt
- View portfolio
- Use AMM pricing for MVP, not an order book

### Leaderboards
- Overall leaderboard
- Weekly leaderboard
- Daily / event-window leaderboard
- Best trade
- Worst trade

### Admin panel
- Create markets
- Pause markets
- Resolve markets
- Edit incorrect outcomes
- View users / leagues
- Inspect trades
- Reset a league

## Technical stack

Recommended stack:

- Next.js
- React
- TypeScript
- Tailwind
- Supabase Auth
- Supabase Postgres
- Supabase Edge Functions
- Vercel

## Current public app setup

The app is now configured for:

- Public GitHub repository
- GitHub Pages deployment through GitHub Actions
- Supabase-backed runtime using the production publishable key
- Email/password Supabase Auth only
- Fantasy league gameplay plus read-only Polymarket account tracking

Production frontend config lives in `.env.production` and includes only public-safe values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` / Supabase publishable key

Do not commit service-role keys, database passwords, or Supabase personal access tokens.

Backend setup can be repeated without the Supabase CLI:

```bash
DATABASE_URL="postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres" npm run supabase:apply
```

This applies:

- `supabase/schema.sql`
- `supabase/seed.sql`

Optional later:
- Redis / Upstash
- Pusher / Ably / Supabase Realtime

## Backend model

Key concepts:

- Global markets grouped into market sets
- League-specific balances and leaderboards
- Fantasy-dollar trading only
- Simulated AMM pricing
- Real Polymarket connection for live market discovery
- League whitelists / imported external markets
- Trade intents that can later persist to Supabase
- Admin settlement tools

Main data entities:

- users
- leagues
- league_members
- market_sets
- events
- markets
- outcomes
- positions
- trades
- market_price_history
- league_snapshots
- activity_feed

A first-pass Supabase schema for this model lives at:

- `supabase/schema.sql`

## Market engine

For MVP, prefer a simple AMM:
- prices move when users buy / sell
- no real order book
- intuitive YES / NO trading loop

## App screens

- Landing page
- Dashboard
- League page
- Market page
- Portfolio page
- Leaderboard
- Admin page

## MVP build order

### Phase 1: Static prototype
- Landing page
- League dashboard
- Market page
- Portfolio page
- Leaderboard
- Use fake hardcoded data

### Phase 2: Database + auth
- Supabase auth
- Users
- Leagues
- League members
- Invite links
- Allowed market sets
- Starting balances

### Phase 3: Market engine
- Markets
- Outcomes
- Buy shares
- Sell shares
- Positions
- Trades
- Cash balance updates

### Phase 4: Settlement
- Admin resolves market
- Payouts calculated
- Portfolio updates
- Leaderboard updates

### Phase 5: Social layer
- Friend activity
- Comments
- Reactions
- Notifications

### Phase 6: Data integration
- Seeded market packs
- Auto-close logic
- Auto-settle from data feeds where available

## Smallest useful MVP

- Google login
- Create private league
- Invite friends
- $10,000 fantasy balance
- 10–20 manually created markets
- Buy / sell YES/NO shares
- Portfolio page
- Leaderboard
- Admin settlement
- Activity feed

## Do not include at first

- Real money
- Deposits
- Withdrawals
- Public markets
- User-created markets
- Player props / overly complex props
- Live in-game trading
- Parlays
- Prizes
- Crypto
- Complex order book
- Mobile app first

## Internal concept line

> Create a private fantasy prediction league, choose the market sets your league allows, and compete with friends on portfolio value.
