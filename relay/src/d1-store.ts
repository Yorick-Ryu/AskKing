import { randomCode, randomToken, sha256 } from "./crypto.js";
import type { PairingCodeInput, RelayStore } from "./store.types.js";
import type { ApprovalRequest, CompletionEvent, CodexClient, Device, HookMode } from "./types.js";

type EventListItem = {
  kind: "completion";
  id: string;
  projectName: string;
  model: string;
  status: string;
  summary: string;
  createdAt: string;
  expiresAt: string;
  reply?: string | null;
  notifyOnly?: boolean;
};

type D1ResultMeta = {
  changes?: number;
};

type D1Result<T = unknown> = {
  results?: T[];
  meta?: D1ResultMeta;
};

type D1PreparedStatement = {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
};

export type D1Database = {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
};

type RowCount = {
  found: number;
};

function nowIso() {
  return new Date().toISOString();
}

function hasChanges(result: D1Result) {
  return Number(result.meta?.changes ?? 0) > 0;
}

function validHookMode(value: unknown): HookMode | null {
  if (value === "off" || value === "notify" || value === "approval" || value === "full") return value;
  return null;
}

export class D1Store implements RelayStore {
  constructor(private db: D1Database) {}

  private async firstClientId() {
    const row = await this.db.prepare("select id from codex_clients where enabled = 1 order by created_at desc limit 1").first<{ id: string }>();
    return row?.id ?? "";
  }

  async createClient(name: string, defaultProjectName: string) {
    const id = randomToken("client").slice(0, 22);
    const token = randomToken("ck");
    const now = nowIso();
    await this.db.prepare(`
      insert into codex_clients (id, name, default_project_name, client_token_hash, created_at, last_seen_at)
      values (?, ?, ?, ?, ?, ?)
    `).bind(id, name, defaultProjectName, sha256(token), now, now).run();
    return { id, token };
  }

  async getClientByToken(token: string): Promise<CodexClient | null> {
    const tokenHash = sha256(token);
    const row = await this.db.prepare(`
      select id, name, default_project_name as defaultProjectName, client_token_hash as clientTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from codex_clients where client_token_hash = ?
    `).bind(tokenHash).first<CodexClient>();
    if (!row || !row.enabled) return null;
    await this.db.prepare("update codex_clients set last_seen_at = ? where id = ?").bind(nowIso(), row.id).run();
    return row;
  }

  async listClients(): Promise<CodexClient[]> {
    const result = await this.db.prepare(`
      select id, name, default_project_name as defaultProjectName, client_token_hash as clientTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from codex_clients
      order by created_at desc
    `).all<CodexClient>();
    return result.results ?? [];
  }

  async revokeClient(clientId: string) {
    const result = await this.db.prepare("update codex_clients set enabled = 0, last_seen_at = ? where id = ?").bind(nowIso(), clientId).run();
    return hasChanges(result);
  }

  async createPairingCode(input: PairingCodeInput = {}, ttlSeconds = 600) {
    const code = randomCode();
    const clientId = input.clientId || await this.firstClientId();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.prepare("insert into pairing_codes (code, client_id, expires_at) values (?, ?, ?)").bind(code, clientId, expiresAt).run();
    return { code, clientId, expiresAt };
  }

  async pairDevice(code: string, name: string) {
    const now = nowIso();
    const pairing = await this.db.prepare("select code, client_id as clientId, expires_at as expiresAt, used_at as usedAt from pairing_codes where code = ?")
      .bind(code)
      .first<{ code: string; clientId: string; expiresAt: string; usedAt: string | null }>();
    if (!pairing || pairing.usedAt || pairing.expiresAt < now) return null;
    const clientId = pairing.clientId || await this.firstClientId();
    if (!clientId) return null;

    const id = randomToken("dev").slice(0, 22);
    const sessionToken = randomToken("ios");
    const codexToken = randomToken("cdx");
    const sessionTokenHash = sha256(sessionToken);
    const [update] = await this.db.batch([
      this.db.prepare("update pairing_codes set used_at = ? where code = ? and used_at is null").bind(now, code),
      this.db.prepare(`
        insert into devices (id, client_id, name, session_token_hash, codex_token_hash, created_at, last_seen_at)
        values (?, ?, ?, ?, ?, ?, ?)
      `).bind(id, clientId, name, sessionTokenHash, sha256(codexToken), now, now)
    ]);
    if (!hasChanges(update)) return null;
    return { id, sessionToken, codexToken };
  }

