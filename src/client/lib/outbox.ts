import type { MutationResult, SyncResponse } from "@shared/api";
import type { SyncActionInput } from "@shared/schemas";
import { formatRange } from "@shared/time";
import { clear, createStore as createIdbStore, del, set, values } from "idb-keyval";
import { api, ApiError, NetworkError } from "./api";
import { notify } from "./notices";
import type { OutboxEntry } from "./overlay";
import { createStore } from "./store";

/**
 * Offline outbox. Every booking mutation goes through here: it is stored in IndexedDB,
 * shown immediately (see applyOutbox) and sent via POST /api/sync as soon as the app is
 * open and online. Safari has no Background Sync, so the UI shows what is still unsent.
 */
const idb = typeof indexedDB === "undefined" ? undefined : createIdbStore("schluesselbrett-outbox", "entries");

/** Actions per /api/sync call; small so one call stays cheap for D1. */
const SYNC_BATCH = 10;
const MAX_FAILURES = 3;

export const outbox = createStore<OutboxEntry[]>([]);
export const syncing = createStore(false);
/** Last send attempt could not reach the server (navigator.onLine can be true while the server is unreachable). */
export const unreachable = createStore(false);

interface Hooks {
  /** Called after the server answered, to refetch bookings and requests. */
  onSynced: () => void;
  /** Name of the person owning a booking, from cached data (for "Lena wird gefragt"). */
  ownerNameOf: (bookingId: string) => string | undefined;
}
let hooks: Hooks = { onSynced: () => {}, ownerNameOf: () => undefined };

export function configureOutbox(h: Hooks) {
  hooks = h;
}

export async function loadOutbox() {
  if (!idb) return;
  const entries = (await values<OutboxEntry>(idb)).sort((a, b) => a.seq - b.seq);
  outbox.set(entries);
}

export async function enqueue(action: SyncActionInput, label: string) {
  const entry: OutboxEntry = {
    clientId: action.payload.clientId,
    seq: Date.now() * 1000 + (outbox.get().length % 1000),
    action: { ...action, queuedOffline: !navigator.onLine },
    queuedOffline: !navigator.onLine,
    createdAt: new Date().toISOString(),
    label,
  };
  if (idb) await set(entry.clientId, entry, idb);
  outbox.set((list) => [...list, entry]);
  void flush();
}

/** Drops an unsent action (e.g. cancelling a booking that never left the device). */
export async function discard(clientId: string) {
  if (idb) await del(clientId, idb);
  outbox.set((list) => list.filter((e) => e.clientId !== clientId));
}

export async function clearOutbox() {
  if (idb) await clear(idb);
  outbox.set([]);
}

let inFlight: Promise<void> | null = null;
/** No automatic attempt before this time (backoff after server errors). */
let retryAt = 0;

/** Sends queued actions. `force` (the "Senden" button) ignores the backoff. */
export function flush(options: { force?: boolean } = {}): Promise<void> {
  if (inFlight) return inFlight;
  if (outbox.get().length === 0 || !navigator.onLine) return Promise.resolve();
  if (!options.force && Date.now() < retryAt) return Promise.resolve();
  inFlight = send().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function send() {
  syncing.set(true);
  try {
    while (outbox.get().length > 0) {
      const batch = outbox.get().slice(0, SYNC_BATCH);
      let response: SyncResponse;
      try {
        response = await api<SyncResponse>("/api/sync", {
          method: "POST",
          json: { actions: batch.map((e) => ({ ...e.action, queuedOffline: e.queuedOffline })) },
        });
      } catch (err) {
        // The request as a whole failed (network, outage): nothing is attributed to an action.
        if (err instanceof NetworkError) {
          unreachable.set(true);
          await markOffline(batch);
        }
        retryAt = Date.now() + (err instanceof ApiError && err.status >= 500 ? 30_000 : 5_000);
        return;
      }
      unreachable.set(false);
      for (const result of response.results) {
        const entry = batch.find((e) => e.clientId === result.clientId);
        if (!entry) continue;
        if (!result.ok && result.error === "server") {
          // The server stopped at this action; the ones after it were not processed.
          await countFailure(entry);
          retryAt = Date.now() + 15_000 * (entry.failures ?? 1);
          hooks.onSynced();
          return;
        }
        report(entry, result);
        await discard(entry.clientId);
      }
      retryAt = 0;
      hooks.onSynced();
    }
  } finally {
    syncing.set(false);
  }
}

/**
 * The action the server could not store is retried with growing delay, then dropped with a
 * visible message, so a single broken action can never block everything queued after it.
 */
async function countFailure(entry: OutboxEntry) {
  const failures = (entry.failures ?? 0) + 1;
  if (failures >= MAX_FAILURES) {
    await discard(entry.clientId);
    notify({ tone: "error", title: "Nicht gesendet", body: `${entry.label} konnte nach mehreren Versuchen nicht gespeichert werden. Bitte erneut eintragen.` });
    return;
  }
  const updated = { ...entry, failures };
  if (idb) await set(entry.clientId, updated, idb);
  outbox.set((list) => list.map((x) => (x.clientId === entry.clientId ? updated : x)));
}

async function markOffline(batch: OutboxEntry[]) {
  for (const e of batch) {
    if (e.queuedOffline) continue;
    const updated = { ...e, queuedOffline: true, action: { ...e.action, queuedOffline: true } };
    if (idb) await set(e.clientId, updated, idb);
    outbox.set((list) => list.map((x) => (x.clientId === e.clientId ? updated : x)));
  }
}

function report(entry: OutboxEntry, result: MutationResult) {
  const first = result.ok ? result.bookings[0] : undefined;
  const link = first ? { to: `/bookings/${first.id}`, label: "Ansehen" } : undefined;
  if (!result.ok) {
    if (result.error === "stale" && result.server) {
      notify({
        tone: "warning",
        title: "Server-Stand gilt",
        body: "Die Buchung wurde inzwischen geändert. Du kannst sie erneut bearbeiten.",
        diff: { before: entry.label, after: formatRange(result.server, result.server.allDay) },
        link: { to: `/bookings/${result.server.id}`, label: "Erneut bearbeiten" },
      });
    } else {
      notify({ tone: "error", title: "Nicht übernommen", body: `${entry.label}: ${result.message}` });
    }
    return;
  }
  if (result.outcome === "requested") {
    const targets = result.requests.filter((r) => r.status === "open").map((r) => r.targetBookingId);
    const names = [...new Set(targets.map((id) => hooks.ownerNameOf(id) ?? "die andere Person"))];
    notify({
      tone: "warning",
      title: "Wird zur Anfrage",
      body: `${entry.label} überschneidet sich – ${names.join(" und ")} ${names.length > 1 ? "werden" : "wird"} gefragt.`,
      link,
    });
  } else if (result.message) {
    notify({ tone: "info", title: "Hinweis", body: result.message, link });
  } else if (entry.queuedOffline) {
    notify({ tone: "success", title: "Gesendet", body: entry.label });
  }
}

/** Sends whenever the app regains connectivity or comes to the foreground. */
export function startAutoFlush() {
  window.addEventListener("online", () => void flush());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void flush();
  });
  setInterval(() => void flush(), 30_000);
}
