import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { randomCode, randomToken, sha256 } from "./crypto.js";
import type { RelayStore, EventListItem } from "./store.types.js";
import type { ApprovalRequest, CompletionEvent, CodexClient, Device, HookMode } from "./types.js";

type DynamoStoreConfig = {
  clientsTable: string;
  devicesTable: string;
  pairingCodesTable: string;
  approvalsTable: string;
  completionsTable: string;
};

function ttlFromIso(value: string) {
  return Math.floor(new Date(value).getTime() / 1000);
}

function enabled(row: { enabled?: number | boolean } | undefined) {
  return row?.enabled === undefined || row.enabled === true || row.enabled === 1;
}

const HOOK_MODE_KEY = "__setting#hook_mode";

export class DynamoStore implements RelayStore {
  private db: DynamoDBDocumentClient;

  constructor(private config: DynamoStoreConfig, client = new DynamoDBClient({})) {
    this.db = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true
      }
    });
  }

  static fromEnv() {
    return new DynamoStore({
      clientsTable: env("ASKKING_DDB_CLIENTS_TABLE"),
      devicesTable: env("ASKKING_DDB_DEVICES_TABLE"),
      pairingCodesTable: env("ASKKING_DDB_PAIRING_CODES_TABLE"),
      approvalsTable: env("ASKKING_DDB_APPROVALS_TABLE"),
      completionsTable: env("ASKKING_DDB_COMPLETIONS_TABLE")
    });
  }

  async createClient(name: string, defaultProjectName: string) {
    const id = randomToken("client").slice(0, 22);
    const token = randomToken("ck");
    const now = new Date().toISOString();
    await this.db.send(new PutCommand({
      TableName: this.config.clientsTable,
      Item: {
        tokenHash: sha256(token),
        id,
        name,
        defaultProjectName,
        enabled: 1,
        createdAt: now,
        lastSeenAt: now
      },
      ConditionExpression: "attribute_not_exists(tokenHash)"
    }));
    return { id, token };
  }

  async getClientByToken(token: string): Promise<CodexClient | null> {
    const tokenHash = sha256(token);
    const result = await this.db.send(new GetCommand({
      TableName: this.config.clientsTable,
      Key: { tokenHash }
    }));
    const row = result.Item as CodexClient | undefined;
    if (!row || !enabled(row)) return null;
    await this.db.send(new UpdateCommand({
      TableName: this.config.clientsTable,
      Key: { tokenHash },
      UpdateExpression: "set lastSeenAt = :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() }
    }));
    return { ...row, clientTokenHash: tokenHash };
  }

  async listClients(): Promise<CodexClient[]> {
    const result = await this.db.send(new ScanCommand({
      TableName: this.config.clientsTable
    }));
    return ((result.Items ?? []) as CodexClient[])
      .filter((item) => Boolean(item.id))
      .map((item) => ({ ...item, clientTokenHash: (item as unknown as { tokenHash?: string }).tokenHash ?? item.clientTokenHash }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeClient(clientId: string) {
    const clients = await this.db.send(new ScanCommand({
      TableName: this.config.clientsTable,
      FilterExpression: "id = :id",
      ExpressionAttributeValues: { ":id": clientId },
      Limit: 1
    }));
    const client = clients.Items?.[0] as { tokenHash?: string } | undefined;
    if (!client?.tokenHash) return false;
    await this.db.send(new UpdateCommand({
      TableName: this.config.clientsTable,
      Key: { tokenHash: client.tokenHash },
      UpdateExpression: "set enabled = :disabled, lastSeenAt = :now",
      ExpressionAttributeValues: { ":disabled": 0, ":now": new Date().toISOString() }
    }));
    return true;
  }

  async createPairingCode(ttlSeconds = 600) {
    const code = randomCode();
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000).toISOString();
    await this.db.send(new PutCommand({
      TableName: this.config.pairingCodesTable,
      Item: {
        code,
        expiresAt,
        expiresTtl: ttlFromIso(expiresAt)
      },
      ConditionExpression: "attribute_not_exists(code)"
    }));
    return { code, expiresAt };
  }

  async pairDevice(code: string, name: string) {
    const now = new Date().toISOString();
    const pairingResult = await this.db.send(new GetCommand({
      TableName: this.config.pairingCodesTable,
      Key: { code }
    }));
    const pairing = pairingResult.Item as { code: string; expiresAt: string; usedAt?: string } | undefined;
    if (!pairing || pairing.usedAt || pairing.expiresAt < now) return null;

    const id = randomToken("dev").slice(0, 22);
    const sessionToken = randomToken("ios");
    const sessionTokenHash = sha256(sessionToken);
    await this.db.send(new UpdateCommand({
      TableName: this.config.pairingCodesTable,
      Key: { code },
      UpdateExpression: "set usedAt = :now",
      ConditionExpression: "attribute_not_exists(usedAt)",
      ExpressionAttributeValues: { ":now": now }
    }));
    await this.db.send(new PutCommand({
      TableName: this.config.devicesTable,
      Item: {
        sessionTokenHash,
        id,
        name,
        apnsToken: null,
        enabled: 1,
        createdAt: now,
        lastSeenAt: now
      },
      ConditionExpression: "attribute_not_exists(sessionTokenHash)"
    }));
    return { id, sessionToken };
  }

  async getDeviceByToken(token: string): Promise<Device | null> {
    const sessionTokenHash = sha256(token);
    const result = await this.db.send(new GetCommand({
      TableName: this.config.devicesTable,
      Key: { sessionTokenHash }
    }));
    const row = result.Item as Device | undefined;
    if (!row || !enabled(row)) return null;
    await this.db.send(new UpdateCommand({
      TableName: this.config.devicesTable,
      Key: { sessionTokenHash },
      UpdateExpression: "set lastSeenAt = :now",
      ExpressionAttributeValues: { ":now": new Date().toISOString() }
    }));
    return { ...row, sessionTokenHash };
  }

  async listDevices(): Promise<Device[]> {
    const result = await this.db.send(new ScanCommand({
      TableName: this.config.devicesTable
    }));
    return ((result.Items ?? []) as Device[])
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revokeDevice(deviceId: string) {
    const devices = await this.db.send(new ScanCommand({
      TableName: this.config.devicesTable,
      FilterExpression: "id = :id",
      ExpressionAttributeValues: { ":id": deviceId },
      Limit: 1
    }));
    const device = devices.Items?.[0] as Device | undefined;
    if (!device?.sessionTokenHash) return false;
    await this.db.send(new UpdateCommand({
      TableName: this.config.devicesTable,
      Key: { sessionTokenHash: device.sessionTokenHash },
      UpdateExpression: "set enabled = :disabled, lastSeenAt = :now remove apnsToken",
      ExpressionAttributeValues: { ":disabled": 0, ":now": new Date().toISOString() }
    }));
    return true;
  }

  async setDeviceApnsToken(deviceId: string, token: string) {
    const devices = await this.db.send(new ScanCommand({
      TableName: this.config.devicesTable,
      FilterExpression: "id = :id",
      ExpressionAttributeValues: { ":id": deviceId },
      Limit: 1
    }));
    const device = devices.Items?.[0] as Device | undefined;
    if (!device) return;
    await this.db.send(new UpdateCommand({
      TableName: this.config.devicesTable,
      Key: { sessionTokenHash: device.sessionTokenHash },
      UpdateExpression: "set apnsToken = :token, lastSeenAt = :now",
      ExpressionAttributeValues: { ":token": token, ":now": new Date().toISOString() }
    }));
  }

  async listPushDevices(): Promise<Device[]> {
    const result = await this.db.send(new ScanCommand({
      TableName: this.config.devicesTable,
      FilterExpression: "enabled = :enabled and attribute_exists(apnsToken)",
      ExpressionAttributeValues: { ":enabled": 1 }
    }));
    return (result.Items ?? []) as Device[];
  }

  async createApproval(input: Omit<ApprovalRequest, "id" | "status" | "decisionSource" | "createdAt" | "decidedAt">) {
    const id = randomToken("appr").slice(0, 26);
    const createdAt = new Date().toISOString();
    const approval: ApprovalRequest = { ...input, id, status: "pending", decisionSource: null, createdAt, decidedAt: null };
    await this.db.send(new PutCommand({
      TableName: this.config.approvalsTable,
      Item: {
        ...approval,
        expiresTtl: ttlFromIso(approval.expiresAt)
      },
      ConditionExpression: "attribute_not_exists(id)"
    }));
    return approval;
  }

  async getApproval(id: string): Promise<ApprovalRequest | null> {
    const result = await this.db.send(new GetCommand({
      TableName: this.config.approvalsTable,
      Key: { id }
    }));
    return (result.Item as ApprovalRequest | undefined) ?? null;
  }

  async decideApproval(id: string, status: "allowed" | "denied", source: string) {
    const current = await this.getApproval(id);
    const now = new Date().toISOString();
    if (!current) return null;
    if (current.status !== "pending") return current;
    if (current.expiresAt < now) {
      await this.db.send(new UpdateCommand({
        TableName: this.config.approvalsTable,
        Key: { id },
        UpdateExpression: "set #status = :expired",
        ConditionExpression: "#status = :pending",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":expired": "expired", ":pending": "pending" }
      })).catch(() => undefined);
      return this.getApproval(id);
    }
    await this.db.send(new UpdateCommand({
      TableName: this.config.approvalsTable,
      Key: { id },
      UpdateExpression: "set #status = :status, decisionSource = :source, decidedAt = :now",
      ConditionExpression: "#status = :pending",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": status, ":source": source, ":now": now, ":pending": "pending" }
    })).catch(() => undefined);
    return this.getApproval(id);
  }

  async createCompletion(input: Omit<CompletionEvent, "id" | "createdAt" | "reply" | "repliedAt">) {
    const id = randomToken("done").slice(0, 26);
    const createdAt = new Date().toISOString();
    const completion: CompletionEvent = { ...input, id, createdAt, reply: null, repliedAt: null };
    await this.db.send(new PutCommand({
      TableName: this.config.completionsTable,
      Item: {
        ...completion,
        expiresTtl: ttlFromIso(completion.expiresAt)
      },
      ConditionExpression: "attribute_not_exists(id)"
    }));
    return completion;
  }

  async getCompletion(id: string): Promise<CompletionEvent | null> {
    const result = await this.db.send(new GetCommand({
      TableName: this.config.completionsTable,
      Key: { id }
    }));
    return (result.Item as CompletionEvent | undefined) ?? null;
  }

  async replyCompletion(id: string, reply: string) {
    const current = await this.getCompletion(id);
    const now = new Date().toISOString();
    if (!current) return null;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    if (current.status === "waiting" && current.expiresAt < now) {
      await this.db.send(new UpdateCommand({
        TableName: this.config.completionsTable,
        Key: { id },
        UpdateExpression: "set #status = :expired",
        ConditionExpression: "#status = :waiting",
        ExpressionAttributeNames: { "#status": "status" },
        ExpressionAttributeValues: { ":expired": "expired", ":waiting": "waiting" }
      })).catch(() => undefined);
      return this.getCompletion(id);
    }
    await this.db.send(new UpdateCommand({
      TableName: this.config.completionsTable,
      Key: { id },
      UpdateExpression: "set #status = :replied, reply = :reply, repliedAt = :now",
      ConditionExpression: "#status IN (:waiting, :notified)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":replied": "replied", ":reply": reply, ":now": now, ":waiting": "waiting", ":notified": "notified" }
    })).catch(() => undefined);
    return this.getCompletion(id);
  }

  async interruptCompletion(id: string) {
    const current = await this.getCompletion(id);
    if (!current) return null;
    if (current.status !== "waiting" && current.status !== "notified") return current;
    await this.db.send(new UpdateCommand({
      TableName: this.config.completionsTable,
      Key: { id },
      UpdateExpression: "set #status = :interrupted",
      ConditionExpression: "#status IN (:waiting, :notified)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":interrupted": "interrupted", ":waiting": "waiting", ":notified": "notified" }
    })).catch(() => undefined);
    return this.getCompletion(id);
  }

  async continueLatestCompletionLocally(input: { clientId: string; cwd: string; projectName: string; sessionKey: string; prompt: string }) {
    if (!input.sessionKey) return null;
    const result = await this.db.send(new ScanCommand({
      TableName: this.config.completionsTable,
      FilterExpression: "clientId = :clientId and cwd = :cwd and projectName = :projectName and sessionKey = :sessionKey and #status IN (:waiting, :notified, :interrupted)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":clientId": input.clientId,
        ":cwd": input.cwd,
        ":projectName": input.projectName,
        ":sessionKey": input.sessionKey,
        ":waiting": "waiting",
        ":notified": "notified",
        ":interrupted": "interrupted"
      }
    }));
    const current = ((result.Items ?? []) as CompletionEvent[]).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (!current) return null;
    await this.db.send(new UpdateCommand({
      TableName: this.config.completionsTable,
      Key: { id: current.id },
      UpdateExpression: "set #status = :continued, reply = :prompt, repliedAt = :now",
      ConditionExpression: "#status IN (:waiting, :notified, :interrupted)",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: {
        ":continued": "replied",
        ":prompt": input.prompt,
        ":now": new Date().toISOString(),
        ":waiting": "waiting",
        ":notified": "notified",
        ":interrupted": "interrupted"
      }
    })).catch(() => undefined);
    return this.getCompletion(current.id);
  }

  async getHookMode(): Promise<HookMode | null> {
    const result = await this.db.send(new GetCommand({
      TableName: this.config.clientsTable,
      Key: { tokenHash: HOOK_MODE_KEY }
    }));
    const value = (result.Item as { value?: string } | undefined)?.value;
    if (value === "off" || value === "notify" || value === "approval" || value === "full") return value;
    return null;
  }

  async setHookMode(mode: HookMode): Promise<HookMode> {
    await this.db.send(new PutCommand({
      TableName: this.config.clientsTable,
      Item: {
        tokenHash: HOOK_MODE_KEY,
        value: mode,
        updatedAt: new Date().toISOString()
      }
    }));
    return mode;
  }

  async clearHookMode(): Promise<void> {
    await this.db.send(new DeleteCommand({
      TableName: this.config.clientsTable,
      Key: { tokenHash: HOOK_MODE_KEY }
    }));
  }

  async listEvents(limit = 50): Promise<EventListItem[]> {
    const [approvals, completions] = await Promise.all([
      this.db.send(new ScanCommand({ TableName: this.config.approvalsTable, Limit: limit })),
      this.db.send(new ScanCommand({ TableName: this.config.completionsTable, Limit: limit }))
    ]);
    return [
      ...((approvals.Items ?? []) as ApprovalRequest[]).map((item) => ({
        kind: "approval" as const,
        id: item.id,
        projectName: item.projectName,
        model: item.model,
        status: item.status,
        summary: item.commandSummary,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        reply: null
      })),
      ...((completions.Items ?? []) as CompletionEvent[]).map((item) => ({
        kind: "completion" as const,
        id: item.id,
        projectName: item.projectName,
        model: item.model,
        status: item.status,
        summary: item.summary,
        createdAt: item.createdAt,
        expiresAt: item.expiresAt,
        reply: item.reply
      }))
    ].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }

  async expireOld() {
    const now = new Date().toISOString();
    await Promise.all([
      this.expireTable(this.config.approvalsTable, "pending", now),
      this.expireTable(this.config.completionsTable, "waiting", now)
    ]);
  }

  private async expireTable(tableName: string, activeStatus: string, now: string) {
    const result = await this.db.send(new ScanCommand({
      TableName: tableName,
      FilterExpression: "#status = :status and expiresAt < :now",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":status": activeStatus, ":now": now }
    }));
    await Promise.all((result.Items ?? []).map((item) => this.db.send(new UpdateCommand({
      TableName: tableName,
      Key: { id: item.id },
      UpdateExpression: "set #status = :expired",
      ExpressionAttributeNames: { "#status": "status" },
      ExpressionAttributeValues: { ":expired": "expired" }
    }))));
  }
}

function env(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
