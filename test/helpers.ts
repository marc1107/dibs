import type { BookingDto, MutationResult } from "@shared/api";
import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { createDb } from "../src/worker/db/client";
import type { Actor, ServiceCtx } from "../src/worker/services/context";
import { Notifier } from "../src/worker/services/notifier";

const BASE = "http://localhost";

export interface Client {
  id: string;
  email: string;
  cookie: string;
  fetch: (path: string, init?: RequestInit & { json?: unknown }) => Promise<Response>;
  json: <T = unknown>(path: string, init?: RequestInit & { json?: unknown }) => Promise<{ status: number; body: T }>;
}

const worker = (exports as unknown as { default: Fetcher }).default;

export function rawFetch(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`${BASE}${path}`, init));
}

/** Signs in through the local dev login and returns a small API client bound to that session. */
export async function login(email: string, name?: string): Promise<Client> {
  const res = await rawFetch("/api/dev/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, name }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status} ${await res.text()}`);
  const { userId } = (await res.json()) as { userId: string };
  const cookie = res.headers.get("set-cookie")!.split(";")[0]!;
  const doFetch: Client["fetch"] = (path, init = {}) => {
    const { json, ...rest } = init;
    const headers = new Headers(rest.headers);
    headers.set("cookie", cookie);
    if (json !== undefined) headers.set("content-type", "application/json");
    return rawFetch(path, { ...rest, headers, body: json !== undefined ? JSON.stringify(json) : rest.body });
  };
  return {
    id: userId,
    email,
    cookie,
    fetch: doFetch,
    json: async (path, init) => {
      const r = await doFetch(path, init);
      return { status: r.status, body: (await r.json()) as never };
    },
  };
}

/** Admin (ADMIN_EMAIL) plus two approved members, like the real household. */
export async function household() {
  const marc = await login("marc@example.com", "Marc");
  const tim = await login("tim@example.com", "Tim");
  const lena = await login("lena@example.com", "Lena");
  for (const u of [tim, lena]) {
    const res = await marc.fetch(`/api/admin/users/${u.id}/approve`, { method: "POST" });
    if (!res.ok) throw new Error(`approve failed ${res.status}`);
  }
  return { marc, tim, lena };
}

export const uuid = () => crypto.randomUUID();

export async function book(client: Client, body: Record<string, unknown>) {
  const res = await client.json<MutationResult>("/api/bookings", { method: "POST", json: { clientId: uuid(), allDay: true, ...body } });
  return res;
}

export function okResult(res: { body: MutationResult }): Extract<MutationResult, { ok: true }> {
  if (!res.body.ok) throw new Error(`expected ok, got ${JSON.stringify(res.body)}`);
  return res.body;
}

export function only(res: { body: MutationResult }): BookingDto {
  const b = okResult(res).bookings[0];
  if (!b) throw new Error("no booking in result");
  return b;
}

/** Direct service context for time-dependent tests (injectable "now"). */
export function serviceCtx(actor: Actor, now: Date, queuedOffline = false): ServiceCtx {
  return { db: createDb(env.DB), env, actor, now, queuedOffline, notifier: new Notifier() };
}
