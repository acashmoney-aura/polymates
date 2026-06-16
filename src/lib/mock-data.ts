import type {
  Activity,
  LeagueConfig,
  LeagueMember,
  LeagueMode,
  Market,
  MarketSet,
  Position,
  ResolutionItem,
} from './types'

export const marketSets: MarketSet[] = [
  {
    slug: 'world-cup',
    title: 'World Cup',
    description: 'Match winner, advancement, and tournament futures packaged for private leagues.',
    eventCount: 64,
    leagueCount: 14,
  },
  {
    slug: 'nba-playoffs',
    title: 'NBA Playoffs',
    description: 'Series winners, finals futures, and matchup outcomes for hoops-heavy groups.',
    eventCount: 28,
    leagueCount: 9,
  },
  {
    slug: 'elections',
    title: 'Elections',
    description: 'High-signal political markets for private leagues that want slower, thesis-driven play.',
    eventCount: 18,
    leagueCount: 6,
  },
]

export const leagueConfig: LeagueConfig = {
  name: 'Friday Night Futures',
  inviteCode: 'START123',
  inviteLink: 'polymates.app/join/START123',
  approvedSetSlugs: ['world-cup', 'nba-playoffs'],
  memberCount: 8,
  startingBalance: 10000,
  weeklyBonus: 2000,
}

export const leagueMembers: LeagueMember[] = [
  { name: 'Akash', rank: 1, portfolio: '$10,842', pnl: '+$842', note: 'Macro sharp this week' },
  { name: 'Maya', rank: 2, portfolio: '$10,615', pnl: '+$615', note: 'Champion market sniper' },
  { name: 'Arnav', rank: 3, portfolio: '$10,201', pnl: '+$201', note: 'Grinding match winners' },
  { name: 'Jason', rank: 4, portfolio: '$9,744', pnl: '-$256', note: 'Needs one good bounce-back' },
]

export const markets: Market[] = [
  {
    id: 'bra-mor',
    title: 'Will Brazil beat Morocco?',
    stage: 'Quarterfinal',
    closes: 'Closes at kickoff · Fri 3:00 PM',
    yesPrice: 62,
    noPrice: 40,
    volume: '$18.4k fantasy volume',
    rules: 'Resolves YES if Brazil wins in regular time. Resolves NO otherwise.',
    status: 'Open',
  },
  {
    id: 'usa-par',
    title: 'Will USA beat Paraguay?',
    stage: 'Group Stage',
    closes: 'Closes at kickoff · Sat 12:00 PM',
    yesPrice: 58,
    noPrice: 44,
    volume: '$12.7k fantasy volume',
    rules: 'Resolves YES if USA wins. Resolves NO if draw or Paraguay win.',
    status: 'Closing Soon',
  },
  {
    id: 'arg-advance',
    title: 'Will Argentina advance?',
    stage: 'Knockout',
    closes: 'Closes at kickoff · Sun 8:00 PM',
    yesPrice: 73,
    noPrice: 29,
    volume: '$21.1k fantasy volume',
    rules: 'Resolves YES if Argentina advances from the round. Resolves NO otherwise.',
    status: 'Open',
  },
]

export const positions: Position[] = [
  { market: 'Will Brazil beat Morocco?', side: 'YES', shares: 100, avgPrice: 0.62, currentValue: '$66', pnl: '+$4' },
  { market: 'Will USA beat Paraguay?', side: 'NO', shares: 80, avgPrice: 0.41, currentValue: '$35', pnl: '+$2' },
  { market: 'Will Argentina advance?', side: 'YES', shares: 60, avgPrice: 0.69, currentValue: '$44', pnl: '+$3' },
]

export const activityFeed: Activity[] = [
  { user: 'Maya', text: 'bought $320 YES on Brazil to beat Morocco.', time: '9 min ago' },
  { user: 'Arnav', text: 'sold champion shares for +$118 fantasy profit.', time: '26 min ago' },
  { user: 'Jason', text: 'jumped into USA vs Paraguay after line movement.', time: '41 min ago' },
  { user: 'Akash', text: 'moved to #1 in the league after two good exits.', time: '1 hr ago' },
]

export const resolutionQueue: ResolutionItem[] = [
  {
    id: 'resolve-bra-mor',
    marketTitle: 'Will Brazil beat Morocco?',
    league: 'Friday Night Futures',
    result: 'Pending',
    status: 'Ready',
    note: 'Official final available. Ready to settle league positions.',
  },
  {
    id: 'resolve-usa-par',
    marketTitle: 'Will USA beat Paraguay?',
    league: 'Weekly Sprint 04',
    result: 'Pending',
    status: 'Paused',
    note: 'Kickoff shifted. Admin should relock before reopening.',
  },
  {
    id: 'resolve-arg-advance',
    marketTitle: 'Will Argentina advance?',
    league: 'Friday Night Futures',
    result: 'YES',
    status: 'Resolved',
    note: 'League balances and snapshots already updated.',
  },
]

export const leagueModes: LeagueMode[] = [
  {
    title: 'Season League',
    body: '$10,000 starting balance. Full tournament or event-pack run. Leaderboard by total portfolio value.',
  },
  {
    title: 'Weekly Sprint',
    body: '$2,500 weekly reset. Faster loops and weekly winners across any active market set.',
  },
  {
    title: 'Matchday Room',
    body: '$1,000 temporary bankroll for one slate, one debate, or one event window.',
  },
]
