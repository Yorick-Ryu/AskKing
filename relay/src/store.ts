import Database from "better-sqlite3";
import { randomCode, randomToken, sha256 } from "./crypto.js";
import type { ApprovalRequest, CompletionEvent, CodexClient, Device, HookMode } from "./types.js";
import type { EventListItem, RelayStore } from "./store.types.js";

export class Store implements RelayStore {
  private db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
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
        name text not null,
        apns_token text,
        session_token_hash text not null unique,
        enabled integer not null default 1,
        created_at text not null,
        last_seen_at text not null
      );
      create table if not exists pairing_codes (
        code text primary key,
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
    `);
    const completionColumns = this.db.prepare("pragma table_info(completions)").all() as { name: string }[];
    if (!completionColumns.some((column) => column.name === "session_key")) {
      this.db.prepare("alter table completions add column session_key text not null default ''").run();
    }
  }

  createClient(name: string, defaultProjectName: string) {
    const id = randomToken("client").slice(0, 22);
    const token = randomToken("ck");
    const now = new Date().toISOString();
    this.db.prepare(`
      insert into codex_clients (id, name, default_project_name, client_token_hash, created_at, last_seen_at)
      values (?, ?, ?, ?, ?, ?)
    `).run(id, name, defaultProjectName, sha256(token), now, now);
    return { id, token };
  }

  getClientByToken(token: string): CodexClient | null {
    const row = this.db.prepare(`
      select id, name, default_project_name as defaultProjectName, client_token_hash as clientTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from codex_clients where client_token_hash = ?
    `).get(sha256(token)) as CodexClient | undefined;
    if (!row || !row.enabled) return null;
    this.db.prepare("update codex_clients set last_seen_at = ? where id = ?").run(new Date().toISOString(), row.id);
    return row;
  }

  listClients(): CodexClient[] {
    return this.db.prepare(`
      select id, name, default_project_name as defaultProjectName, client_token_hash as clientTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from codex_clients
      order by created_at desc
    `).all() as CodexClient[];
  }

  revokeClient(clientId: string) {
    const result = this.db.prepare("update codex_clients set enabled = 0, last_seen_at = ? where id = ?").run(new Date().toISOString(), clientId);
    return result.changes > 0;
  }

  createPairingCode(ttlSeconds = 600) {
    const code = randomCode();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.db.prepare("insert into pairing_codes (code, expires_at) values (?, ?)").run(code, expiresAt);
    return { code, expiresAt };
  }

  pairDevice(code: string, name: string) {
    const now = new Date().toISOString();
    const pairing = this.db.prepare("select code, expires_at as expiresAt, used_at as usedAt from pairing_codes where code = ?").get(code) as { code: string; expiresAt: string; usedAt: string | null } | undefined;
    if (!pairing || pairing.usedAt || pairing.expiresAt < now) return null;
    const id = randomToken("dev").slice(0, 22);
    const sessionToken = randomToken("ios");
    this.db.transaction(() => {
      this.db.prepare("update pairing_codes set used_at = ? where code = ?").run(now, code);
      this.db.prepare(`
        insert into devices (id, name, session_token_hash, created_at, last_seen_at)
        values (?, ?, ?, ?, ?)
      `).run(id, name, sha256(sessionToken), now, now);
    })();
    return { id, sessionToken };
  }

  getDeviceByToken(token: string): Device | null {
    const row = this.db.prepare(`
      select id, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices where session_token_hash = ?
    `).get(sha256(token)) as Device | undefined;
    if (!row || !row.enabled) return null;
    this.db.prepare("update devices set last_seen_at = ? where id = ?").run(new Date().toISOString(), row.id);
    return row;
  }

  listDevices(): Device[] {
    return this.db.prepare(`
      select id, name, apns_token as apnsToken, session_token_hash as sessionTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices
      order by created_at desc
    `).all() as Device[];
  }

  revokeDevice(deviceId: string) {
    const result = this.db.prepare("update devices set enabled = 0, last_seen_at = ? where id = ?").run(new Date().toISOString(), deviceId);
    return result.changes > 0;
  }

  setDeviceApnsToken(deviceId: string, token: string) {
    this.db.prepare("update devices set apns_token = ?, last_seen_at = ? where id = ?").run(token, new Date().toISOString(), deviceId);
  }

  listPushDevices(): Device[] {
    return this.db.prepare(`
      select id, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices where enabled = 1 and apns_token is not null
    `).all() as Device[];
  }

  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "decisionSource" | "createdAt" | "decidedAt">) {
    const id = randomToken("appr").slice(0, 26);
    const createdAt = new Date().toISOString();
    const row: ApprovalRequest = { ...input, id, status: "pending", decisionSource: null, createdAt, decidedAt: null };
    this.db.prepare(`
      insert into approvals (id, client_id, event_id, project_name, cwd, model, command_summary, command_full, reason, risk_summary, status, created_at, expires_at)
      values (@id, @clientId, @eventId, @projectName, @cwd, @model, @commandSummary, @commandFull, @reason, @riskSummary, @status, @createdAt, @expiresAt)
    `).run(row);
    return row;
  }

  getApproval(id: string): ApprovalRequest | null {
    return this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, command_summary as commandSummary,
        command_full as commandFull, reason, risk_summary as riskSummary, status, decision_source as decisionSource,
        created_at as createdAt, expires_at as expiresAt, decided_at as decidedAt
      from approvals where id = ?
    `).get(id) as ApprovalRequest | null;
  }

  decideApproval(id: string, status: "allowed" | "denied", source: string) {
    const now = new Date().toISOString();
    const current = this.getApproval(id);
    if (!current) return null;
    if (current.status !== "pending") return current;
    if (current.expiresAt < now) {
      this.db.prepare("update approvals set status = 'expired' where id = ? and status = 'pending'").run(id);
      return this.getApproval(id);
    }
    this.db.prepare("update approvals set status = ?, decision_source = ?, decided_at = ? where id = ? and status = 'pending'").run(status, source, now, id);
    return this.getApproval(id);
  }

  createCompletion(input: Omit<CompletionEvent, "id" | "createdAt" | "reply" | "repliedAt">) {
    const id = randomToken("done").slice(0, 26);
    const createdAt = new Date().toISOString();
    const row: CompletionEvent = { ...input, id, createdAt, reply: null, repliedAt: null };
    this.db.prepare(`
      insert into completions (id, client_id, event_id, project_name, cwd, model, session_key, summary, status, created_at, expires_at)
      values (@id, @clientId, @eventId, @projectName, @cwd, @model, @sessionKey, @summary, @status, @createdAt, @expiresAt)
    `).run(row);
    return row;
  }

  getCompletion(id: string): CompletionEvent | null {
    return this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, session_key as sessionKey, summary, status,
        created_at as createdAt, expires_at as expiresAt, reply, replied_at as repliedAt
      from completions where id = ?
    `).get(id) as CompletionEvent | null;
  }

  replyCompletion(id: string, reply: string) {
    const current = this.getCompletion(id);
    const now = new Date().toISOString();
    if (!current) return null;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    if (current.status === "waiting" && current.expiresAt < now) {
      this.db.prepare("update completions set status = 'expired' where id = ? and status = 'waiting'").run(id);
      return this.getCompletion(id);
    }
    this.db.prepare("update completions set status = 'replied', reply = ?, replied_at = ? where id = ? and status in ('waiting', 'notified')").run(reply, now, id);
    return this.getCompletion(id);
  }

  interruptCompletion(id: string) {
    const current = this.getCompletion(id);
    if (!current) return null;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    this.db.prepare("update completions set status = 'interrupted' where id = ? and status in ('waiting', 'notified')").run(id);
    return this.getCompletion(id);
  }

  continueLatestCompletionLocally(input: { clientId: string; cwd: string; projectName: string; sessionKey: string; prompt: string }) {
    if (!input.sessionKey) return null;
    const current = this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, session_key as sessionKey, summary, status,
        created_at as createdAt, expires_at as expiresAt, reply, replied_at as repliedAt
      from completions
      where client_id = ?
        and cwd = ?
        and project_name = ?
        and session_key = ?
        and status in ('waiting', 'notified', 'interrupted')
      order by created_at desc
      limit 1
    `).get(input.clientId, input.cwd, input.projectName, input.sessionKey) as CompletionEvent | undefined;
    if (!current) return null;

    this.db.prepare(`
      update completions
      set status = 'replied', reply = ?, replied_at = ?
      where id = ? and status in ('waiting', 'notified', 'interrupted')
    `).run(input.prompt, new Date().toISOString(), current.id);
    return this.getCompletion(current.id);
  }

  getHookMode(): HookMode | null {
    const row = this.db.prepare("select value from settings where key = 'hook_mode'").get() as { value: string } | undefined;
    if (row?.value === "off" || row?.value === "notify" || row?.value === "approval" || row?.value === "full") {
      return row.value;
    }
    return null;
  }

  setHookMode(mode: HookMode): HookMode {
    this.db.prepare(`
      insert into settings (key, value, updated_at)
      values ('hook_mode', ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(mode, new Date().toISOString());
    return mode;
  }

  clearHookMode() {
    this.db.prepare("delete from settings where key = 'hook_mode'").run();
  }

  listEvents(limit = 50): EventListItem[] {
    return this.db.prepare(`
      select 'approval' as kind, id, project_name as projectName, model, status, command_summary as summary, created_at as createdAt, expires_at as expiresAt, null as reply
      from approvals
      union all
      select 'completion' as kind, id, project_name as projectName, model, status, summary, created_at as createdAt, expires_at as expiresAt, reply
      from completions
      order by createdAt desc
      limit ?
    `).all(limit) as EventListItem[];
  }

  expireOld() {
    const now = new Date().toISOString();
    this.db.prepare("update approvals set status = 'expired' where status = 'pending' and expires_at < ?").run(now);
    this.db.prepare("update completions set status = 'expired' where status = 'waiting' and expires_at < ?").run(now);
  }
}
