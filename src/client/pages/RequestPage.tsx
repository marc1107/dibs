import type { RequestDetailDto } from "@shared/api";
import type { RespondInput } from "@shared/schemas";
import { defaultCounterTime } from "@shared/resolution";
import { addMinutes, formatDay, formatDuration, formatRange, overlapMinutes, utcToLocal, utcToLocalEnd } from "@shared/time";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { Avatar, Button, Card, ErrorBox, Screen, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { notify } from "../lib/notices";
import { usePeople } from "../lib/people";
import { useOnline } from "../lib/platform";
import { invalidateData, useMe, useRequest } from "../lib/queries";

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 60) return `vor ${min} Min.`;
  if (min < 60 * 24) return `vor ${Math.round(min / 60)} Std.`;
  return `vor ${Math.round(min / 1440)} Tagen`;
}

/** The three one-tap answers: Klar nimm's / Brauch's bis X / Nein. */
export function RequestPage() {
  const { id = "" } = useParams();
  const request = useRequest(id);
  if (request.isPending) return <Screen title="Anfrage"><Spinner /></Screen>;
  if (!request.data) return <Screen title="Anfrage"><ErrorBox message={errorMessage(request.error)} /></Screen>;
  return <Answer key={request.data.id + request.data.status} r={request.data} />;
}

function Answer({ r }: { r: RequestDetailDto }) {
  const me = useMe().data!;
  const people = usePeople();
  const online = useOnline();
  const navigate = useNavigate();
  const [counter, setCounter] = useState(() => defaultCounterTime(r.target, r.booking));
  const requester = people.get(r.booking.ownerId);
  const owner = people.get(r.target.ownerId);
  const mine = r.target.ownerId === me.user.id;
  const from = utcToLocal(r.booking.startsAt).time;
  const counterLocal = utcToLocal(counter);
  const counterLabel =
    counterLocal.date === utcToLocal(r.booking.startsAt).date ? counterLocal.time : `${formatDay(counterLocal.date)} ${counterLocal.time}`;
  const minCounter = addMinutes(r.booking.startsAt, 15);
  const maxCounter = addMinutes(r.booking.endsAt, -15);

  const respond = useMutation({
    mutationFn: (json: RespondInput) => api<RequestDetailDto>(`/api/requests/${r.id}/respond`, { method: "POST", json }),
    onSuccess: () => {
      invalidateData();
      notify({ tone: "success", title: "Antwort gesendet" });
      navigate("/");
    },
    onError: (e) => notify({ tone: "error", title: "Nicht möglich", body: errorMessage(e) }),
  });

  if (r.status !== "open") {
    return (
      <Screen title="Anfrage">
        <Card className="p-4 text-[15px]">Diese Anfrage wurde bereits beantwortet oder zurückgezogen.</Card>
      </Screen>
    );
  }

  const busy = respond.isPending || !online;
  return (
    <Screen title="Anfrage">
      <Card className="flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-center gap-3">
          <Avatar name={requester.name} color={requester.color} size={44} />
          <div className="flex flex-col gap-0.5">
            <span className="text-[17px] font-semibold">
              {requester.name} möchte das Auto{r.booking.allDay ? "" : ` ab ${from}`}
            </span>
            <span className="text-[14px] text-muted">
              {formatRange(r.booking, r.booking.allDay)} · {ago(r.createdAt)}
            </span>
          </div>
        </div>
        <div className="rounded-xl bg-bg p-3 text-[14px] text-ink-soft">
          {mine ? "Du hast" : `${owner.name} hat`} es bis <strong>{utcToLocalEnd(r.target.endsAt).time}</strong>
          {r.target.allDay ? ` (${formatRange(r.target, true)})` : ""}. Überschneidung: {formatDuration(overlapMinutes(r.target, r.booking))}
        </div>
        {r.booking.note && <div className="text-[14px] text-muted">Notiz: {r.booking.note}</div>}
      </Card>

      <div className="flex flex-col gap-2.5">
        <Button variant="ok" size="lg" className="h-14" disabled={busy} onClick={() => respond.mutate({ action: "grant" })}>
          Klar, nimm's{r.booking.allDay ? "" : ` ab ${from}`}
        </Button>

        <div className="flex flex-col gap-3 rounded-2xl border-2 border-accent bg-card p-3.5">
          <span className="text-base font-semibold">Brauch's noch, danach gern</span>
          <div className="flex items-center justify-between gap-2">
            <Button aria-label="15 Minuten früher" className="w-[52px]" disabled={counter <= minCounter} onClick={() => setCounter(addMinutes(counter, -15))}>
              −15
            </Button>
            <div className="flex flex-col items-center">
              <span className="text-[13px] text-muted">{requester.name} bekommt es ab</span>
              <span className={`font-bold text-accent-strong ${counterLabel.length > 5 ? "text-[20px]" : "text-[28px]"}`}>{counterLabel}</span>
            </div>
            <Button aria-label="15 Minuten später" className="w-[52px]" disabled={counter >= maxCounter} onClick={() => setCounter(addMinutes(counter, 15))}>
              +15
            </Button>
          </div>
          <Button variant="primary" disabled={busy} onClick={() => respond.mutate({ action: "counter", counterTime: counter })}>
            Ab {counterLabel} freigeben
          </Button>
        </div>

        <Button variant="soft" className="text-danger" disabled={busy} onClick={() => respond.mutate({ action: "decline" })}>
          Nein, brauche es
        </Button>
      </div>
      <p className="px-3 text-center text-[13px] text-muted">
        {online ? "Die Anfrage bleibt offen, bis du antwortest." : "Offline – Antworten geht nur mit Verbindung."}
        {mine ? " Der Admin kann auch entscheiden." : ` Du entscheidest als Admin für ${owner.name}.`}
      </p>
    </Screen>
  );
}
