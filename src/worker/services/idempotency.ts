import type { MutationResult } from "@shared/api";
import { eq } from "drizzle-orm";
import { clientAction } from "../db/schema";
import { AppError } from "../lib/errors";
import { nowIso, type ServiceCtx } from "./context";

/**
 * Runs a mutation at most once per client UUID. A replay (double tap, retried sync, lost
 * response) returns the stored result instead of creating duplicates. Domain errors are
 * stored too, so a replay gets the same answer.
 */
export async function once(
  ctx: ServiceCtx,
  clientId: string,
  kind: string,
  run: () => Promise<MutationResult>,
): Promise<MutationResult> {
  const previous = await ctx.db.query.clientAction.findFirst({ where: eq(clientAction.id, clientId) });
  if (previous) {
    if (previous.userId !== ctx.actor.id) return { ok: false, error: "forbidden", message: "Ungültige Aktions-ID" };
    return JSON.parse(previous.resultJson) as MutationResult;
  }
  let result: MutationResult;
  try {
    result = await run();
  } catch (err) {
    if (!(err instanceof AppError)) throw err;
    result = err.toResult();
  }
  await ctx.db
    .insert(clientAction)
    .values({ id: clientId, userId: ctx.actor.id, kind, resultJson: JSON.stringify(result), createdAt: nowIso(ctx) })
    .onConflictDoNothing();
  return result;
}
