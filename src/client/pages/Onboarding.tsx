import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Button, Card } from "../components/ui";
import { errorMessage } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { notify } from "../lib/notices";
import { isIos, isStandalone } from "../lib/platform";
import { currentSubscription, enablePush, pushSupported } from "../lib/push";
import { useMe } from "../lib/queries";

const DISMISS_KEY = "onboarding-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function usePasskeys() {
  return useQuery({
    queryKey: ["passkeys"],
    queryFn: async () => {
      const res = await authClient.passkey.listUserPasskeys();
      return res.data ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export async function addPasskey(): Promise<boolean> {
  const res = await authClient.passkey.addPasskey({ name: navigator.userAgent.includes("iPhone") ? "iPhone" : "Gerät" });
  if (res?.error) {
    notify({ tone: "error", title: "Passkey nicht angelegt", body: res.error.message ?? "Abgebrochen" });
    return false;
  }
  notify({ tone: "success", title: "Face ID eingerichtet", body: "Ab jetzt reicht Face ID zum Anmelden." });
  return true;
}

/** After approval: set up a passkey (Face ID) and allow push – each one tap, both skippable. */
export function Onboarding() {
  const me = useMe().data;
  const passkeys = usePasskeys();
  const [hasPush, setHasPush] = useState<boolean | null>(null);
  const [dismissed, setDismissed] = useState(readDismissed);

  useEffect(() => {
    void currentSubscription().then((s) => setHasPush(Boolean(s)));
  }, []);

  if (!me || dismissed) return null;
  const needPasskey = passkeys.isSuccess && passkeys.data.length === 0;
  const canPush = pushSupported() && (!isIos() || isStandalone()) && Boolean(me.vapidPublicKey);
  const needPush = hasPush === false && canPush;
  if (!needPasskey && !needPush) return null;

  return (
    <Card className="mx-4 mt-3 flex flex-col gap-3 p-4">
      <span className="text-[17px] font-semibold">Fast geschafft</span>
      {needPasskey && (
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[14px] text-muted">Mit Face ID anmelden statt jedes Mal über Google.</span>
          <Button variant="dark" size="sm" onClick={() => void addPasskey().then((ok) => { if (ok) void passkeys.refetch(); })}>
            Face ID einrichten
          </Button>
        </div>
      )}
      {needPush && (
        <div className="flex items-center gap-3">
          <span className="flex-1 text-[14px] text-muted">Mitteilungen bei Anfragen und neuen Buchungen.</span>
          <Button
            variant="dark"
            size="sm"
            onClick={() =>
              void enablePush(me.vapidPublicKey!)
                .then(() => setHasPush(true))
                .catch((e) => notify({ tone: "error", title: "Mitteilungen", body: errorMessage(e) || String(e) }))
            }
          >
            Erlauben
          </Button>
        </div>
      )}
      <button
        type="button"
        className="self-start text-[13px] font-semibold text-muted"
        onClick={() => {
          try {
            localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            /* storage unavailable: hide for this session only */
          }
          setDismissed(true);
        }}
      >
        Später
      </button>
    </Card>
  );
}
