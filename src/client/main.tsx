import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { del, get, set } from "idb-keyval";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./App";
import "./index.css";
import { configureOutbox, flush, loadOutbox, startAutoFlush } from "./lib/outbox";
import { CACHE_TIME, cachedOwnerName, invalidateData, queryClient } from "./lib/queries";
import { startServiceWorker } from "./lib/sw";

// Last loaded data lives in IndexedDB so the app opens offline ("Offline · Stand 07:42").
const persister = createAsyncStoragePersister({
  storage: { getItem: (k) => get(k), setItem: (k, v) => set(k, v), removeItem: (k) => del(k) },
  key: "dibs-cache",
});

configureOutbox({ onSynced: invalidateData, ownerNameOf: cachedOwnerName });
void loadOutbox().then(() => flush());
startAutoFlush();
startServiceWorker();

// Ask the browser to keep our storage (iOS keeps it anyway for Home Screen apps).
void navigator.storage?.persist?.();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PersistQueryClientProvider client={queryClient} persistOptions={{
        persister,
        maxAge: CACHE_TIME,
        buster: "v1",
        // Keep last good data even if the latest refetch failed (offline).
        dehydrateOptions: { shouldDehydrateQuery: (q) => q.state.data !== undefined },
      }}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </PersistQueryClientProvider>
  </StrictMode>,
);
