import type { RequestDetailDto } from "@shared/api";
import { formatRange, utcToLocal } from "@shared/time";
import { Link } from "react-router";
import { Avatar, Card, ErrorBox, Screen, SectionLabel, Spinner } from "../components/ui";
import { errorMessage } from "../lib/api";
import { usePeople, type People } from "../lib/people";
import { useRequests } from "../lib/queries";

export function RequestsPage() {
  const requests = useRequests();
  const people = usePeople();
  if (requests.isPending) return <Screen title="Anfragen"><Spinner /></Screen>;
  if (!requests.data) return <Screen title="Anfragen"><ErrorBox message={errorMessage(requests.error)} /></Screen>;
  const { incoming, outgoing, others } = requests.data;
  return (
    <Screen title="Anfragen">
      <SectionLabel>An mich</SectionLabel>
      <RequestList items={incoming} people={people} empty="Keine offenen Anfragen an dich." to={(r) => `/requests/${r.id}`} who={(r) => r.booking.ownerId} />
      <SectionLabel>Von mir</SectionLabel>
      <RequestList items={outgoing} people={people} empty="Du hast gerade keine offenen Anfragen." to={(r) => `/bookings/${r.bookingId}`} who={(r) => r.target.ownerId} outgoing />
      {others.length > 0 && (
        <>
          <SectionLabel>Zwischen anderen (Admin)</SectionLabel>
          <RequestList items={others} people={people} empty="" to={(r) => `/requests/${r.id}`} who={(r) => r.booking.ownerId} />
        </>
      )}
    </Screen>
  );
}

function RequestList({
  items,
  people,
  empty,
  to,
  who,
  outgoing,
}: {
  items: RequestDetailDto[];
  people: People;
  empty: string;
  to: (r: RequestDetailDto) => string;
  who: (r: RequestDetailDto) => string;
  outgoing?: boolean;
}) {
  if (items.length === 0) return <p className="px-1 text-[15px] text-muted">{empty}</p>;
  return (
    <Card>
      {items.map((r, i) => {
        const p = people.get(who(r));
        return (
          <Link key={r.id} to={to(r)} className={`flex min-h-16 items-center gap-3 px-3.5 py-3 active:bg-fill ${i < items.length - 1 ? "border-b border-line" : ""}`}>
            <Avatar name={p.name} color={p.color} size={36} />
            <span className="flex min-w-0 flex-col">
              <span className="text-[15px] font-semibold">
                {outgoing ? `Bei ${p.name}` : `${p.name} möchte das Auto`}
                {r.status === "partial" && " · ab " + utcToLocal(r.counterTime!).time + " bestätigt"}
              </span>
              <span className="truncate text-[13px] text-muted">{formatRange(r.booking, r.booking.allDay)}</span>
            </span>
          </Link>
        );
      })}
    </Card>
  );
}
