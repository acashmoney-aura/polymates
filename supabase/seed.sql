insert into market_sets (slug, name, description, category)
values
  ('world-cup', 'World Cup', 'Starter pack for international football leagues.', 'sports'),
  ('nba-playoffs', 'NBA Playoffs', 'Playoff markets for basketball-focused leagues.', 'sports'),
  ('elections', 'Elections', 'Longer-horizon political prediction pack.', 'politics')
on conflict (slug) do nothing;

-- Example league seed
insert into leagues (name, creator_id, starting_balance, weekly_bonus, mode, invite_code, market_set_id)
select
  'Akash''s Starter League',
  null,
  10000,
  2000,
  'season_league',
  'START123',
  ms.id
from market_sets ms
where ms.slug = 'world-cup'
on conflict (invite_code) do nothing;
