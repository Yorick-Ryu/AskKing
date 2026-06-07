import Database from "better-sqlite3";
import { randomCode, randomToken, sha256 } from "./crypto.js";
import type { ApprovalRequest, CompletionEvent, CodexClient, Device, HookMode } from "./types.js";
import type { EventListItem, PairingCodeInput, RelayStore } from "./store.types.js";

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
        notify_only integer not null default 0,
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
        notify_only integer not null default 0,
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
    if (!completionColumns.some((column) => column.name === "notify_only")) {
      this.db.prepare("alter table completions add column notify_only integer not null default 0").run();
    }
    const deviceColumns = this.db.prepare("pragma table_info(devices)").all() as { name: string }[];
    if (!deviceColumns.some((column) => column.name === "client_id")) {
      this.db.prepare("alter table devices add column client_id text not null default ''").run();
    }
    const pairingColumns = this.db.prepare("pragma table_info(pairing_codes)").all() as { name: string }[];
    if (!pairingColumns.some((column) => column.name === "client_id")) {
      this.db.prepare("alter table pairing_codes add column client_id text not null default ''").run();
    }
    const approvalColumns = this.db.prepare("pragma table_info(approvals)").all() as { name: string }[];
    if (!approvalColumns.some((column) => column.name === "notify_only")) {
      this.db.prepare("alter table approvals add column notify_only integer not null default 0").run();
    }
  }

  private firstClientId() {
    const row = this.db.prepare("select id from codex_clients where enabled = 1 order by created_at desc limit 1").get() as { id: string } | undefined;
    return row?.id ?? "";
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

  createPairingCode(input: PairingCodeInput = {}, ttlSeconds = 600) {
    const code = randomCode();
    const clientId = input.clientId || this.firstClientId();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    this.db.prepare("insert into pairing_codes (code, client_id, expires_at) values (?, ?, ?)").run(code, clientId, expiresAt);
    return { code, clientId, expiresAt };
  }

  pairDevice(code: string, name: string) {
    const now = new Date().toISOString();
    const pairing = this.db.prepare("select code, client_id as clientId, expires_at as expiresAt, used_at as usedAt from pairing_codes where code = ?").get(code) as { code: string; clientId: string; expiresAt: string; usedAt: string | null } | undefined;
    if (!pairing || pairing.usedAt || pairing.expiresAt < now) return null;
    const clientId = pairing.clientId || this.firstClientId();
    if (!clientId) return null;
    const id = randomToken("dev").slice(0, 22);
    const sessionToken = randomToken("ios");
    this.db.transaction(() => {
      this.db.prepare("update pairing_codes set used_at = ? where code = ?").run(now, code);
      this.db.prepare(`
        insert into devices (id, client_id, name, session_token_hash, created_at, last_seen_at)
        values (?, ?, ?, ?, ?, ?)
      `).run(id, clientId, name, sha256(sessionToken), now, now);
    })();
    return { id, sessionToken };
  }

  getDeviceByToken(token: string): Device | null {
    const row = this.db.prepare(`
      select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices where session_token_hash = ?
    `).get(sha256(token)) as Device | undefined;
    if (!row || !row.enabled) return null;
    this.db.prepare("update devices set last_seen_at = ? where id = ?").run(new Date().toISOString(), row.id);
    return row;
  }

  listDevices(): Device[] {
    return this.db.prepare(`
      select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices
      order by created_at desc
    `).all() as Device[];
  }

  hasEnabledDevice(clientId: string): boolean {
    const row = this.db.prepare("select 1 as found from devices where client_id = ? and enabled = 1 limit 1").get(clientId) as { found: number } | undefined;
    return Boolean(row);
  }

  revokeDevice(deviceId: string) {
    const result = this.db.prepare("update devices set enabled = 0, apns_token = null, last_seen_at = ? where id = ?").run(new Date().toISOString(), deviceId);
    return result.changes > 0;
  }

  setDeviceApnsToken(sessionTokenHash: string, token: string) {
    const now = new Date().toISOString();
    this.db.transaction(() => {
      this.db.prepare("update devices set apns_token = null, last_seen_at = ? where apns_token = ? and session_token_hash <> ?").run(now, token, sessionTokenHash);
      this.db.prepare("update devices set apns_token = ?, last_seen_at = ? where session_token_hash = ?").run(token, now, sessionTokenHash);
    })();
  }

  listPushDevices(clientId?: string): Device[] {
    return this.db.prepare(`
      select id, clientId, name, apnsToken, sessionTokenHash, enabled, createdAt, lastSeenAt
      from (
        select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash,
          enabled, created_at as createdAt, last_seen_at as lastSeenAt,
          row_number() over (partition by apns_token order by last_seen_at desc, created_at desc) as tokenRank
        from devices
        where enabled = 1 and apns_token is not null and (? = '' or client_id = ?)
      )
      where tokenRank = 1
      order by lastSeenAt desc
    `).all(clientId ?? "", clientId ?? "") as Device[];
  }

  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "decisionSource" | "createdAt" | "decidedAt">) {
    const id = randomToken("appr").slice(0, 26);
    const createdAt = new Date().toISOString();
    const row: ApprovalRequest = { ...input, id, status: "pending", decisionSource: null, createdAt, decidedAt: null };
    this.db.prepare(`
      insert into approvals (id, client_id, event_id, project_name, cwd, model, command_summary, command_full, reason, risk_summary, status, notify_only, created_at, expires_at)
      values (@id, @clientId, @eventId, @projectName, @cwd, @model, @commandSummary, @commandFull, @reason, @riskSummary, @status, @notifyOnly, @createdAt, @expiresAt)
    `).run({ ...row, notifyOnly: row.notifyOnly ? 1 : 0 });
    return row;
  }

  getApproval(id: string, clientId?: string): ApprovalRequest | null {
    const row = this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, command_summary as commandSummary,
        command_full as commandFull, reason, risk_summary as riskSummary, status, notify_only as notifyOnly, decision_source as decisionSource,
        created_at as createdAt, expires_at as expiresAt, decided_at as decidedAt
      from approvals where id = ? and (? = '' or client_id = ?)
    `).get(id, clientId ?? "", clientId ?? "") as ApprovalRequest | null;
    return row ? { ...row, notifyOnly: Boolean(row.notifyOnly) } : null;
  }

  expireApproval(id: string, clientId: string): ApprovalRequest | null {
    const current = this.getApproval(id, clientId);
    const now = new Date().toISOString();
    if (!current || current.status !== "pending" || current.expiresAt >= now) return current;
    this.db.prepare("update approvals set status = 'expired' where id = ? and client_id = ? and status = 'pending' and expires_at < ?").run(id, clientId, now);
    return this.getApproval(id, clientId);
  }

  decideApproval(id: string, clientId: string, status: "allowed" | "denied", source: string) {
    const now = new Date().toISOString();
    const current = this.getApproval(id, clientId);
    if (!current) return null;
    if (current.notifyOnly) return current;
    if (current.status !== "pending") return current;
    if (current.expiresAt < now) {
      return this.expireApproval(id, clientId);
    }
    this.db.prepare("update approvals set status = ?, decision_source = ?, decided_at = ? where id = ? and client_id = ? and status = 'pending'").run(status, source, now, id, clientId);
    return this.getApproval(id, clientId);
  }

  consumeTerminalApproval(id: string, clientId: string): ApprovalRequest | null {
    return this.db.transaction(() => {
      const approval = this.getApproval(id, clientId);
      if (!approval || (approval.status !== "allowed" && approval.status !== "denied" && approval.status !== "expired")) return null;
      this.db.prepare("delete from approvals where id = ? and client_id = ?").run(id, clientId);
      return approval;
    })();
  }

  createCompletion(input: Omit<CompletionEvent, "id" | "createdAt" | "reply" | "repliedAt">) {
    const id = randomToken("done").slice(0, 26);
    const createdAt = new Date().toISOString();
    const row: CompletionEvent = { ...input, id, createdAt, reply: null, repliedAt: null };
    this.db.prepare(`
      insert into completions (id, client_id, event_id, project_name, cwd, model, session_key, summary, status, notify_only, created_at, expires_at)
      values (@id, @clientId, @eventId, @projectName, @cwd, @model, @sessionKey, @summary, @status, @notifyOnly, @createdAt, @expiresAt)
    `).run({ ...row, notifyOnly: row.notifyOnly ? 1 : 0 });
    return row;
  }

  getCompletion(id: string, clientId?: string): CompletionEvent | null {
    const row = this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, session_key as sessionKey, summary, status,
        notify_only as notifyOnly, created_at as createdAt, expires_at as expiresAt, reply, replied_at as repliedAt
      from completions where id = ? and (? = '' or client_id = ?)
    `).get(id, clientId ?? "", clientId ?? "") as CompletionEvent | null;
    return row ? { ...row, notifyOnly: Boolean(row.notifyOnly) } : null;
  }

  expireCompletion(id: string, clientId: string): CompletionEvent | null {
    const current = this.getCompletion(id, clientId);
    const now = new Date().toISOString();
    if (!current || current.status !== "waiting" || current.expiresAt >= now) return current;
    this.db.prepare("update completions set status = 'expired' where id = ? and client_id = ? and status = 'waiting' and expires_at < ?").run(id, clientId, now);
    return this.getCompletion(id, clientId);
  }

  replyCompletion(id: string, clientId: string, reply: string) {
    const current = this.getCompletion(id, clientId);
    const now = new Date().toISOString();
    if (!current) return null;
    if (current.notifyOnly) return current;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    if (current.status === "waiting" && current.expiresAt < now) {
      return this.expireCompletion(id, clientId);
    }
    this.db.prepare("update completions set status = 'replied', reply = ?, replied_at = ? where id = ? and client_id = ? and status in ('waiting', 'notified')").run(reply, now, id, clientId);
    return this.getCompletion(id, clientId);
  }

  interruptCompletion(id: string, clientId: string) {
    const current = this.getCompletion(id, clientId);
    if (!current) return null;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    this.db.prepare("update completions set status = 'interrupted' where id = ? and client_id = ? and status in ('waiting', 'notified')").run(id, clientId);
    return this.getCompletion(id, clientId);
  }

  consumeTerminalCompletion(id: string, clientId: string): CompletionEvent | null {
    return this.db.transaction(() => {
      const completion = this.getCompletion(id, clientId);
      if (!completion || (completion.status !== "replied" && completion.status !== "interrupted" && completion.status !== "expired")) return null;
      this.db.prepare("delete from completions where id = ? and client_id = ?").run(id, clientId);
      return completion;
    })();
  }

  continueLatestCompletionLocally(input: { clientId: string; cwd: string; projectName: string; sessionKey: string; prompt: string }) {
    if (!input.sessionKey) return null;
    const current = this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, session_key as sessionKey, summary, status,
        notify_only as notifyOnly, created_at as createdAt, expires_at as expiresAt, reply, replied_at as repliedAt
      from completions
      where client_id = ?
        and cwd = ?
        and project_name = ?
        and session_key = ?
        and notify_only = 0
        and status in ('waiting', 'notified', 'interrupted')
      order by created_at desc
      limit 1
    `).get(input.clientId, input.cwd, input.projectName, input.sessionKey) as CompletionEvent | undefined;
    if (!current) return null;

    this.db.prepare(`
      update completions
      set status = 'replied', reply = ?, replied_at = ?
      where id = ? and client_id = ? and notify_only = 0 and status in ('waiting', 'notified', 'interrupted')
    `).run(input.prompt, new Date().toISOString(), current.id, input.clientId);
    return this.getCompletion(current.id, input.clientId);
  }

  getHookMode(clientId: string): HookMode | null {
    const row = this.db.prepare("select value from settings where key = ?").get(`hook_mode:${clientId}`) as { value: string } | undefined;
    if (row?.value === "off" || row?.value === "notify" || row?.value === "approval" || row?.value === "full") {
      return row.value;
    }
    return null;
  }

  setHookMode(clientId: string, mode: HookMode): HookMode {
    this.db.prepare(`
      insert into settings (key, value, updated_at)
      values (?, ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).run(`hook_mode:${clientId}`, mode, new Date().toISOString());
    return mode;
  }

  clearHookMode(clientId: string) {
    this.db.prepare("delete from settings where key = ?").run(`hook_mode:${clientId}`);
  }

  listEvents(clientId: string, limit = 50): EventListItem[] {
    const rows = this.db.prepare(`
      select 'completion' as kind, id, project_name as projectName, model, status, summary, created_at as createdAt, expires_at as expiresAt, reply, notify_only as notifyOnly
      from completions
      where client_id = ?
      order by createdAt desc
      limit ?
    `).all(clientId, limit) as EventListItem[];
    return rows.map((row) => ({ ...row, notifyOnly: Boolean(row.notifyOnly) }));
  }

}
