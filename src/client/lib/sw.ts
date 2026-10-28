import { registerSW } from "virtual:pwa-register";
import { createStore } from "./store";

/** True when a new app version is installed and waiting; the UI offers "Neu laden". */
export const updateAvailable = createStore(false);

let applyUpdateFn: ((reload?: boolean) => Promise<void>) | undefined;

/** Registers the service worker right at app start so the shell is cached even before login. */
export function startServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  applyUpdateFn = registerSW({ immediate: true, onNeedRefresh: () => updateAvailable.set(true) });
}

export function applyUpdate() {
  void applyUpdateFn?.(true);
}
