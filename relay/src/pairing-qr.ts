import { generate, setErrorLevel } from "qrcode-terminal";

export type PairingQrInput = {
  relayUrl: string;
  code: string;
  expiresAt: string;
};

export function pairingQrPayload(input: PairingQrInput) {
  const params = new URLSearchParams({
    relayUrl: input.relayUrl,
    code: input.code,
    expiresAt: input.expiresAt
  });
  return `askking://pair?${params.toString()}`;
}

export function printPairingQr(input: PairingQrInput) {
  const payload = pairingQrPayload(input);
  setErrorLevel("L");
  console.log("");
  console.log("AskKing iOS pairing");
  console.log(`Relay URL: ${input.relayUrl}`);
  console.log(`Pairing code: ${input.code}`);
  console.log(`Expires at: ${input.expiresAt}`);
  console.log("Scan this QR code in the AskKing iOS app:");
  generate(payload, { small: true }, (output) => {
    console.log(output);
  });
}
