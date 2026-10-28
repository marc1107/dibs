import { useCallback } from "react";
import { useNavigate } from "react-router";

/** "/admin/audit" → "/admin", "/requests" → "/". Unknown parents end up at "/" via the catch-all route. */
export function parentPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return `/${parts.join("/")}`;
}

/** Marks a navigation as "going back" so it animates like one even when it is not a history pop. */
export const BACK_STATE = { back: true } as const;

/**
 * Back like the system would: pop the history entry when there is one inside the app, otherwise
 * (opened from a notification or a deep link) replace the page with its parent.
 */
export function useGoBack() {
  const navigate = useNavigate();
  return useCallback(
    (fallback: string) => {
      const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
      if (idx > 0) void navigate(-1);
      else void navigate(fallback, { replace: true, state: BACK_STATE });
    },
    [navigate],
  );
}
