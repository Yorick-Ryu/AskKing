declare module "qrcode-terminal" {
  export function setErrorLevel(level: "L" | "M" | "Q" | "H"): void;
  export function generate(input: string, options: { small?: boolean }, callback: (output: string) => void): void;
}
