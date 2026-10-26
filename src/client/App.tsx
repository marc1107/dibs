import { useIsRestoring } from "@tanstack/react-query";
import { useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router";
import { Notices } from "./components/Notices";
import { Button, CarIcon, Spinner } from "./components/ui";
import { ApiError } from "./lib/api";
import { invalidateData, useMe } from "./lib/queries";
import { AdminPage } from "./pages/AdminPage";
import { BookingPage } from "./pages/BookingPage";
import { AuditPage, HistoryPage } from "./pages/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { PendingPage } from "./pages/PendingPage";
import { RequestPage } from "./pages/RequestPage";
import { RequestsPage } from "./pages/RequestsPage";
import { SettingsPage } from "./pages/SettingsPage";

/** Messages from the service worker: refresh on incoming push, open the target screen on tap. */
function useNotificationNavigation() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "refresh") invalidateData();
      if (e.data?.type === "navigate" && typeof e.data.url === "string" && e.data.url.startsWith("/")) navigate(e.data.url);
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [navigate]);
}

export function App() {
  // Queries must not start before the IndexedDB cache is restored, or offline starts lose it.
  return useIsRestoring() ? <Spinner /> : <RestoredApp />;
}

function RestoredApp() {
  useNotificationNavigation();
  const me = useMe();
  const unauthenticated = me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403);

  let content: React.ReactNode;
  if (me.isPending && !me.data) content = <Spinner />;
  else if (!me.data && !unauthenticated) content = <OfflineStart onRetry={() => void me.refetch()} />;
  else if (unauthenticated || !me.data) {
    content = (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  } else if (me.data.user.status !== "active") content = <PendingPage name={me.data.user.name} />;
  else {
    const admin = me.data.user.role === "admin";
    content = (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/bookings/:id" element={<BookingPage />} />
        <Route path="/requests" element={<RequestsPage />} />
        <Route path="/requests/:id" element={<RequestPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        {admin && <Route path="/admin" element={<AdminPage />} />}
        {admin && <Route path="/admin/audit" element={<AuditPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }
  return (
    <>
      <Notices />
      {content}
    </>
  );
}

/** First start without network and without cached data: nothing to show yet. */
function OfflineStart({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div className="flex size-[84px] items-center justify-center rounded-[22px] bg-ink">
        <CarIcon />
      </div>
      <h1 className="text-2xl font-bold">Keine Verbindung</h1>
      <p className="text-[15px] text-muted">Sobald du online bist, lädt der Kalender. Danach ist er auch offline verfügbar.</p>
      <Button variant="dark" onClick={onRetry}>
        Erneut versuchen
      </Button>
    </div>
  );
}
