import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const alias = { "@shared": fileURLToPath(new URL("./src/shared", import.meta.url)) };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "unit",
          environment: "node",
          include: ["src/shared/**/*.test.ts", "src/client/**/*.test.ts"],
        },
      },
      {
        resolve: { alias },
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: "./wrangler.jsonc" },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations("./migrations"),
                APP_URL: "http://localhost",
                ADMIN_EMAIL: "marc@example.com",
                BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-0123",
                GOOGLE_CLIENT_ID: "test-client-id",
                GOOGLE_CLIENT_SECRET: "test-client-secret",
                TURNSTILE_SITE_KEY: "1x00000000000000000000AA",
                TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA",
                VAPID_PUBLIC_KEY: "",
                VAPID_PRIVATE_KEY: "",
                DEV_LOGIN: "true",
              },
            },
          })),
        ],
        test: {
          name: "worker",
          include: ["test/**/*.test.ts"],
          setupFiles: ["./test/setup.ts"],
        },
      },
    ],
  },
});