  async createDevice(name: string) {
    const id = randomToken("dev").slice(0, 22);
    const sessionToken = randomToken("ios");
    const codexToken = randomToken("cdx");
    const now = nowIso();
    await this.db.prepare(`
      insert into devices (id, client_id, name, session_token_hash, codex_token_hash, created_at, last_seen_at)
      values (?, ?, ?, ?, ?, ?, ?)
    `).bind(id, "", name, sha256(sessionToken), sha256(codexToken), now, now).run();
    return { id, sessionToken, codexToken };
  }

  async refreshDeviceCodexToken(sessionTokenHash: string) {
    const codexToken = randomToken("cdx");
    const result = await this.db.prepare("update devices set codex_token_hash = ?, last_seen_at = ? where session_token_hash = ? and enabled = 1")
      .bind(sha256(codexToken), nowIso(), sessionTokenHash)
      .run();
    if (!hasChanges(result)) throw new Error("device_not_found");
    return codexToken;
  }

  async getDeviceByToken(token: string): Promise<Device | null> {
    const sessionTokenHash = sha256(token);
    const row = await this.db.prepare(`
      select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, codex_token_hash as codexTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices where session_token_hash = ?
    `).bind(sessionTokenHash).first<Device>();
    if (!row || !row.enabled) return null;
    await this.db.prepare("update devices set last_seen_at = ? where id = ?").bind(nowIso(), row.id).run();
    return row;
  }

  async listDevices(): Promise<Device[]> {
    const result = await this.db.prepare(`
      select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, codex_token_hash as codexTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices
      order by created_at desc
    `).all<Device>();
    return result.results ?? [];
  }

  async hasEnabledDevice(clientId: string): Promise<boolean> {
    const row = await this.db.prepare("select 1 as found from devices where client_id = ? and enabled = 1 limit 1").bind(clientId).first<RowCount>();
    return Boolean(row);
  }

  async revokeDevice(deviceId: string) {
    const result = await this.db.prepare("update devices set enabled = 0, apns_token = null, last_seen_at = ? where id = ?").bind(nowIso(), deviceId).run();
    return hasChanges(result);
  }

  async setDeviceApnsToken(sessionTokenHash: string, token: string) {
    const now = nowIso();
    await this.db.batch([
      this.db.prepare("update devices set apns_token = null, last_seen_at = ? where apns_token = ? and session_token_hash <> ?").bind(now, token, sessionTokenHash),
      this.db.prepare("update devices set apns_token = ?, last_seen_at = ? where session_token_hash = ?").bind(token, now, sessionTokenHash)
    ]);
  }

  async listPushDevices(clientId?: string): Promise<Device[]> {
    const result = await this.db.prepare(`
      select id, clientId, name, apnsToken, sessionTokenHash, enabled, createdAt, lastSeenAt
      from (
        select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, codex_token_hash as codexTokenHash,
          enabled, created_at as createdAt, last_seen_at as lastSeenAt,
          row_number() over (partition by apns_token order by last_seen_at desc, created_at desc) as tokenRank
        from devices
        where enabled = 1 and apns_token is not null and (? = '' or client_id = ?)
      )
      where tokenRank = 1
      order by lastSeenAt desc
    `).bind(clientId ?? "", clientId ?? "").all<Device>();
    return result.results ?? [];
  }

  async listPushDevicesByCodexToken(token: string): Promise<Device[]> {
    const result = await this.db.prepare(`
      select id, client_id as clientId, name, apns_token as apnsToken, session_token_hash as sessionTokenHash, codex_token_hash as codexTokenHash,
        enabled, created_at as createdAt, last_seen_at as lastSeenAt
      from devices
      where enabled = 1 and apns_token is not null and codex_token_hash = ?
      order by last_seen_at desc
    `).bind(sha256(token)).all<Device>();
    return result.results ?? [];
  }

