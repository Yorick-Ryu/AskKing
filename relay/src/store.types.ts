import type { ApprovalRequest, CompletionEvent, CodexClient, Device } from "./types.js";

export type MaybePromise<T> = T | Promise<T>;

export type EventListItem = {
  kind: "approval" | "completion";
  id: string;
  projectName: string;
  model: string;
  status: string;
  summary: string;
  createdAt: string;
};

export type PairingCodeResult = {
  code: string;
  expiresAt: string;
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
  createPairingCode(ttlSeconds?: number): MaybePromise<PairingCodeResult>;
  pairDevice(code: string, name: string): MaybePromise<PairedDevice | null>;
  getDeviceByToken(token: string): MaybePromise<Device | null>;
  listDevices(): MaybePromise<Device[]>;
  revokeDevice(deviceId: string): MaybePromise<boolean>;
  setDeviceApnsToken(deviceId: string, token: string): MaybePromise<void>;
  listPushDevices(): MaybePromise<Device[]>;
  createApproval(input: Omit<ApprovalRequest, "id" | "status" | "decisionSource" | "createdAt" | "decidedAt">): MaybePromise<ApprovalRequest>;
  getApproval(id: string): MaybePromise<ApprovalRequest | null>;
  decideApproval(id: string, status: "allowed" | "denied", source: string): MaybePromise<ApprovalRequest | null>;
  createCompletion(input: Omit<CompletionEvent, "id" | "status" | "createdAt" | "reply" | "repliedAt">): MaybePromise<CompletionEvent>;
  getCompletion(id: string): MaybePromise<CompletionEvent | null>;
  replyCompletion(id: string, reply: string): MaybePromise<CompletionEvent | null>;
  listEvents(limit?: number): MaybePromise<EventListItem[]>;
  expireOld(): MaybePromise<void>;
}
