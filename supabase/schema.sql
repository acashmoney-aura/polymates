create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  email text unique,
  username text unique not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists market_sets (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  name text not null,
  description text,
  category text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  creator_id uuid references users(id) on delete set null,
  starting_balance numeric not null default 10000,
  weekly_bonus numeric not null default 2000,
  mode text not null default 'season_league',
  invite_code text unique not null,
  created_at timestamptz not null default now()
);

create table if not exists league_market_sets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  market_set_id uuid not null references market_sets(id) on delete cascade,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  unique (league_id, market_set_id)
);

create table if not exists league_members (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'member',
  fantasy_cash_balance numeric not null default 10000,
  joined_at timestamptz not null default now(),
  unique (league_id, user_id)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  market_set_id uuid not null references market_sets(id) on delete cascade,
  title text not null,
  event_type text not null,
  start_time timestamptz,
  status text not null default 'scheduled',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists markets (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  title text not null,
  market_type text not null,
  status text not null default 'open',
  close_time timestamptz,
  resolved_outcome_id uuid,
  rules_text text,
  created_at timestamptz not null default now()
);

create table if not exists external_markets (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_id text not null,
  title text not null,
  stage_label text,
  closes_label text,
  yes_price numeric,
  no_price numeric,
  volume_label text,
  raw_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  unique (source, external_id)
);

create table if not exists league_markets (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  market_id uuid references markets(id) on delete cascade,
  external_market_id uuid references external_markets(id) on delete cascade,
  approved_by uuid references users(id) on delete set null,
  approval_source text not null default 'manual',
  status text not null default 'approved',
  created_at timestamptz not null default now(),
  check (
    (market_id is not null) or (external_market_id is not null)
  )
);

create table if not exists outcomes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  label text not null,
  current_price numeric not null,
  resolved_value numeric,
  created_at timestamptz not null default now()
);

create table if not exists positions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  market_id uuid not null references markets(id) on delete cascade,
  outcome_id uuid not null references outcomes(id) on delete cascade,
  shares numeric not null default 0,
  avg_price numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, user_id, market_id, outcome_id)
);

create table if not exists trades (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  market_id uuid not null references markets(id) on delete cascade,
  outcome_id uuid not null references outcomes(id) on delete cascade,
  side text not null,
  shares numeric not null,
  price numeric not null,
  cost numeric not null,
  created_at timestamptz not null default now()
);

create table if not exists trade_intents (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  market_id uuid references markets(id) on delete cascade,
  external_market_id uuid references external_markets(id) on delete cascade,
  side text not null,
  shares numeric not null,
  estimated_price numeric not null,
  estimated_cost numeric not null,
  status text not null default 'draft',
  created_at timestamptz not null default now(),
  check (
    (market_id is not null) or (external_market_id is not null)
  )
);

create table if not exists market_price_history (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null references markets(id) on delete cascade,
  outcome_id uuid not null references outcomes(id) on delete cascade,
  price numeric not null,
  recorded_at timestamptz not null default now()
);

create table if not exists league_snapshots (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  cash_balance numeric not null,
  portfolio_value numeric not null,
  realized_pnl numeric not null default 0,
  unrealized_pnl numeric not null default 0,
  rank integer,
  snapshot_time timestamptz not null default now()
);

create table if not exists settlement_actions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  market_id uuid references markets(id) on delete cascade,
  external_market_id uuid references external_markets(id) on delete cascade,
  result text,
  action_type text not null,
  note text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (
    (market_id is not null) or (external_market_id is not null)
  )
);

create table if not exists activity_feed (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references leagues(id) on delete cascade,
  user_id uuid references users(id) on delete set null,
  activity_type text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table markets
  add constraint markets_resolved_outcome_fk
  foreign key (resolved_outcome_id) references outcomes(id) on delete set null;
