import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";

export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(" ");
}

/** Sub-page layout with back button (Verwaltung, Einstellungen, Anfrage …). */
export function Screen({ title, children, back = "/" }: { title: string; children: ReactNode; back?: string }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col gap-2.5 px-4 pb-safe pt-safe">
      <header className="flex items-center gap-2 px-1 pb-2 pt-4">
        <button
          type="button"
          aria-label="Zurück"
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate(back))}
          className="flex size-11 items-center justify-center rounded-full text-ink active:bg-fill"
        >
          <ChevronLeft />
        </button>
        <h1 className="text-[26px] font-bold">{title}</h1>
      </header>
      {children}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx("px-1 pt-3 text-[13px] font-semibold uppercase tracking-[0.4px] text-muted", className)}>{children}</h2>;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-[18px] bg-card shadow-[0_1px_2px_rgba(0,0,0,0.06)]", className)}>{children}</div>;
}

type Variant = "primary" | "dark" | "soft" | "danger" | "ok" | "outline";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white active:bg-accent-strong",
  dark: "bg-ink text-white active:bg-ink-soft",
  soft: "bg-fill text-ink active:bg-border",
  danger: "bg-danger-soft text-danger active:bg-[#f9d6d6]",
  ok: "bg-ok text-white active:brightness-95",
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
      className={cx(
        "inline-flex items-center justify-center gap-2 font-semibold transition disabled:opacity-40",
        sizes[size],
        VARIANTS[variant],
        className,
      )}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
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
            "h-10 truncate rounded-[9px] px-2 text-[15px] font-semibold text-ink transition",
            o.value === value && "bg-card shadow-[0_1px_3px_rgba(0,0,0,0.12)]",
          )}
        >
          {o.label}
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
        "h-11 rounded-full border px-4 text-[14px] font-semibold",
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
        "flex h-[31px] w-[51px] shrink-0 rounded-full p-0.5 transition",
        checked ? "justify-end" : "justify-start",
        checked ? (disabled ? "bg-[#7FB8AF]" : "bg-ok") : "bg-border",
      )}
    >
      <span className="block size-[27px] rounded-full bg-white shadow-[0_1px_3px_rgba(0,0,0,0.2)]" />
    </button>
  );
}

export function Avatar({ name, color, size = 40, rounded = "full" }: { name: string; color: string; size?: number; rounded?: "full" | "xl" }) {
  return (
    <span
      aria-hidden="true"
      className={cx("flex shrink-0 items-center justify-center font-bold text-white", rounded === "full" ? "rounded-full" : "rounded-xl")}
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

/** Bottom sheet with backdrop; closes on backdrop tap and Escape. */
export function Sheet({ open, onClose, children, label }: { open: boolean; onClose: () => void; children: ReactNode; label: string }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex flex-col justify-end">
      <button type="button" aria-label="Schließen" className="absolute inset-0 bg-[#16181D]/45" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col gap-[18px] overflow-y-auto rounded-t-[22px] bg-card px-5 pb-safe pt-2.5"
      >
        <div className="h-[5px] w-10 shrink-0 self-center rounded-[3px] bg-border" />
        {children}
      </div>
    </div>
  );
}

export function ListRow({ children, to, last }: { children: ReactNode; to?: string; last?: boolean }) {
  const cls = cx("flex min-h-14 items-center gap-3 px-3.5 py-3", !last && "border-b border-line");
  return to ? (
    <Link to={to} className={cx(cls, "active:bg-fill")}>
      {children}
    </Link>
  ) : (
    <div className={cls}>{children}</div>
  );
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

export function CarIcon({ size = 48, color = "#FFFFFF" }: { size?: number; color?: string }) {
  return (
    <svg role="img" aria-label="Auto" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 17h14v-4l-2-5H7l-2 5v4z" />
      <path d="M5 13h14" />
      <circle cx="8" cy="17" r="1.6" />
      <circle cx="16" cy="17" r="1.6" />
    </svg>
  );
}

export function Spinner() {
  return <div role="status" aria-label="Lädt" className="mx-auto my-10 size-7 animate-spin rounded-full border-[3px] border-border border-t-accent" />;
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Card className="p-4 text-[15px] text-danger" >
      {message}
    </Card>
  );
}
