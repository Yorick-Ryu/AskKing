import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const workDir = await mkdtemp(join(tmpdir(), "askking-package-smoke-"));
const installDir = join(workDir, "install");
const homeDir = join(workDir, "home");

try {
  await run("pnpm", ["pack", "--pack-destination", workDir], { cwd: root });
  const packagePath = join(workDir, "askking-0.1.0.tgz");
  if (!existsSync(packagePath)) throw new Error(`Package was not created: ${packagePath}`);

  await run("npm", ["init", "-y"], { cwd: workDir, quiet: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(homeDir, { recursive: true });
  await run("npm", ["init", "-y"], { cwd: installDir, quiet: true });
  await run("npm", ["install", "--omit=dev", packagePath], { cwd: installDir, quiet: true });

  await run("./node_modules/.bin/askking", ["configure", "https://relay.example.com", "ck_test_token"], {
    cwd: installDir,
    env: { ...process.env, HOME: homeDir }
  });

  const config = JSON.parse(await readFile(join(homeDir, ".codex", "askking", "config.json"), "utf8"));
  assert(config.relayUrl === "https://relay.example.com", "configure writes relay URL under temporary HOME");
  assert(config.clientToken === "ck_test_token", "configure writes client token under temporary HOME");
  assert(!existsSync(join(installDir, "node_modules", "better-sqlite3")), "production install excludes better-sqlite3");
  assert(!existsSync(join(installDir, "node_modules", "@hono", "node-server")), "production install excludes @hono/node-server");
  assert(!existsSync(join(installDir, "node_modules", "@homebridge", "ciao")), "production install excludes Bonjour dependency");

  console.log("AskKing package smoke test passed");
} finally {
  await rm(workDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: options.quiet ? ["ignore", "ignore", "pipe"] : ["ignore", "inherit", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
      if (!options.quiet) process.stderr.write(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}${stderr ? `:\n${stderr}` : ""}`));
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}
