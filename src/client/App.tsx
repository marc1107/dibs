import { useIsRestoring } from "@tanstack/react-query";
import { AnimatePresence, motion, MotionConfig, useDragControls, useIsPresent } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate, useNavigationType } from "react-router";
import { Notices } from "./components/Notices";
import { AppIcon, Button, Spinner } from "./components/ui";
import { ApiError } from "./lib/api";
import { EASE_OUT, slide } from "./lib/motion";
import { parentPath, useGoBack } from "./lib/nav";
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
  const location = useLocation();
  const navigationType = useNavigationType();
  const unauthenticated = me.error instanceof ApiError && (me.error.status === 401 || me.error.status === 403);

  let content: React.ReactNode;
  if (me.isPending && !me.data) content = <Spinner />;
  else if (!me.data && !unauthenticated) content = <OfflineStart onRetry={() => void me.refetch()} />;
  else if (unauthenticated || !me.data) {
    content = (
      <Routes location={location}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  } else if (me.data.user.status !== "active") content = <PendingPage name={me.data.user.name} />;
  else {
    const admin = me.data.user.role === "admin";
    content = (
      <Routes location={location}>
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
  // Only the signed-in app has a page hierarchy; status screens (loading, pending, offline) share one layer.
  const routed = Boolean(me.data && me.data.user.status === "active") || unauthenticated;
  const back = navigationType === "POP" || (location.state as { back?: boolean } | null)?.back === true;
  const dir = back ? -1 : navigationType === "PUSH" ? 1 : 0;

  return (
    <MotionConfig reducedMotion="user">
      <Notices />
      <AnimatePresence initial={false} custom={dir}>
        <PageLayer key={routed ? location.pathname : "status"} dir={dir} swipeBack={routed && location.pathname !== "/" && !unauthenticated}>
          {content}
        </PageLayer>
      </AnimatePresence>
    </MotionConfig>
  );
}

/** The page on top covers the one below: forward pushes put the new page on top, going back keeps the old one on top. */
const pageVariants = {
  enter: (dir: number) => ({ ...slide.enter(dir), zIndex: dir < 0 ? 1 : 2 }),
  center: slide.center,
  exit: (dir: number) => ({ ...slide.exit(dir), zIndex: dir < 0 ? 2 : 1 }),
};

/**
 * One full-screen, independently scrolling page. Sub-pages can be dragged away from the left edge
 * to go back, the same direction the back transition uses.
 */
function PageLayer({ dir, swipeBack, children }: { dir: number; swipeBack: boolean; children: ReactNode }) {
  const drag = useDragControls();
  const goBack = useGoBack();
  const { pathname } = useLocation();
  // The page that is animating away must not take taps or show up for assistive tech.
  const leaving = !useIsPresent();
  return (
    <motion.div
      inert={leaving}
      aria-hidden={leaving || undefined}
      custom={dir}
      variants={pageVariants}
      initial="enter"
      animate="center"
      exit="exit"
      transition={EASE_OUT}
      drag={swipeBack ? "x" : false}
      dragControls={drag}
      dragListener={false}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0, right: 1 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > window.innerWidth * 0.3 || info.velocity.x > 500) goBack(parentPath(pathname));
      }}
      className="fixed inset-0 overflow-y-auto overscroll-contain bg-bg shadow-[-10px_0_30px_rgb(0_0_0/0.12)]"
    >
      {children}
      {swipeBack && (
        <div aria-hidden="true" onPointerDown={(e) => drag.start(e)} className="fixed inset-y-0 left-0 z-20 w-4 touch-none" />
      )}
    </motion.div>
  );
}

/** First start without network and without cached data: nothing to show yet. */
function OfflineStart({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <AppIcon />
      <h1 className="text-2xl font-bold">Keine Verbindung</h1>
      <p className="text-[15px] text-muted">Sobald du online bist, lädt der Kalender. Danach ist er auch offline verfügbar.</p>
      <Button variant="strong" onClick={onRetry}>
        Erneut versuchen
      </Button>
    </div>
  );
}
