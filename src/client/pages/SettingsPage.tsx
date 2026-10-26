import type { MeDto } from "@shared/api";
import { NOTIFICATION_DEFAULTS, NOTIFICATION_LABELS, NOTIFICATION_TYPES, START_VIEWS, type NotificationType, type StartView } from "@shared/constants";
import type { PrefsInput } from "@shared/schemas";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, ListRow, Screen, SectionLabel, Segmented, Switch } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { notify } from "../lib/notices";
import { isIos, isStandalone, useOnline } from "../lib/platform";
import { currentSubscription, enablePush, pushSupported } from "../lib/push";
import { keys, useMe } from "../lib/queries";
import { signOut } from "../lib/session";
import { addPasskey, usePasskeys } from "./Onboarding";

const VIEW_LABELS: Record<StartView, string> = { month: "Monat", week: "Woche", list: "Liste" };

export function SettingsPage() {
  const me = useMe().data!;
  const queryClient = useQueryClient();
  const online = useOnline();
  const passkeys = usePasskeys();
  const [name, setName] = useState(me.user.name);
  const [ownOnly, setOwnOnly] = useState(false);
  const [pushOn, setPushOn] = useState<boolean | null>(null);

  useEffect(() => {
    void currentSubscription().then((s) => setPushOn(Boolean(s)));
  }, []);

  const prefs = useMutation({
    mutationFn: (json: PrefsInput) => api<MeDto>("/api/me/prefs", { method: "PUT", json }),
    onSuccess: (data) => queryClient.setQueryData(keys.me, data),
    onError: (e) => notify({ tone: "error", title: "Nicht gespeichert", body: errorMessage(e) }),
  });
  const regenerate = useMutation({
    mutationFn: () => api<{ icalUrl: string }>("/api/me/ical-token", { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.me });
      notify({ tone: "success", title: "Neuer Link erzeugt", body: "Der alte Link funktioniert nicht mehr. Abonniere den neuen." });
    },
  });

  const feed = me.icalUrl ? `${me.icalUrl}${ownOnly ? "?scope=mine" : ""}` : null;
  const pushPossible = pushSupported() && (!isIos() || isStandalone()) && Boolean(me.vapidPublicKey);

  return (
    <Screen title="Einstellungen">
      <SectionLabel className="pt-0">Name</SectionLabel>
      <Card className="flex items-center gap-2 p-2 pl-3.5">
        <input
          aria-label="Anzeigename"
          value={name}
          maxLength={30}
          onChange={(e) => setName(e.target.value)}
          className="h-11 min-w-0 flex-1 bg-transparent text-[16px]"
        />
        <Button size="sm" variant="dark" disabled={!online || !name.trim() || name.trim() === me.user.name} onClick={() => prefs.mutate({ name: name.trim() })}>
          Speichern
        </Button>
      </Card>

      <SectionLabel>Startansicht</SectionLabel>
      <Segmented
        label="Startansicht"
        className="bg-[#E6E8EC]"
        value={me.user.startView}
        onChange={(v) => prefs.mutate({ startView: v })}
        options={START_VIEWS.map((v) => ({ value: v, label: VIEW_LABELS[v] }))}
      />

      <SectionLabel>Mitteilungen</SectionLabel>
      <Card>
        {pushOn === false && (
          <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
            <span className="flex-1 text-[14px] text-muted">
              {pushPossible ? "Auf diesem Gerät sind Mitteilungen noch nicht erlaubt." : "Mitteilungen gehen auf dem iPhone nur in der App vom Home-Bildschirm (iOS 16.4+)."}
            </span>
            {pushPossible && (
              <Button
                size="sm"
                variant="dark"
                onClick={() =>
                  void enablePush(me.vapidPublicKey!)
                    .then(() => setPushOn(true))
                    .catch((e) => notify({ tone: "error", title: "Mitteilungen", body: e instanceof Error ? e.message : String(e) }))
                }
              >
                Erlauben
              </Button>
            )}
          </div>
        )}
        {NOTIFICATION_TYPES.filter((t) => !NOTIFICATION_DEFAULTS[t].adminOnly || me.user.role === "admin").map((t, i, all) => (
          <PrefRow key={t} type={t} me={me} last={i === all.length - 1} disabled={!online} onChange={(v) => prefs.mutate({ notifications: { [t]: v } })} />
        ))}
      </Card>

      <SectionLabel>Kalender-Abo</SectionLabel>
      <Card className="flex flex-col gap-2.5 p-3.5">
        <span className="text-[14px] text-muted">
          Abonniere die Buchungen im iPhone-Kalender. Aktualisiert sich automatisch, aber nicht sekundengenau – für „wer hat's gerade“ ist die App die Quelle.
        </span>
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px]">Nur meine Buchungen</span>
          <Switch label="Nur meine Buchungen" checked={ownOnly} onChange={setOwnOnly} />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <a
            href={feed ?? undefined}
            className="flex h-11 items-center justify-center rounded-xl bg-ink text-[15px] font-semibold text-white"
            aria-disabled={!feed}
          >
            Abonnieren
          </a>
          <Button
            size="sm"
            disabled={!online || regenerate.isPending}
            onClick={() => window.confirm("Neuen Link erzeugen? Der alte Link hört sofort auf zu funktionieren.") && regenerate.mutate()}
          >
            Link neu erzeugen
          </Button>
        </div>
        {feed && (
          <button
            type="button"
            className="self-start text-[13px] font-semibold text-accent"
            onClick={() => void navigator.clipboard?.writeText(feed.replace(/^webcal:/, "https:")).then(() => notify({ tone: "success", title: "Link kopiert" }))}
          >
            Link kopieren
          </button>
        )}
      </Card>

      <SectionLabel>Anmeldung</SectionLabel>
      <Card>
        <ListRow>
          <span className="flex-1 text-[15px]">
            Face ID / Passkeys
            <span className="block text-[13px] text-muted">{passkeys.data?.length ? `${passkeys.data.length} eingerichtet` : "Noch keiner eingerichtet"}</span>
          </span>
          <Button size="sm" disabled={!online} onClick={() => void addPasskey().then(() => passkeys.refetch())}>
            Hinzufügen
          </Button>
        </ListRow>
        <ListRow to="/history">
          <span className="flex-1 text-[15px]">Mein Verlauf</span>
        </ListRow>
        <ListRow last>
          <button type="button" className="h-full w-full text-left text-[15px] font-semibold text-danger" onClick={() => void signOut()}>
            Abmelden
          </button>
        </ListRow>
      </Card>
      {me.user.role === "admin" && (
        <Link to="/admin" className="mt-2 text-center text-[14px] font-semibold text-accent">
          Zur Verwaltung
        </Link>
      )}
    </Screen>
  );
}

function PrefRow({ type, me, last, disabled, onChange }: { type: NotificationType; me: MeDto; last: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  const locked = NOTIFICATION_DEFAULTS[type].locked;
  return (
    <div className={`flex items-center justify-between gap-3 px-3.5 py-3 ${last ? "" : "border-b border-line"}`}>
      <div className="flex flex-col gap-0.5">
        <span className="text-base font-medium">{NOTIFICATION_LABELS[type]}</span>
        {locked && <span className="text-xs text-muted">Immer an, braucht deine Antwort</span>}
      </div>
      <Switch label={NOTIFICATION_LABELS[type]} checked={me.notifications[type]} disabled={locked || disabled} onChange={onChange} />
    </div>
  );
}
