create table if not exists codex_clients (
  id text primary key,
  name text not null,
  default_project_name text not null,
  client_token_hash text not null unique,
  enabled integer not null default 1,
  created_at text not null,
  last_seen_at text not null
);

create table if not exists devices (
  id text primary key,
  client_id text not null default '',
  name text not null,
  apns_token text,
  session_token_hash text not null unique,
  enabled integer not null default 1,
  created_at text not null,
  last_seen_at text not null
);

create table if not exists pairing_codes (
  code text primary key,
  client_id text not null default '',
  expires_at text not null,
  used_at text
);

create table if not exists approvals (
  id text primary key,
  client_id text not null,
  event_id text not null,
  project_name text not null,
  cwd text not null,
  model text not null,
  command_summary text not null,
  command_full text not null,
  reason text not null,
  risk_summary text not null,
  status text not null,
  decision_source text,
  created_at text not null,
  expires_at text not null,
  decided_at text
);

create table if not exists completions (
  id text primary key,
  client_id text not null,
  event_id text not null,
  project_name text not null,
  cwd text not null,
  model text not null,
  session_key text not null default '',
  summary text not null,
  status text not null,
  created_at text not null,
  expires_at text not null,
  reply text,
  replied_at text
);

create table if not exists settings (
  key text primary key,
  value text not null,
  updated_at text not null
);

create index if not exists idx_devices_client_enabled on devices (client_id, enabled);
create index if not exists idx_devices_apns on devices (apns_token);
create index if not exists idx_approvals_client_created on approvals (client_id, created_at);
create index if not exists idx_completions_client_created on completions (client_id, created_at);
create index if not exists idx_completions_local_prompt on completions (client_id, cwd, project_name, session_key, created_at);
