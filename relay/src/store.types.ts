import type { ApprovalRequest, CompletionEvent, CodexClient, Device, HookMode } from "./types.js";

export type MaybePromise<T> = T | Promise<T>;

export type EventListItem = {
  kind: "approval" | "completion";
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

export type PairingCodeInput = {
  clientId?: string;
};

export type PairingCodeResult = {
  code: string;
  expiresAt: string;
  clientId?: string;
};

export type CreatedClient = {
  id: string;
  token: string;
};

export type PairedDevice = {
  id: string;
  sessionToken: string;
};

export interface RelayStore {
  createClient(name: string, defaultProjectName: string): MaybePromise<CreatedClient>;
  getClientByToken(token: string): MaybePromise<CodexClient | null>;
  listClients(): MaybePromise<CodexClient[]>;
  revokeClient(clientId: string): MaybePromise<boolean>;
  createPairingCode(input?: PairingCodeInput, ttlSeconds?: number): MaybePromise<PairingCodeResult>;
  pairDevice(code: string, name: string): MaybePromise<PairedDevice | null>;
  getDeviceByToken(token: string): MaybePromise<Device | null>;
  listDevices(): MaybePromise<Device[]>;
  hasEnabledDevice(clientId: string): MaybePromise<boolean>;
  revokeDevice(deviceId: string): MaybePromise<boolean>;
  setDeviceApnsToken(sessionTokenHash: string, token: string): MaybePromise<void>;
  listPushDevices(clientId?: string): MaybePromise<Device[]>;
  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "decisionSource" | "createdAt" | "decidedAt">): MaybePromise<ApprovalRequest>;
  getApproval(id: string, clientId?: string): MaybePromise<ApprovalRequest | null>;
  expireApproval(id: string, clientId: string): MaybePromise<ApprovalRequest | null>;
  decideApproval(id: string, clientId: string, status: "allowed" | "denied", source: string): MaybePromise<ApprovalRequest | null>;
  consumeTerminalApproval(id: string, clientId: string): MaybePromise<ApprovalRequest | null>;
  createCompletion(input: Omit<CompletionEvent, "id" | "createdAt" | "reply" | "repliedAt">): MaybePromise<CompletionEvent>;
  getCompletion(id: string, clientId?: string): MaybePromise<CompletionEvent | null>;
  expireCompletion(id: string, clientId: string): MaybePromise<CompletionEvent | null>;
  replyCompletion(id: string, clientId: string, reply: string): MaybePromise<CompletionEvent | null>;
  interruptCompletion(id: string, clientId: string): MaybePromise<CompletionEvent | null>;
  consumeTerminalCompletion(id: string, clientId: string): MaybePromise<CompletionEvent | null>;
  continueLatestCompletionLocally(input: {
    clientId: string;
    cwd: string;
    projectName: string;
    sessionKey: string;
    prompt: string;
  }): MaybePromise<CompletionEvent | null>;
  getHookMode(clientId: string): MaybePromise<HookMode | null>;
  setHookMode(clientId: string, mode: HookMode): MaybePromise<HookMode>;
  clearHookMode(clientId: string): MaybePromise<void>;
  listEvents(clientId: string, limit?: number): MaybePromise<EventListItem[]>;
}
