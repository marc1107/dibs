// Starts a fresh local stack for the Playwright tests: empty D1 in .wrangler/e2e,
// migrations applied, then `vite dev` with E2E=1 (see vite.config.ts).
import { execSync, spawn } from "node:child_process";
import { existsSync, rmSync } from "node:fs";

const STATE = ".wrangler/e2e";
if (existsSync(STATE)) rmSync(STATE, { recursive: true, force: true });
execSync(`pnpm exec wrangler d1 migrations apply DB --local --persist-to ${STATE}`, { stdio: "inherit" });

const vite = spawn("pnpm", ["exec", "vite", "--port", "5173", "--strictPort"], {
  stdio: "inherit",
  env: { ...process.env, E2E: "1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => vite.kill(signal));
vite.on("exit", (code) => process.exit(code ?? 0));
