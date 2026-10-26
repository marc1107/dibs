import type { MutationResult } from "@shared/api";
import type { Context } from "hono";
import type { z } from "zod";
import type { AppEnv } from "../env";
import { AppError } from "./errors";
import type { ServiceCtx } from "../services/context";

/** Validates a JSON body (or query object) against a shared Zod schema. */
export async function parseBody<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.infer<S>> {
  const raw = await c.req.json().catch(() => {
    throw new AppError("invalid", "Ungültiges JSON");
  });
  return parseValue(schema, raw);
}

export function parseValue<S extends z.ZodType>(schema: S, raw: unknown): z.infer<S> {
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new AppError("invalid", issue ? issue.message : "Ungültige Eingabe");
  }
  return parsed.data;
}

export function serviceCtx(c: Context<AppEnv>, queuedOffline = false): ServiceCtx {
  const user = c.get("user");
  return {
    db: c.get("db"),
    env: c.env,
    actor: { id: user.id, name: user.name, role: user.role },
    now: new Date(),
    queuedOffline,
    notifier: c.get("notifier"),
  };
}

const STATUS_BY_OUTCOME = { created: 201, requested: 202 } as const;

/** Sends a MutationResult with a fitting status code (201 created, 202 became a request, 4xx errors). */
export function sendResult(c: Context<AppEnv>, result: MutationResult) {
  if (!result.ok) return c.json(result, new AppError(result.error, result.message).status);
  const status = STATUS_BY_OUTCOME[result.outcome as keyof typeof STATUS_BY_OUTCOME] ?? 200;
  return c.json(result, status);
}
