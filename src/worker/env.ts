import type { Role, UserStatus } from "@shared/constants";
import type { Db } from "./db/client";
import type { Notifier } from "./services/notifier";

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  color: string;
}

/** Variables set by middleware on the Hono context. */
export interface AppEnv {
  Bindings: Env;
  Variables: {
    db: Db;
    notifier: Notifier;
    user: SessionUser;
  };
}

/** Optional bindings that are only present in some environments. */
export function devLoginEnabled(env: Env, url: string): boolean {
  const flag = (env as { DEV_LOGIN?: string }).DEV_LOGIN;
  const host = new URL(url).hostname;
  return flag === "true" && (host === "localhost" || host === "127.0.0.1");
}
