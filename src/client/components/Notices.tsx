import { AnimatePresence, motion } from "motion/react";
import { Link } from "react-router";
import { dismiss, notices } from "../lib/notices";
import { useStore } from "../lib/store";
import { EASE_OUT } from "../lib/motion";
import { cx } from "./ui";

const TONES = {
  info: "bg-inverse text-on-inverse",
  success: "bg-ok text-white",
  warning: "bg-warn-bg text-warn-ink border border-warn-line backdrop-blur-xl",
  error: "bg-danger-soft text-danger border border-danger-line backdrop-blur-xl",
};

/** Toasts for sync results and errors: drop in from the top, swipe up (or ×) to dismiss. */
export function Notices() {
  const list = useStore(notices);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-0 z-50 mx-auto flex max-w-xl flex-col gap-2 px-3 pt-safe" aria-live="polite">
      <AnimatePresence initial={false}>
      {list.map((n) => (
        <motion.div
          key={n.id}
          role="status"
          layout
          initial={{ opacity: 0, y: -24, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -24, scale: 0.96 }}
          transition={EASE_OUT}
          drag="y"
          dragConstraints={{ top: 0, bottom: 0 }}
          dragElastic={{ top: 0.8, bottom: 0.1 }}
          onDragEnd={(_, info) => {
            if (info.offset.y < -30 || info.velocity.y < -300) dismiss(n.id);
          }}
          className={cx("pointer-events-auto flex touch-none flex-col gap-1.5 rounded-2xl p-3.5 shadow-float", TONES[n.tone])}
        >
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
        </motion.div>
      ))}
      </AnimatePresence>
    </div>
  );
}
