-- MakeShift scouting mirror
--
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- The server copies each event's Google Sheets into these tables (see
-- supabase-mirror.js). Google Sheets stays the primary copy; these tables are a
-- backup that others can query.
--
-- Nothing is ever deleted by the server:
--   * Each row's id is a hash of its contents, so re-syncing never duplicates.
--   * An edited sheet row is stored as a new row.
--   * Rows removed from the sheet stay here with in_sheet = false.
-- For "what's in the sheet right now", filter on in_sheet = true.

create table if not exists public.scouting_reports (
	id            text primary key,          -- sha256 of the row's contents
	event_key     text not null,             -- TBA event key, e.g. 2026oncmp2
	row_number    integer,                   -- row in the Google Sheet (1 = headers)
	team_number   integer,
	match_number  integer,
	data          jsonb not null,            -- the full row: { "Sheet header": "value", ... }
	in_sheet      boolean not null default true,
	first_seen_at timestamptz not null default now(),
	last_seen_at  timestamptz not null default now()
);

create table if not exists public.pit_scouting_reports (
	id            text primary key,
	event_key     text not null,
	row_number    integer,
	team_number   integer,
	data          jsonb not null,
	in_sheet      boolean not null default true,
	first_seen_at timestamptz not null default now(),
	last_seen_at  timestamptz not null default now()
);

create index if not exists scouting_reports_event_team on public.scouting_reports (event_key, team_number);
create index if not exists scouting_reports_event_seen on public.scouting_reports (event_key, in_sheet, last_seen_at);
create index if not exists pit_scouting_reports_event_team on public.pit_scouting_reports (event_key, team_number);
create index if not exists pit_scouting_reports_event_seen on public.pit_scouting_reports (event_key, in_sheet, last_seen_at);

-- Row Level Security: on, with no public policies. The server uses the
-- service_role key, which bypasses RLS, so only the server can write.
alter table public.scouting_reports enable row level security;
alter table public.pit_scouting_reports enable row level security;

-- To let others READ the data with the public "anon" key (e.g. another team's
-- tool or a dashboard), uncomment these. They still can't write.
-- create policy "Anyone can read scouting reports"
-- 	on public.scouting_reports for select using (true);
-- create policy "Anyone can read pit scouting reports"
-- 	on public.pit_scouting_reports for select using (true);
