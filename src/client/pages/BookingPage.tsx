import type { BookingDto, RequestDetailDto } from "@shared/api";
import type { Scope } from "@shared/schemas";
import { formatRange, utcToLocal } from "@shared/time";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { initialFromBooking, ReserveSheet } from "../components/ReserveSheet";
import { Avatar, Badge, Button, Card, ErrorBox, ListRow, Screen, SectionLabel, Sheet, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { notify } from "../lib/notices";
import { enqueue } from "../lib/outbox";
import { usePeople, type People } from "../lib/people";
import { useNow, useOnline } from "../lib/platform";
import { invalidateData, useBookingDetail, useMe, useViewBookings } from "../lib/queries";

const STATUS_LABEL: Record<BookingDto["status"], { label: string; tone: "warn" | "muted" | "danger" | "accent" } | null> = {
  active: null,
  requested: { label: "angefragt", tone: "warn" },
  cancelled: { label: "storniert", tone: "muted" },
  ended_early: { label: "vorzeitig beendet", tone: "muted" },
  rejected: { label: "abgelehnt", tone: "danger" },
};

const REQUEST_STATUS: Record<RequestDetailDto["status"], string> = {
  open: "offen",
  granted: "zugestimmt",
  partial: "mit späterem Start zugestimmt",
  declined: "abgelehnt",
  withdrawn: "zurückgezogen",
};

type Action = { kind: "edit" | "cancel"; scope: Scope } | null;

export function BookingPage() {
  const { id = "" } = useParams();
  const me = useMe().data!;
  const people = usePeople();
  const now = useNow();
  const online = useOnline();
  const detail = useBookingDetail(id);
  const b = detail.data?.booking;
  const start = b ? utcToLocal(b.startsAt).date : "2000-01-01";
  const month = useViewBookings(Number(start.slice(0, 4)), Number(start.slice(5, 7)), me.user.id);
  const [askScope, setAskScope] = useState<"edit" | "cancel" | null>(null);
  const [action, setAction] = useState<Action>(null);

  const withdraw = useMutation({
    mutationFn: (requestId: string) => api(`/api/requests/${requestId}/withdraw`, { method: "POST" }),
    onSuccess: () => {
      invalidateData();
      notify({ tone: "success", title: "Anfrage zurückgezogen" });
    },
    onError: (e) => notify({ tone: "error", title: "Nicht möglich", body: errorMessage(e) }),
  });

  if (detail.isPending) return <Screen title="Buchung"><Spinner /></Screen>;
  if (!b || !detail.data) return <Screen title="Buchung"><ErrorBox message={errorMessage(detail.error)} /></Screen>;
  const { incoming, outgoing } = detail.data;

  const owner = people.get(b.ownerId);
  const nowIso = now.toISOString();
  const mayManage = me.user.role === "admin" || b.ownerId === me.user.id;
  const live = b.status === "active" || b.status === "requested";
  const running = b.status === "active" && b.startsAt <= nowIso && b.endsAt > nowIso;
  const future = live && b.startsAt > nowIso;
  const shortenedFor = incoming.filter((r) => r.status === "granted" || r.status === "partial").map((r) => people.get(r.booking.ownerId).name);
  const changed = b.startsAt !== b.originalStartsAt || b.endsAt !== b.originalEndsAt;
  const status = STATUS_LABEL[b.status];

  const chooseScope = (kind: "edit" | "cancel") => (b.seriesId ? setAskScope(kind) : run(kind, "this"));
  const run = (kind: "edit" | "cancel", scope: Scope) => {
    setAskScope(null);
    if (kind === "edit") return setAction({ kind, scope });
    const label = `${formatRange(b, b.allDay)} stornieren`;
    void enqueue({ type: "cancel", bookingId: b.id, payload: { clientId: crypto.randomUUID(), scope, baseUpdatedAt: b.updatedAt } }, label).then(() =>
      detail.refetch(),
    );
  };
  const endNow = () =>
    void enqueue({ type: "endNow", bookingId: b.id, payload: { clientId: crypto.randomUUID() } }, `${formatRange(b, b.allDay)} zurückgeben`).then(() =>
      detail.refetch(),
    );

  return (
    <Screen title="Buchung">
      <Card className="flex flex-col gap-3.5 p-[18px]">
        <div className="flex items-center gap-3">
          <Avatar name={owner.name} color={owner.color} size={44} />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[17px] font-semibold">{owner.name}</span>
            <span className={b.status === "cancelled" ? "text-[15px] text-muted line-through" : "text-[15px] text-ink-soft"}>{formatRange(b, b.allDay)}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {status && <Badge tone={status.tone}>{status.label}</Badge>}
          {b.status === "ended_early" && <Badge tone="muted">frei ab {utcToLocal(b.endsAt).time}</Badge>}
          {shortenedFor.length > 0 && <Badge tone="accent">gekürzt für {[...new Set(shortenedFor)].join(", ")}</Badge>}
          {b.seriesId && <Badge tone="muted">Serientermin</Badge>}
          {running && <Badge tone="accent">läuft gerade</Badge>}
        </div>
        {b.note && <p className="rounded-xl bg-bg p-3 text-[15px]">{b.note}</p>}
        {changed && (
          <p className="text-[13px] text-muted">Ursprünglich: {formatRange({ startsAt: b.originalStartsAt, endsAt: b.originalEndsAt }, b.allDay)}</p>
        )}
        {b.createdBy !== b.ownerId && <p className="text-[13px] text-muted">Eingetragen von {people.get(b.createdBy).name}</p>}
      </Card>

      {outgoing.length > 0 && (
        <>
          <SectionLabel>Anfragen dieser Buchung</SectionLabel>
          <Card>
            {outgoing.map((r, i, all) => (
              <RequestLine key={r.id} r={r} people={people} last={i === all.length - 1} who={people.get(r.target.ownerId).name}>
                {(r.status === "open" || r.status === "partial") && mayManage && b.endsAt > nowIso && (
                  <Button size="sm" variant="danger" disabled={!online || withdraw.isPending} onClick={() => withdraw.mutate(r.id)}>
                    Zurückziehen
                  </Button>
                )}
              </RequestLine>
            ))}
          </Card>
        </>
      )}

      {incoming.length > 0 && (
        <>
          <SectionLabel>Anfragen an diese Buchung</SectionLabel>
          <Card>
            {incoming.map((r, i, all) => (
              <RequestLine key={r.id} r={r} people={people} last={i === all.length - 1} who={people.get(r.booking.ownerId).name} to={r.status === "open" ? `/requests/${r.id}` : undefined} />
            ))}
          </Card>
        </>
      )}

      {mayManage && live && (
        <div className="mt-2 flex flex-col gap-2.5">
          {running && (
            <Button variant="ok" size="lg" onClick={endNow}>
              Jetzt zurückgeben
            </Button>
          )}
          {b.endsAt > nowIso && (
            <Button variant="soft" size="md" onClick={() => chooseScope("edit")}>
              Bearbeiten
            </Button>
          )}
          {future && (
            <Button variant="danger" size="md" onClick={() => chooseScope("cancel")}>
              Stornieren
            </Button>
          )}
          {!online && <p className="text-center text-[13px] text-muted">Offline: Änderungen werden gesendet, sobald du wieder online bist.</p>}
        </div>
      )}

      <Sheet open={askScope !== null} onClose={() => setAskScope(null)} label="Serientermin">
        <h2 className="text-xl font-bold">{askScope === "cancel" ? "Serientermin stornieren" : "Serientermin bearbeiten"}</h2>
        <div className="flex flex-col gap-2.5 pb-2">
          <Button variant="dark" size="lg" onClick={() => run(askScope!, "this")}>
            Nur dieser Termin
          </Button>
          <Button variant="soft" size="lg" onClick={() => run(askScope!, "following")}>
            Dieser und alle folgenden
          </Button>
        </div>
      </Sheet>

      <ReserveSheet
        open={action?.kind === "edit"}
        onClose={() => setAction(null)}
        initial={initialFromBooking(b)}
        editing={action ? { booking: b, scope: action.scope } : undefined}
        bookings={month.bookings}
        onDone={() => void detail.refetch()}
      />
    </Screen>
  );
}

function RequestLine({
  r,
  people,
  last,
  who,
  to,
  children,
}: {
  r: RequestDetailDto;
  people: People;
  last: boolean;
  who: string;
  to?: string;
  children?: React.ReactNode;
}) {
  const body = (
    <>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-[15px] font-semibold">
          {who} · {REQUEST_STATUS[r.status]}
        </span>
        <span className="text-[13px] text-muted">
          {formatRange(r.booking, r.booking.allDay)}
          {r.counterTime && ` · ab ${utcToLocal(r.counterTime).time}`}
          {r.decidedBy && r.decidedBy !== r.target.ownerId && ` · entschieden von ${people.get(r.decidedBy).name}`}
        </span>
      </div>
      {children}
    </>
  );
  return to ? (
    <Link to={to} className={`flex min-h-14 items-center gap-3 px-3.5 py-3 active:bg-fill ${last ? "" : "border-b border-line"}`}>
      {body}
      <span className="text-[13px] font-semibold text-accent">Antworten</span>
    </Link>
  ) : (
    <ListRow last={last}>{body}</ListRow>
  );
}
