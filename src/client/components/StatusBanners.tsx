import { flush, outbox, syncing, unreachable } from "../lib/outbox";
import { isIos, isStandalone, useOnline } from "../lib/platform";
import { useStore } from "../lib/store";
import { applyUpdate, updateAvailable } from "../lib/sw";
import { Button, ClockIcon, Reveal } from "./ui";

/** "1 Buchung noch nicht gesendet" – Safari has no background sync, so make it visible. */
export function OutboxBanner() {
  const entries = useStore(outbox);
  const busy = useStore(syncing);
  const failed = useStore(unreachable);
  const online = useOnline();
  return (
    <Reveal show={entries.length > 0}>
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-badge-bg px-3.5 py-2.5 text-badge-ink" role="status">
        <ClockIcon size={18} />
        <span className="flex-1 text-[14px] font-semibold">
          {entries.length === 1 ? "1 Buchung noch nicht gesendet" : `${entries.length} Buchungen noch nicht gesendet`}
          <span className="block text-[12px] font-normal">{!online
              ? "Wird gesendet, sobald du online bist"
              : busy
                ? "Wird gesendet …"
                : failed
                  ? "Server nicht erreichbar – neuer Versuch alle 30 Sek."
                  : "Wird gleich gesendet"}</span>
        </span>
        {online && !busy && (
          <Button size="sm" variant="outline" onClick={() => void flush({ force: true })}>
            Senden
          </Button>
        )}
      </div>
    </Reveal>
  );
}

/** Prompts to reload when a new app version has been downloaded by the service worker. */
export function UpdateBanner() {
  const needRefresh = useStore(updateAvailable);
  return (
    <Reveal show={needRefresh}>
      <div className="mx-4 mt-3 flex items-center gap-3 rounded-2xl bg-inverse px-3.5 py-2.5 text-on-inverse">
        <span className="flex-1 text-[14px] font-semibold">Neue Version verfügbar</span>
        <Button size="sm" variant="primary" onClick={applyUpdate}>
          Neu laden
        </Button>
      </div>
    </Reveal>
  );
}

/** On iOS the app must run from the Home Screen: storage persists and push works only there. */
export function InstallHint() {
  if (!isIos() || isStandalone()) return null;
  return (
    <div className="mx-4 mt-3 rounded-2xl bg-accent-soft px-3.5 py-3 text-[14px] text-accent-strong">
      <strong className="block">Zum Home-Bildschirm hinzufügen</strong>
      Tippe auf „Teilen“ und dann „Zum Home-Bildschirm“. Melde dich danach in der App an – nur dort funktionieren Mitteilungen und
      Offline-Speicher dauerhaft.
    </div>
  );
}
