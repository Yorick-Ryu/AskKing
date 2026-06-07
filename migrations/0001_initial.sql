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

create index if not exists idx_devices_client_enabled on devices (client_id, enabled);
create index if not exists idx_devices_apns on devices (apns_token);
