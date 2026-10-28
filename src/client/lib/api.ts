/** Thin fetch wrapper for the same-origin JSON API (session cookie, no CORS). */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly body?: unknown,
  ) {
    super(message);
  }
}

/** True when the request never reached the server (offline, DNS, timeout). */
export class NetworkError extends Error {}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (json !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(path, {
      ...rest,
      headers,
      credentials: "same-origin",
      body: json !== undefined ? JSON.stringify(json) : rest.body,
    });
  } catch {
    throw new NetworkError("Keine Verbindung");
  }
  const body = res.headers.get("content-type")?.includes("application/json") ? await res.json() : undefined;
  if (!res.ok) {
    const b = (body ?? {}) as { error?: string; message?: string };
    throw new ApiError(res.status, b.error ?? "error", b.message ?? `Fehler ${res.status}`, body);
  }
  return body as T;
}

export const errorMessage = (err: unknown) =>
  err instanceof ApiError || err instanceof NetworkError ? err.message : "Etwas ist schiefgelaufen";
