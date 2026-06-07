import type { CodexClient, Device } from "./types.js";

export type MaybePromise<T> = T | Promise<T>;

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
  revokeDevice(deviceId: string): MaybePromise<boolean>;
  setDeviceApnsToken(sessionTokenHash: string, token: string): MaybePromise<void>;
  listPushDevices(clientId?: string): MaybePromise<Device[]>;
}
