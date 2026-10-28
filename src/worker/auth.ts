import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import type { Db } from "./db/client";
import * as schema from "./db/schema";
import { newSecretToken } from "./lib/ids";
import type { Notifier } from "./services/notifier";
import { nextFreeColor } from "./services/users";

const THIRTY_DAYS = 60 * 60 * 24 * 30;

/**
 * Better Auth: Google OAuth for the first sign-in, passkeys (Face ID) afterwards.
 * Created per request because Worker bindings and secrets are only known at request time.
 */
export function createAuth(env: Env, db: Db, notifier?: Notifier) {
  const appUrl = new URL(env.APP_URL);
  const adminEmail = env.ADMIN_EMAIL.trim().toLowerCase();

  return betterAuth({
    appName: "dibs",
    baseURL: env.APP_URL,
    basePath: "/api/auth",
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, { provider: "sqlite", schema }),
    trustedOrigins: [appUrl.origin],
    socialProviders: {
      google: {
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        prompt: "select_account",
      },
    },
    // 30 days, sliding (refreshed at most once a day) so the installed PWA stays signed in.
    session: { expiresIn: THIRTY_DAYS, updateAge: 60 * 60 * 24 },
    user: {
      additionalFields: {
        // input: false → clients can never set these through the auth endpoints.
        role: { type: "string", input: false, defaultValue: "member" },
        status: { type: "string", input: false, defaultValue: "pending" },
        color: { type: "string", input: false, required: false },
        startView: { type: "string", input: false, defaultValue: "month" },
        icalToken: { type: "string", input: false, required: false, returned: false },
      },
    },
    // Rate limiting is done with the Workers Rate Limiting binding in front of /api/auth/*.
    rateLimit: { enabled: false },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: appUrl.protocol === "https:",
    },
    onAPIError: { errorURL: "/login" },
    databaseHooks: {
      user: {
        create: {
          before: async (newUser) => {
            const isAdmin = newUser.email.trim().toLowerCase() === adminEmail;
            return {
              data: {
                ...newUser,
                role: isAdmin ? "admin" : "member",
                status: isAdmin ? "active" : "pending",
                color: await nextFreeColor(db),
                icalToken: newSecretToken(),
              },
            };
          },
          after: async (created) => {
            if (!notifier || (created as { status?: string }).status !== "pending") return;
            const admins = await db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.role, "admin"));
            notifier.add(
              admins.map((a) => a.id),
              "approval_request",
              { title: "Neue Freigabe-Anfrage", body: `${created.name} (${created.email}) möchte mitmachen.`, url: "/admin", tag: "approval" },
            );
          },
        },
      },
      session: {
        create: {
          // Removed (or rejected) people can never get a new session, even via Google.
          before: async (newSession) => {
            const owner = await db.query.user.findFirst({ where: eq(schema.user.id, newSession.userId) });
            if (!owner || owner.status === "removed") return false;
            return { data: newSession };
          },
        },
      },
    },
    plugins: [
      passkey({ rpID: appUrl.hostname, rpName: "dibs", origin: appUrl.origin }),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: env.TURNSTILE_SECRET_KEY,
        endpoints: ["/sign-in/social"],
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
