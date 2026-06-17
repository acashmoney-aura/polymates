insert into market_sets (slug, name, description, category)
values
  ('world-cup', 'World Cup', 'Starter pack for international football leagues.', 'sports'),
  ('nba-playoffs', 'NBA Playoffs', 'Playoff markets for basketball-focused leagues.', 'sports'),
  ('elections', 'Elections', 'Longer-horizon political prediction pack.', 'politics')
on conflict (slug) do nothing;

insert into leagues (name, creator_id, starting_balance, weekly_bonus, mode, invite_code)
values
  ('Dorm World Cup League', null, 10000, 2000, 'season_league', 'START123')
on conflict (invite_code) do update set
  name = excluded.name,
  starting_balance = excluded.starting_balance,
  weekly_bonus = excluded.weekly_bonus,
  mode = excluded.mode;

insert into users (email, username, avatar_url)
values
  ('akash@example.com', 'Akash', null),
  ('maya@example.com', 'Maya', null),
  ('arnav@example.com', 'Arnav', null),
  ('jason@example.com', 'Jason', null),
  ('noah@example.com', 'Noah', null),
  ('liam@example.com', 'Liam', null)
on conflict (username) do update set
  email = excluded.email,
  avatar_url = excluded.avatar_url;

insert into league_members (league_id, user_id, role, fantasy_cash_balance)
select l.id, u.id, case when u.username = 'Akash' then 'admin' else 'member' end, balances.cash
from leagues l
join users u on u.username in ('Akash', 'Maya', 'Arnav', 'Jason', 'Noah', 'Liam')
join (
  values
    ('Akash', 2100::numeric),
    ('Maya', 1825::numeric),
    ('Arnav', 2600::numeric),
    ('Jason', 3150::numeric),
    ('Noah', 4200::numeric),
    ('Liam', 5100::numeric)
) as balances(username, cash) on balances.username = u.username
where l.invite_code = 'START123'
on conflict (league_id, user_id) do update set
  role = excluded.role,
  fantasy_cash_balance = excluded.fantasy_cash_balance;

insert into league_market_sets (league_id, market_set_id, enabled)
select l.id, ms.id, true
from leagues l
join market_sets ms on ms.slug in ('world-cup', 'nba-playoffs')
where l.invite_code = 'START123'
on conflict (league_id, market_set_id) do nothing;

insert into external_markets (source, external_id, title, stage_label, closes_label, yes_price, no_price, volume_label, raw_payload)
values
  ('polymarket', 'bra-mor', 'Will Brazil beat Morocco?', 'Quarterfinal', 'Closes at kickoff · Fri 3:00 PM', 62, 40, '$18.4k fantasy volume', '{}'::jsonb),
  ('polymarket', 'usa-par', 'Will USA beat Paraguay?', 'Group Stage', 'Closes at kickoff · Sat 12:00 PM', 58, 44, '$12.7k fantasy volume', '{}'::jsonb),
  ('polymarket', 'arg-advance', 'Will Argentina advance?', 'Knockout', 'Closes at kickoff · Sun 8:00 PM', 73, 29, '$21.1k fantasy volume', '{}'::jsonb)
on conflict (source, external_id) do update set
  title = excluded.title,
  stage_label = excluded.stage_label,
  closes_label = excluded.closes_label,
  yes_price = excluded.yes_price,
  no_price = excluded.no_price,
  volume_label = excluded.volume_label;

insert into league_markets (league_id, external_market_id, approved_by, approval_source, status)
select l.id, em.id, null, 'polymarket', 'approved'
from leagues l
join external_markets em on em.external_id in ('bra-mor', 'usa-par', 'arg-advance') and em.source = 'polymarket'
where l.invite_code = 'START123'
on conflict (league_id, external_market_id) do update set
  status = excluded.status,
  approval_source = excluded.approval_source;

insert into trade_intents (league_id, user_id, external_market_id, market_title, side, shares, estimated_price, estimated_cost, status)
select l.id, u.id, em.id, em.title, 'yes', 100, 66, 66, 'filled'
from leagues l
join external_markets em on em.external_id = 'bra-mor' and em.source = 'polymarket'
left join users u on u.username = 'Akash'
where l.invite_code = 'START123';

insert into league_snapshots (league_id, user_id, cash_balance, portfolio_value, realized_pnl, unrealized_pnl, rank)
select l.id, u.id, s.cash_balance, s.portfolio_value, s.realized_pnl, s.unrealized_pnl, s.rank
from leagues l
join (
  values
    ('Akash', 2100::numeric, 12430::numeric, 680::numeric, 1750::numeric, 1),
    ('Maya', 1825::numeric, 10615::numeric, 420::numeric, 195::numeric, 2),
    ('Arnav', 2600::numeric, 10201::numeric, 140::numeric, 61::numeric, 3),
    ('Jason', 3150::numeric, 9744::numeric, -180::numeric, -76::numeric, 4),
    ('Noah', 4200::numeric, 8430::numeric, -920::numeric, -650::numeric, 5),
    ('Liam', 5100::numeric, 6210::numeric, -2180::numeric, -1610::numeric, 6)
) as s(username, cash_balance, portfolio_value, realized_pnl, unrealized_pnl, rank) on true
join users u on u.username = s.username
where l.invite_code = 'START123'
on conflict do nothing;

insert into trade_intents (league_id, user_id, external_market_id, market_title, side, shares, estimated_price, estimated_cost, status)
select l.id, u.id, em.id, em.title, t.side, t.shares, t.price, t.shares * t.price / 100, 'filled'
from leagues l
join (
  values
    ('Maya', 'usa-par', 'yes', 250::numeric, 58::numeric),
    ('Arnav', 'arg-advance', 'yes', 150::numeric, 73::numeric),
    ('Jason', 'usa-par', 'no', 200::numeric, 44::numeric)
) as t(username, external_id, side, shares, price) on true
join external_markets em on em.external_id = t.external_id and em.source = 'polymarket'
join users u on u.username = t.username
where l.invite_code = 'START123';

insert into activity_feed (league_id, user_id, activity_type, metadata)
select l.id, u.id, 'trade', jsonb_build_object(
  'text', a.text,
  'amount', a.amount,
  'side', a.side
)
from leagues l
join (
  values
    ('Akash', 'bought YES on USA to advance', '$250.00', 'up'),
    ('Maya', 'sold Brazil champion shares', '$300.00', 'down'),
    ('Arnav', 'bought YES on Argentina to advance', '$118.00', 'up'),
    ('Jason', 'bought NO on USA vs Paraguay', '$180.00', 'down')
) as a(username, text, amount, side) on true
join users u on u.username = a.username
where l.invite_code = 'START123';

insert into settlement_actions (league_id, external_market_id, market_title, result, action_type, note, created_by)
select l.id, em.id, em.title, 'YES', 'resolve', 'Resolved YES and pushed league payout snapshot.', null
from leagues l
join external_markets em on em.external_id = 'arg-advance' and em.source = 'polymarket'
where l.invite_code = 'START123';
