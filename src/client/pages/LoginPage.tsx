import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { InstallHint } from "../components/StatusBanners";
import { Button, AppIcon } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { keys } from "../lib/queries";

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback"?: () => void; appearance?: string }) => string;
      reset: (id?: string) => void;
    };
  }
}

const TURNSTILE_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

/** Loads Cloudflare Turnstile and returns the latest token (required for Google sign-in). */
function useTurnstile(container: React.RefObject<HTMLDivElement | null>) {
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    let widget: string | undefined;
    const render = async () => {
      const config = await api<{ turnstileSiteKey: string }>("/api/config").catch(() => null);
      if (!config) return;
      const { turnstileSiteKey } = config;
      if (cancelled || !container.current || !window.turnstile) return;
      widget = window.turnstile.render(container.current, {
        sitekey: turnstileSiteKey,
        appearance: "interaction-only",
        callback: setToken,
        "expired-callback": () => setToken(null),
      });
    };
    if (window.turnstile) void render();
    else {
      const script = document.createElement("script");
      script.src = TURNSTILE_SRC;
      script.async = true;
      script.onload = () => void render();
      document.head.appendChild(script);
    }
    return () => {
      cancelled = true;
      if (widget) window.turnstile?.reset(widget);
    };
  }, [container]);
  return token;
}

export function LoginPage() {
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const [error, setError] = useState<string | null>(params.get("error") ? "Anmeldung fehlgeschlagen oder Zugang entfernt." : null);
  const [busy, setBusy] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const token = useTurnstile(turnstileRef);

  const google = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.social({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/login?error=1",
      fetchOptions: { headers: { "x-captcha-response": token } },
    });
    if (res.error) {
      setError(res.error.message ?? "Anmeldung fehlgeschlagen");
      setBusy(false);
    }
  };

  const passkey = async () => {
    setBusy(true);
    setError(null);
    const res = await authClient.signIn.passkey();
    setBusy(false);
    if (res?.error) setError("Kein Passkey gefunden. Melde dich zuerst mit Google an und richte dann Face ID ein.");
    else await queryClient.invalidateQueries({ queryKey: keys.me });
  };

  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center gap-4 px-6 pb-12 pt-[max(env(safe-area-inset-top),20px)]">
      <div className="mt-24">
        <AppIcon />
      </div>
      <h1 className="mt-2 font-rounded text-[32px] font-extrabold tracking-[-0.5px]">dibs</h1>
      <p className="mb-5 text-center text-base text-muted">Wer hat wann das Auto?</p>
      <div className="flex w-full flex-col gap-3">
        <Button variant="outline" size="lg" disabled={busy || !token} onClick={() => void google()}>
          <span aria-hidden="true" className="font-extrabold text-accent">
            G
          </span>
          {token ? "Mit Google fortfahren" : "Sicherheitsprüfung …"}
        </Button>
        <Button variant="strong" size="lg" disabled={busy} onClick={() => void passkey()}>
          <KeyIcon />
          Mit Passkey (Face ID)
        </Button>
        <div ref={turnstileRef} className="flex justify-center" />
        {error && (
          <p role="alert" className="text-center text-[14px] font-semibold text-danger">
            {error}
          </p>
        )}
        <p className="mt-2 text-center text-[13px] text-muted">Der Passkey wird nach dem ersten Login im iCloud-Schlüsselbund gespeichert.</p>
      </div>
      <div className="w-full">
        <InstallHint />
      </div>
      {import.meta.env.DEV && <DevLogin onError={setError} />}
    </div>
  );
}

/** Only in `vite dev`; the server additionally refuses it outside localhost. */
function DevLogin({ onError }: { onError: (m: string) => void }) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("marc@example.com");
  return (
    <form
      className="mt-6 flex w-full flex-col gap-2 rounded-2xl border border-dashed border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        api("/api/dev/login", { method: "POST", json: { email, name: email.split("@")[0]!.replace(/^./, (c) => c.toUpperCase()) } })
          .then(() => queryClient.invalidateQueries())
          .catch((err) => onError(errorMessage(err)));
      }}
    >
      <span className="text-[12px] font-semibold uppercase text-muted">Dev-Login (nur lokal)</span>
      <input aria-label="E-Mail" value={email} onChange={(e) => setEmail(e.target.value)} className="h-11 rounded-xl border border-border px-3" />
      <Button type="submit" size="sm">
        Anmelden
      </Button>
    </form>
  );
}

function KeyIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="4" />
      <path d="M10.8 10.8L20 20M16 16l2-2M18 18l2-2" />
    </svg>
  );
}
