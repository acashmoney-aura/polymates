insert into market_sets (slug, name, description, category)
values
  ('world-cup', 'World Cup', 'Starter pack for international football leagues.', 'sports'),
  ('nba-playoffs', 'NBA Playoffs', 'Playoff markets for basketball-focused leagues.', 'sports'),
  ('elections', 'Elections', 'Longer-horizon political prediction pack.', 'politics')
on conflict (slug) do nothing;

insert into leagues (name, creator_id, starting_balance, weekly_bonus, mode, invite_code)
values
  ('Akash''s Starter League', null, 10000, 2000, 'season_league', 'START123')
on conflict (invite_code) do nothing;

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
select l.id, null, em.id, em.title, 'yes', 100, 66, 66, 'filled'
from leagues l
join external_markets em on em.external_id = 'bra-mor' and em.source = 'polymarket'
where l.invite_code = 'START123';

insert into settlement_actions (league_id, external_market_id, market_title, result, action_type, note, created_by)
select l.id, em.id, em.title, 'YES', 'resolve', 'Resolved YES and pushed league payout snapshot.', null
from leagues l
join external_markets em on em.external_id = 'arg-advance' and em.source = 'polymarket'
where l.invite_code = 'START123';
