import type { AuditEntryDto } from "@shared/api";
import { formatRange, utcToLocal, formatDay } from "@shared/time";
import { Link } from "react-router";
import { Badge, Card, ErrorBox, Screen, SectionLabel, Spinner } from "../components/ui";
import { errorMessage } from "../lib/api";
import { actionLabel, changeSummary, sourceLabel } from "../lib/audit-labels";
import { usePeople, type People } from "../lib/people";
import { useAudit, useHistory } from "../lib/queries";

const STATUS: Record<string, string> = { requested: "angefragt", cancelled: "storniert", ended_early: "vorzeitig beendet", rejected: "abgelehnt" };

export function HistoryPage() {
  const history = useHistory();
  const people = usePeople();
  if (history.isPending) return <Screen title="Mein Verlauf"><Spinner /></Screen>;
  if (!history.data) return <Screen title="Mein Verlauf"><ErrorBox message={errorMessage(history.error)} /></Screen>;
  const { bookings, audit } = history.data;
  return (
    <Screen title="Mein Verlauf">
      <SectionLabel className="pt-0">Meine Buchungen</SectionLabel>
      <Card>
        {bookings.length === 0 && <p className="p-4 text-[15px] text-muted">Noch keine Buchungen.</p>}
        {bookings.map((b, i) => (
          <Link key={b.id} to={`/bookings/${b.id}`} className={`flex min-h-14 items-center gap-3 px-3.5 py-3 active:bg-fill ${i < bookings.length - 1 ? "border-b border-line" : ""}`}>
            <span className={`flex-1 text-[15px] ${b.status === "cancelled" || b.status === "rejected" ? "text-muted line-through" : ""}`}>
              {formatRange(b, b.allDay)}
              {b.note && <span className="block text-[13px] text-muted no-underline">{b.note}</span>}
            </span>
            {STATUS[b.status] && <Badge tone="muted">{STATUS[b.status]}</Badge>}
          </Link>
        ))}
      </Card>
      <SectionLabel>Änderungen</SectionLabel>
      <AuditList entries={audit} people={people} />
    </Screen>
  );
}

export function AuditPage() {
  const audit = useAudit();
  const people = usePeople();
  if (audit.isPending) return <Screen title="Audit-Log"><Spinner /></Screen>;
  if (!audit.data) return <Screen title="Audit-Log"><ErrorBox message={errorMessage(audit.error)} /></Screen>;
  return (
    <Screen title="Audit-Log">
      <AuditList entries={audit.data} people={people} />
    </Screen>
  );
}

function AuditList({ entries, people }: { entries: AuditEntryDto[]; people: People }) {
  if (entries.length === 0) return <p className="px-1 text-[15px] text-muted">Noch keine Einträge.</p>;
  return (
    <Card>
      {entries.map((a, i) => {
        const at = utcToLocal(a.at);
        const summary = changeSummary(a);
        const body = (
          <>
            <span className="flex items-center justify-between gap-2 text-[15px] font-semibold">
              {actionLabel(a)}
              <span className="text-[12px] font-normal text-muted">
                {formatDay(at.date)} {at.time}
              </span>
            </span>
            <span className="text-[13px] text-muted">
              {people.get(a.actorId).name} · {sourceLabel(a)}
              {summary && ` · ${summary}`}
            </span>
          </>
        );
        const cls = `flex flex-col gap-0.5 px-3.5 py-3 ${i < entries.length - 1 ? "border-b border-line" : ""}`;
        return a.bookingId ? (
          <Link key={a.id} to={`/bookings/${a.bookingId}`} className={`${cls} active:bg-fill`}>
            {body}
          </Link>
        ) : (
          <div key={a.id} className={cls}>
            {body}
          </div>
        );
      })}
    </Card>
  );
}
