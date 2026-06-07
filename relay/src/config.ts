import { networkInterfaces } from "node:os";
import { existsSync, readFileSync } from "node:fs";

export type RelayConfig = {
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  bonjourEnabled: boolean;
  bonjourName: string;
  adminToken: string;
  defaultClientName: string;
  apns: {
    enabled: boolean;
    keyId: string;
    teamId: string;
    topic: string;
    keyPath: string;
    keyText: string;
    production: boolean;
  };
};

export function localNetworkBaseUrl(port: number) {
  const interfaces = networkInterfaces();
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family === "IPv4" && !address.internal) {
        return `http://${address.address}:${port}`;
      }
    }
  }
  return `http://localhost:${port}`;
}

export function loadEnvFile(path = ".env") {
  if (!existsSync(path)) return;
  const content = readFileSync(path, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    let value = rawValue.trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

export function loadConfig(): RelayConfig {
  loadEnvFile();
  const port = Number(process.env.ASKKING_PORT ?? "8787");
  const apnsEnabled = process.env.ASKKING_APNS_ENABLED === "1";
  const apnsKeyPath = process.env.ASKKING_APNS_KEY_PATH ?? "";
  const defaultPublicBaseUrl = localNetworkBaseUrl(port);
  return {
    port,
    databasePath: process.env.ASKKING_DB ?? "./askking.sqlite",
    publicBaseUrl: process.env.ASKKING_PUBLIC_BASE_URL ?? defaultPublicBaseUrl,
    bonjourEnabled: process.env.ASKKING_BONJOUR_ENABLED !== "0",
    bonjourName: process.env.ASKKING_BONJOUR_NAME ?? "AskKing Relay",
    adminToken: process.env.ASKKING_ADMIN_TOKEN ?? "dev-admin-token",
    defaultClientName: process.env.ASKKING_CLIENT_NAME ?? "Local Codex",
    apns: {
      enabled: apnsEnabled,
      keyId: process.env.ASKKING_APNS_KEY_ID ?? "",
      teamId: process.env.ASKKING_APNS_TEAM_ID ?? "",
      topic: process.env.ASKKING_APNS_TOPIC ?? "",
      keyPath: apnsKeyPath,
      keyText: apnsEnabled && apnsKeyPath && existsSync(apnsKeyPath)
        ? readFileSync(apnsKeyPath, "utf8")
        : process.env.ASKKING_APNS_KEY ?? "",
      production: process.env.ASKKING_APNS_PRODUCTION === "1"
    }
  };
}
