import { networkInterfaces } from "node:os";

export type RelayConfig = {
  port: number;
  databasePath: string;
  publicBaseUrl: string;
  adminToken: string;
  defaultClientName: string;
  apns: {
    enabled: boolean;
    keyId: string;
    teamId: string;
    topic: string;
    keyPath: string;
    keySecretId: string;
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

export function loadConfig(): RelayConfig {
  const port = Number(process.env.ASKKING_PORT ?? "8787");
  const defaultPublicBaseUrl = localNetworkBaseUrl(port);
  return {
    port,
    databasePath: process.env.ASKKING_DB ?? "./askking.sqlite",
    publicBaseUrl: process.env.ASKKING_PUBLIC_BASE_URL ?? defaultPublicBaseUrl,
    adminToken: process.env.ASKKING_ADMIN_TOKEN ?? "dev-admin-token",
    defaultClientName: process.env.ASKKING_CLIENT_NAME ?? "Local Codex",
    apns: {
      enabled: process.env.ASKKING_APNS_ENABLED === "1",
      keyId: process.env.ASKKING_APNS_KEY_ID ?? "",
      teamId: process.env.ASKKING_APNS_TEAM_ID ?? "",
      topic: process.env.ASKKING_APNS_TOPIC ?? "",
      keyPath: process.env.ASKKING_APNS_KEY_PATH ?? "",
      keySecretId: process.env.ASKKING_APNS_KEY_SECRET_ID ?? "",
      production: process.env.ASKKING_APNS_PRODUCTION === "1"
    }
  };
}