  async createApproval(input: Omit<ApprovalRequest, "id" | "status" | "decisionSource" | "createdAt" | "decidedAt">) {
    const id = randomToken("appr").slice(0, 26);
    const createdAt = nowIso();
    const row: ApprovalRequest = { ...input, id, status: "pending", decisionSource: null, createdAt, decidedAt: null };
    await this.db.prepare(`
      insert into approvals (id, client_id, event_id, project_name, cwd, model, command_summary, command_full, reason, risk_summary, status, notify_only, created_at, expires_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(row.id, row.clientId, row.eventId, row.projectName, row.cwd, row.model, row.commandSummary, row.commandFull, row.reason, row.riskSummary, row.status, row.notifyOnly ? 1 : 0, row.createdAt, row.expiresAt).run();
    return row;
  }

  async getApproval(id: string, clientId?: string): Promise<ApprovalRequest | null> {
    const row = await this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, command_summary as commandSummary,
        command_full as commandFull, reason, risk_summary as riskSummary, status, notify_only as notifyOnly, decision_source as decisionSource,
        created_at as createdAt, expires_at as expiresAt, decided_at as decidedAt
      from approvals where id = ? and (? = '' or client_id = ?)
    `).bind(id, clientId ?? "", clientId ?? "").first<ApprovalRequest>();
    return row ? { ...row, notifyOnly: Boolean(row.notifyOnly) } : null;
  }

  async expireApproval(id: string, clientId: string): Promise<ApprovalRequest | null> {
    const current = await this.getApproval(id, clientId);
    const now = nowIso();
    if (!current || current.status !== "pending" || current.expiresAt >= now) return current;
    await this.db.prepare("update approvals set status = 'expired' where id = ? and client_id = ? and status = 'pending' and expires_at < ?").bind(id, clientId, now).run();
    return await this.getApproval(id, clientId);
  }

  async decideApproval(id: string, clientId: string, status: "allowed" | "denied", source: string) {
    const now = nowIso();
    const current = await this.getApproval(id, clientId);
    if (!current) return null;
    if (current.notifyOnly) return current;
    if (current.status !== "pending") return current;
    if (current.expiresAt < now) return await this.expireApproval(id, clientId);
    await this.db.prepare("update approvals set status = ?, decision_source = ?, decided_at = ? where id = ? and client_id = ? and status = 'pending'").bind(status, source, now, id, clientId).run();
    return await this.getApproval(id, clientId);
  }

  async consumeTerminalApproval(id: string, clientId: string): Promise<ApprovalRequest | null> {
    const approval = await this.getApproval(id, clientId);
    if (!approval || (approval.status !== "allowed" && approval.status !== "denied" && approval.status !== "expired")) return null;
    await this.db.prepare("delete from approvals where id = ? and client_id = ?").bind(id, clientId).run();
    return approval;
  }

