import type { BookingDto } from "@shared/api";
import { createStore } from "./store";

export interface Notice {
  id: string;
  tone: "info" | "success" | "warning" | "error";
  title: string;
  body?: string;
  /** For "server state wins" conflicts: what the device wanted vs. what the server has. */
  diff?: { before: string; after: string };
  link?: { to: string; label: string };
  booking?: BookingDto;
}

export const notices = createStore<Notice[]>([]);

export function notify(n: Omit<Notice, "id">) {
  const notice = { ...n, id: crypto.randomUUID() };
  notices.set((list) => [...list, notice]);
  if (n.tone === "success" || n.tone === "info") {
    setTimeout(() => dismiss(notice.id), 5000);
  }
}

export function dismiss(id: string) {
  notices.set((list) => list.filter((n) => n.id !== id));
}
