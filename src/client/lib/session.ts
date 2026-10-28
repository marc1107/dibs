import { clear } from "idb-keyval";
import { authClient } from "./auth-client";
import { clearOutbox } from "./outbox";
import { queryClient } from "./queries";

/** Signs out and wipes cached data so the next person on this device sees nothing. */
export async function signOut() {
  await authClient.signOut().catch(() => undefined);
  queryClient.clear();
  await clear().catch(() => undefined);
  await clearOutbox().catch(() => undefined);
  window.location.assign("/login");
}
