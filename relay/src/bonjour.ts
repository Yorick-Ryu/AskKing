import ciao, { type CiaoService, type Responder } from "@homebridge/ciao";
import type { RelayConfig } from "./config.js";

const serviceType = "askking";

export type BonjourPublisher = {
  shutdown: () => Promise<void>;
};

export async function publishBonjourRelay(config: RelayConfig): Promise<BonjourPublisher | null> {
  if (!config.bonjourEnabled) return null;

  let responder: Responder | null = null;
  let service: CiaoService | null = null;

  try {
    responder = ciao.getResponder();
    service = responder.createService({
      name: config.bonjourName,
      type: serviceType,
      port: config.port,
      txt: {
        app: "Codex Done",
        protocol: "http",
        version: "1",
        healthPath: "/health"
      }
    });
    await service.advertise();
    console.log(`Codex Done Relay Bonjour: ${config.bonjourName}._${serviceType}._tcp.local:${config.port}`);

    return {
      shutdown: async () => {
        await responder?.shutdown();
      }
    };
  } catch (error) {
    if (service) {
      await service.destroy().catch(() => undefined);
    }
    if (responder) {
      await responder.shutdown().catch(() => undefined);
    }
    console.warn("[bonjour] publish failed", error);
    return null;
  }
}
