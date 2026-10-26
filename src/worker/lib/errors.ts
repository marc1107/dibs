import type { MutationResult } from "@shared/api";

type ErrorCode = Extract<MutationResult, { ok: false }>["error"];

const STATUS: Record<ErrorCode, 400 | 403 | 404 | 409 | 500> = {
  invalid: 400,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  stale: 409,
  already_over: 409,
  not_started: 409,
  server: 500,
};

/** A domain error that maps to an HTTP status and a MutationResult. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: Pick<Extract<MutationResult, { ok: false }>, "server" | "conflicts"> = {},
  ) {
    super(message);
  }

  get status() {
    return STATUS[this.code];
  }

  toResult(): Extract<MutationResult, { ok: false }> {
    return { ok: false, error: this.code, message: this.message, ...this.extra };
  }
}

export const forbidden = (message = "Keine Berechtigung") => new AppError("forbidden", message);
export const notFound = (message = "Nicht gefunden") => new AppError("not_found", message);