  async createCompletion(input: Omit<CompletionEvent, "id" | "createdAt" | "reply" | "repliedAt">) {
    const id = randomToken("done").slice(0, 26);
    const createdAt = nowIso();
    const row: CompletionEvent = { ...input, id, createdAt, reply: null, repliedAt: null };
    await this.db.prepare(`
      insert into completions (id, client_id, event_id, project_name, cwd, model, session_key, summary, status, notify_only, created_at, expires_at)
      values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(row.id, row.clientId, row.eventId, row.projectName, row.cwd, row.model, row.sessionKey, row.summary, row.status, row.notifyOnly ? 1 : 0, row.createdAt, row.expiresAt).run();
    return row;
  }

  async getCompletion(id: string, clientId?: string): Promise<CompletionEvent | null> {
    const row = await this.db.prepare(`
      select id, client_id as clientId, event_id as eventId, project_name as projectName, cwd, model, session_key as sessionKey, summary, status,
        notify_only as notifyOnly, created_at as createdAt, expires_at as expiresAt, reply, replied_at as repliedAt
      from completions where id = ? and (? = '' or client_id = ?)
    `).bind(id, clientId ?? "", clientId ?? "").first<CompletionEvent>();
    return row ? { ...row, notifyOnly: Boolean(row.notifyOnly) } : null;
  }

  async expireCompletion(id: string, clientId: string): Promise<CompletionEvent | null> {
    const current = await this.getCompletion(id, clientId);
    const now = nowIso();
    if (!current || current.status !== "waiting" || current.expiresAt >= now) return current;
    await this.db.prepare("update completions set status = 'expired' where id = ? and client_id = ? and status = 'waiting' and expires_at < ?").bind(id, clientId, now).run();
    return await this.getCompletion(id, clientId);
  }

  async replyCompletion(id: string, clientId: string, reply: string) {
    const current = await this.getCompletion(id, clientId);
    const now = nowIso();
    if (!current) return null;
    if (current.notifyOnly) return current;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    if (current.status === "waiting" && current.expiresAt < now) return await this.expireCompletion(id, clientId);
    await this.db.prepare("update completions set status = 'replied', reply = ?, replied_at = ? where id = ? and client_id = ? and status in ('waiting', 'notified')").bind(reply, now, id, clientId).run();
    return await this.getCompletion(id, clientId);
  }

  async interruptCompletion(id: string, clientId: string) {
    const current = await this.getCompletion(id, clientId);
    if (!current) return null;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    await this.db.prepare("update completions set status = 'interrupted' where id = ? and client_id = ? and status in ('waiting', 'notified')").bind(id, clientId).run();
    return await this.getCompletion(id, clientId);
  }

  async consumeTerminalCompletion(id: string, clientId: string): Promise<CompletionEvent | null> {
    const completion = await this.getCompletion(id, clientId);
    if (!completion || (completion.status !== "replied" && completion.status !== "interrupted" && completion.status !== "expired")) return null;
    await this.db.prepare("delete from completions where id = ? and client_id = ?").bind(id, clientId).run();
    return completion;
  }

  async continueLatestCompletionLocally(input: { clientId: string; cwd: string; projectName: string; sessionKey: string; prompt: string }) {
    if (!input.sessionKey) return null;
    const current = await this.db.prepare(`
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
    `).bind(input.clientId, input.cwd, input.projectName, input.sessionKey).first<CompletionEvent>();
    if (!current) return null;

    await this.db.prepare(`
      update completions
      set status = 'replied', reply = ?, replied_at = ?
      where id = ? and client_id = ? and notify_only = 0 and status in ('waiting', 'notified', 'interrupted')
    `).bind(input.prompt, nowIso(), current.id, input.clientId).run();
    return await this.getCompletion(current.id, input.clientId);
  }

  async getHookMode(clientId: string): Promise<HookMode | null> {
    const row = await this.db.prepare("select value from settings where key = ?").bind(`hook_mode:${clientId}`).first<{ value: string }>();
    return validHookMode(row?.value);
  }

  async setHookMode(clientId: string, mode: HookMode): Promise<HookMode> {
    await this.db.prepare(`
      insert into settings (key, value, updated_at)
      values (?, ?, ?)
      on conflict(key) do update set value = excluded.value, updated_at = excluded.updated_at
    `).bind(`hook_mode:${clientId}`, mode, nowIso()).run();
    return mode;
  }

  async clearHookMode(clientId: string): Promise<void> {
    await this.db.prepare("delete from settings where key = ?").bind(`hook_mode:${clientId}`).run();
  }

  async listEvents(clientId: string, limit = 50): Promise<EventListItem[]> {
    const result = await this.db.prepare(`
      select 'completion' as kind, id, project_name as projectName, model, status, summary, created_at as createdAt, expires_at as expiresAt, reply, notify_only as notifyOnly
      from completions
      where client_id = ?
      order by createdAt desc
      limit ?
    `).bind(clientId, limit).all<EventListItem>();
    return (result.results ?? []).map((row) => ({ ...row, notifyOnly: Boolean(row.notifyOnly) }));
  }
}
