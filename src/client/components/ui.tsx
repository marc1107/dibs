import { AnimatePresence, motion, useDragControls } from "motion/react";
import { useEffect, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useLocation } from "react-router";
import { EASE_OUT, FADE, SNAP } from "../lib/motion";
import { parentPath, useGoBack } from "../lib/nav";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** Sub-page layout: sticky translucent header with back button (also reachable by swiping from the left edge). */
export function Screen({ title, children }: { title: string; children: ReactNode }) {
  const goBack = useGoBack();
  const { pathname } = useLocation();
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col gap-2.5 px-4 pb-safe">
      <header className="sticky top-0 z-10 -mx-4 flex items-center gap-1 bg-bg/85 px-3 pb-2 pt-safe backdrop-blur-xl">
        <button
          type="button"
          aria-label="Zurück"
          onClick={() => goBack(parentPath(pathname))}
          className="pressable mt-2 flex size-11 items-center justify-center rounded-full text-accent active:bg-fill"
        >
          <ChevronLeft size={24} />
        </button>
        <h1 className="mt-2 truncate text-[26px] font-bold tracking-[-0.4px]">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("px-1 pt-4 text-[15px] font-semibold text-muted", className)}>{children}</h2>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[20px] bg-card shadow-card", className)}>{children}</div>;
}

type Variant = "primary" | "strong" | "soft" | "danger" | "ok" | "outline";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-on-accent shadow-[0_8px_20px_-10px_var(--color-accent)] active:bg-accent-strong",
  strong: "bg-inverse text-on-inverse active:opacity-85",
  soft: "bg-fill text-ink active:bg-fill-strong",
  danger: "bg-danger-soft text-danger active:brightness-95",
  ok: "bg-ok text-on-ok active:brightness-95",
  outline: "border border-border bg-card text-ink active:bg-fill",
};

export function Button({
  variant = "soft",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg" }) {
  const sizes = { sm: "h-11 rounded-xl px-3 text-[15px]", md: "h-12 rounded-[14px] px-4 text-[16px]", lg: "h-[54px] rounded-2xl px-5 text-[17px]" };
  return (
    <button
      type="button"
      {...props}
      className={cx("pressable inline-flex items-center justify-center gap-2 font-semibold disabled:opacity-40", sizes[size], VARIANTS[variant], className)}
    />
  );
}

/** Segmented control; the selected thumb slides to the new option. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "md",
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const id = useId();
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx("grid gap-1 rounded-xl bg-fill p-1", className)}
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            "relative truncate rounded-[9px] px-2 font-semibold transition-colors",
            size === "sm" ? "h-8 text-[13px]" : "h-10 text-[15px]",
            o.value === value ? "text-ink" : "text-muted",
          )}
        >
          {o.value === value && (
            <motion.span layoutId={`segment-${id}`} layout="position" transition={SNAP} className="absolute inset-0 rounded-[9px] bg-raised shadow-[0_1px_3px_rgb(0_0_0/0.14)]" />
          )}
          <span className="relative">{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Chip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        "pressable h-11 rounded-full border px-4 text-[14px] font-semibold",
        active ? "border-accent bg-accent-soft text-accent-strong" : "border-border bg-card text-ink",
      )}
    >
      {children}
    </button>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        "flex h-[31px] w-[51px] shrink-0 rounded-full p-0.5 transition-colors duration-200 disabled:opacity-50",
        checked ? "justify-end bg-ok" : "justify-start bg-fill-strong",
      )}
    >
      <motion.span layout transition={SNAP} className="block size-[27px] rounded-full bg-white shadow-[0_2px_4px_rgb(0_0_0/0.22)]" />
    </button>
  );
}

export function Avatar({ name, color, size = 40, rounded = "full" }: { name: string; color: string; size?: number; rounded?: "full" | "xl" }) {
  return (
    <span
      aria-hidden="true"
      className={cx("flex shrink-0 items-center justify-center font-rounded font-bold text-white", rounded === "full" ? "rounded-full" : "rounded-xl")}
      style={{ width: size, height: size, background: color, fontSize: size * 0.42 }}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Badge({ children, tone = "warn" }: { children: ReactNode; tone?: "warn" | "muted" | "danger" | "accent" }) {
  const tones = {
    warn: "bg-badge-bg text-badge-ink",
    muted: "bg-fill text-muted",
    danger: "bg-danger-soft text-danger",
    accent: "bg-accent-soft text-accent-strong",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-[12px] font-semibold", tones[tone])}>{children}</span>;
}

/**
 * Bottom sheet: slides up from the bottom and leaves the same way. Closes on backdrop tap, Escape,
 * or by dragging the grabber down.
 */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  const drag = useDragControls();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="sheet" className="fixed inset-0 z-40 flex flex-col justify-end">
          <motion.button
            type="button"
            aria-label="Schließen"
            className="absolute inset-0 bg-scrim"
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={EASE_OUT}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={EASE_OUT}
            drag="y"
            dragControls={drag}
            dragListener={false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.04, bottom: 1 }}
            onDragEnd={(_, info) => {
              if (info.offset.y > 110 || info.velocity.y > 600) onClose();
            }}
            className="relative mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col gap-[18px] overflow-y-auto rounded-t-[26px] bg-card px-5 pb-safe shadow-float"
          >
            <div
              aria-hidden="true"
              onPointerDown={(e) => drag.start(e)}
              className="-mx-5 -mb-2 flex shrink-0 cursor-grab touch-none justify-center pb-3 pt-2.5"
            >
              <span className="h-[5px] w-10 rounded-[3px] bg-border" />
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/** Animates content in and out where it appears (banners, hints); collapses its height on exit. */
export function Reveal({ show, children }: { show: boolean; children: ReactNode }) {
  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={FADE}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function ListRow({ children, to, last }: { children: ReactNode; to?: string; last?: boolean }) {
  const cls = cx("flex min-h-14 items-center gap-3 px-3.5 py-3", !last && "border-b border-line");
  return to ? (
    <Link to={to} className={cx(cls, "transition-colors active:bg-fill")}>
      {children}
      <span className="text-faint">
        <ChevronRight size={18} />
      </span>
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
}

/** The app icon (same artwork as the Home Screen icon). */
export function AppIcon({ size = 84 }: { size?: number }) {
  return <img src="/icons/icon.svg" alt="" width={size} height={size} className="rounded-[22%] shadow-float" />;
}

export function ChevronLeft({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function ChevronRight({ size = 20 }: { size?: number }) {
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function ClockIcon({ size = 14 }: { size?: number }) {
  return (
    <svg aria-label="wird gesendet" role="img" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function WarningIcon() {
  return (
    <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
      <path d="M12 3l10 18H2L12 3z" />
      <path d="M12 10v5M12 18v.5" />
    </svg>
  );
}

export function Spinner() {
  return <div role="status" aria-label="Lädt" className="mx-auto my-10 size-7 animate-spin rounded-full border-[3px] border-border border-t-accent" />;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Card className="p-4 text-[15px] text-danger">
      {message}
    </Card>
  );
}
