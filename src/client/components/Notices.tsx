import { Link } from "react-router";
import { dismiss, notices } from "../lib/notices";
import { useStore } from "../lib/store";
import { cx } from "./ui";

const TONES = {
  info: "bg-ink text-white",
  success: "bg-ok text-white",
  warning: "bg-warn-bg text-warn-ink border border-[#f3d3a8]",
  error: "bg-danger-soft text-danger border border-[#f4c7c3]",
};

/** Toasts for sync results and errors (top of the screen, below the status bar). */
export function Notices() {
  const list = useStore(notices);
  if (list.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex max-w-xl flex-col gap-2 px-3 pt-safe" aria-live="polite">
      {list.map((n) => (
        <div key={n.id} role="status" className={cx("pointer-events-auto flex flex-col gap-1.5 rounded-2xl p-3.5 shadow-lg", TONES[n.tone])}>
          <div className="flex items-start justify-between gap-3">
            <span className="text-[15px] font-semibold">{n.title}</span>
            <button type="button" aria-label="Hinweis schließen" onClick={() => dismiss(n.id)} className="-m-2 p-2 text-[18px] leading-none opacity-70">
              ×
            </button>
          </div>
          {n.body && <span className="text-[14px]">{n.body}</span>}
          {n.diff && (
            <span className="grid grid-cols-[auto_1fr] gap-x-2 text-[13px]">
              <span className="opacity-70">Vorher (dein Gerät):</span>
              <span className="line-through">{n.diff.before}</span>
              <span className="opacity-70">Jetzt (Server):</span>
              <span className="font-semibold">{n.diff.after}</span>
            </span>
          )}
          {n.link && (
            <Link to={n.link.to} onClick={() => dismiss(n.id)} className="self-start text-[14px] font-semibold underline">
              {n.link.label}
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
