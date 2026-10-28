import type { StartView } from "@shared/constants";
import { addDays, formatDay, todayLocal, toInterval, utcToLocal, utcToLocalEnd, type LocalDate } from "@shared/time";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BookingRow, Legend, ListView, MonthNav, monthLabel, MonthView, WeekView, type Selection } from "../components/Calendar";
import { ReserveSheet, type ReserveInitial } from "../components/ReserveSheet";
import { InstallHint, OutboxBanner, UpdateBanner } from "../components/StatusBanners";
import { Avatar, Badge, Button, Card, SectionLabel, Sheet, WarningIcon } from "../components/ui";
import { currentHolder, daySegments, findConflicts, upcoming, weekStart, type ViewBooking } from "../lib/calendar";
import { NetworkError } from "../lib/api";
import { enqueue } from "../lib/outbox";
import { usePeople, type People } from "../lib/people";
import { useNow, useOnline } from "../lib/platform";
import { useMe, useRequests, useViewBookings } from "../lib/queries";
import { Onboarding } from "./Onboarding";

function monthOf(date: LocalDate) {
  return { year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)) };
}

function shiftMonth(year: number, month: number, delta: number) {
  const m = year * 12 + (month - 1) + delta;
  return { year: Math.floor(m / 12), month: (m % 12) + 1 };
}

export function HomePage() {
  const me = useMe().data!;
  const people = usePeople();
  const now = useNow();
  const online = useOnline();
  const today = todayLocal(now);
  const [view, setView] = useState<StartView>(me.user.startView);
  const [cursor, setCursor] = useState(() => monthOf(today));
  const [week, setWeek] = useState(() => weekStart(today));
  const [selection, setSelection] = useState<Selection | null>(null);
  const [rangeMode, setRangeMode] = useState(false);
  const [sheet, setSheet] = useState<ReserveInitial | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  // Week view may straddle two months: load both.
  const visible = view === "week" ? monthOf(week) : cursor;
  const next = view === "week" ? monthOf(addDays(week, 6)) : shiftMonth(cursor.year, cursor.month, 1);
  const current = useViewBookings(visible.year, visible.month, me.user.id);
  const following = useViewBookings(next.year, next.month, me.user.id);
  const thisMonth = useViewBookings(monthOf(today).year, monthOf(today).month, me.user.id);
  const bookings = useMemo(() => dedupe([...current.bookings, ...following.bookings, ...thisMonth.bookings]), [current.bookings, following.bookings, thisMonth.bookings]);
  const requests = useRequests();

  // First tap selects a day, a second tap on another day turns it into a range.
  const onDayTap = (date: LocalDate) => {
    if (selection && !selection.end) {
      if (date === selection.start) {
        setSelection(null);
        return;
      }
      const [a, b] = [selection.start, date].sort();
      setSelection({ start: a!, end: b! });
      setRangeMode(false);
      return;
    }
    setSelection({ start: date, end: null });
  };

  const holder = currentHolder(bookings, now);
  const next5 = upcoming(bookings, now, 4);
  const waiting = requests.data?.incoming.length ?? 0;
  const othersWaiting = requests.data?.others.length ?? 0;
  // Server unreachable counts as offline too (navigator.onLine only knows about the network link).
  const offline = !online || current.error instanceof NetworkError;
  const dataTime = current.dataUpdatedAt ? utcToLocal(new Date(current.dataUpdatedAt).toISOString()).time : null;

  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col pb-[180px]">
      <header className="flex items-center justify-between px-5 pb-3 pt-safe">
        <h1 className="pt-6 text-[30px] font-bold tracking-[-0.5px]">Auto</h1>
        <div className="flex items-center gap-2 pt-6">
          {offline && <Badge>Offline{dataTime ? ` · Stand ${dataTime}` : ""}</Badge>}
          <button type="button" aria-label="Menü" onClick={() => setMenuOpen(true)} className="rounded-full">
            <Avatar name={me.user.name} color={me.user.color} />
          </button>
        </div>
      </header>

      <UpdateBanner />
      <InstallHint />
      <OutboxBanner />
      {waiting > 0 && (
        <Link to="/requests" className="mx-4 mt-3 flex items-center gap-3 rounded-[14px] bg-warn-bg px-3.5 py-3 text-warn-ink">
          <WarningIcon />
          <span className="flex-1 text-[15px] font-semibold">
            {waiting === 1 ? "1 Anfrage wartet auf deine Antwort" : `${waiting} Anfragen warten auf deine Antwort`}
          </span>
        </Link>
      )}
      {me.user.role === "admin" && othersWaiting > 0 && waiting === 0 && (
        <Link to="/requests" className="mx-4 mt-3 rounded-[14px] bg-fill px-3.5 py-3 text-[14px] font-semibold text-ink-soft">
          {othersWaiting} offene Anfrage{othersWaiting > 1 ? "n" : ""} zwischen anderen
        </Link>
      )}
      <Onboarding />

      <NowCard holder={holder} next={next5.find((b) => b.status === "active" && b.startsAt > now.toISOString())} people={people} />

      <Card className="mx-4 mt-4 px-3 pb-3 pt-3.5">
        {view === "week" ? (
          <>
            <MonthNav
              label={`${formatDay(week)} – ${formatDay(addDays(week, 6))}`}
              onPrev={() => setWeek(addDays(week, -7))}
              onNext={() => setWeek(addDays(week, 7))}
            />
            <WeekView start={week} bookings={bookings} people={people} selection={selection} onDayTap={onDayTap} now={now} />
          </>
        ) : (
          <>
            <MonthNav
              label={monthLabel(cursor.year, cursor.month)}
              onPrev={() => setCursor(shiftMonth(cursor.year, cursor.month, -1))}
              onNext={() => setCursor(shiftMonth(cursor.year, cursor.month, 1))}
            />
            {view === "month" ? (
              <MonthView year={cursor.year} month={cursor.month} bookings={current.bookings} people={people} selection={selection} onDayTap={onDayTap} now={now} />
            ) : (
              <ListView bookings={current.bookings} people={people} now={now} />
            )}
          </>
        )}
        {view !== "list" && <Legend people={people} />}
        <div className="flex justify-center gap-1 pt-2">
          {(["month", "week", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={`h-8 rounded-full px-3 text-[12px] font-semibold ${view === v ? "bg-fill text-ink" : "text-muted"}`}
            >
              {{ month: "Monat", week: "Woche", list: "Liste" }[v]}
            </button>
          ))}
        </div>
      </Card>

      {view !== "list" && next5.length > 0 && (
        <>
          <SectionLabel className="px-5 pb-1.5 pt-[18px]">Als Nächstes</SectionLabel>
          <Card className="mx-4">
            {next5.map((b, i) => (
              <BookingRow key={b.id} booking={b} people={people} last={i === next5.length - 1} />
            ))}
          </Card>
        </>
      )}

      <BottomBar
        selection={selection}
        rangeMode={rangeMode}
        bookings={bookings}
        people={people}
        meId={me.user.id}
        today={today}
        onQuick={(date) => {
          setRangeMode(false);
          setSelection({ start: date, end: null });
          const m = monthOf(date);
          setCursor(m);
          setWeek(weekStart(date));
        }}
        onRange={() => {
          setSelection(null);
          setRangeMode(true);
        }}
        onClear={() => {
          setSelection(null);
          setRangeMode(false);
        }}
        onOptions={(initial) => setSheet(initial)}
      />

      <ReserveSheet open={sheet !== null} onClose={() => setSheet(null)} initial={sheet ?? { startDate: today, endDate: today }} bookings={bookings} onDone={() => setSelection(null)} />
      <MenuSheet open={menuOpen} onClose={() => setMenuOpen(false)} isAdmin={me.user.role === "admin"} />
    </div>
  );
}

function dedupe(list: ViewBooking[]) {
  return [...new Map(list.map((b) => [b.id, b])).values()];
}

function NowCard({ holder, next, people }: { holder?: ViewBooking; next?: ViewBooking; people: People }) {
  const p = holder ? people.get(holder.ownerId) : null;
  const until = holder ? utcToLocalEnd(holder.endsAt) : null;
  const sameDay = until && holder && until.date === utcToLocal(new Date().toISOString()).date;
  return (
    <Card className="mx-4 mt-3 flex items-center gap-3.5 p-4">
      {p ? (
        <span className="flex size-11 items-center justify-center rounded-xl text-lg font-bold" style={{ background: p.soft, color: p.color }}>
          {p.name.slice(0, 1)}
        </span>
      ) : (
        <span className="flex size-11 items-center justify-center rounded-xl bg-fill text-lg">✓</span>
      )}
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[13px] text-muted">Jetzt gerade</span>
        {holder && p && until ? (
          <span className="text-[17px] font-semibold">
            {p.name} hat das Auto · bis {sameDay ? until.time : `${formatDay(until.date)}${holder.allDay ? "" : ` ${until.time}`}`}
          </span>
        ) : (
          <span className="text-[17px] font-semibold">
            Das Auto ist frei
            {next && (
              <span className="block text-[13px] font-normal text-muted">
                Als Nächstes: {people.get(next.ownerId).name} ab {formatDay(utcToLocal(next.startsAt).date)}
                {next.allDay ? "" : ` ${utcToLocal(next.startsAt).time}`}
              </span>
            )}
          </span>
        )}
      </div>
    </Card>
  );
}

function BottomBar({
  selection,
  rangeMode,
  bookings,
  people,
  meId,
  today,
  onQuick,
  onRange,
  onClear,
  onOptions,
}: {
  selection: Selection | null;
  rangeMode: boolean;
  bookings: ViewBooking[];
  people: People;
  meId: string;
  today: LocalDate;
  onQuick: (date: LocalDate) => void;
  onRange: () => void;
  onClear: () => void;
  onOptions: (initial: ReserveInitial) => void;
}) {
  const shell = "fixed inset-x-0 bottom-0 z-30 mx-auto flex max-w-xl flex-col gap-2.5 border-t border-[#E6E8EC] bg-card px-4 pb-safe pt-3";

  if (!selection) {
    return (
      <div className={shell}>
        <span className="text-center text-xs text-muted">
          {rangeMode ? "Ersten Tag antippen, dann den letzten" : "Tag antippen · zweiten Tag antippen = Zeitraum"}
        </span>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="dark" onClick={() => onQuick(today)}>
            Heute
          </Button>
          <Button onClick={() => onQuick(addDays(today, 1))}>Morgen</Button>
          <Button variant={rangeMode ? "primary" : "soft"} onClick={rangeMode ? onClear : onRange}>
            {rangeMode ? "Abbrechen" : "Zeitraum…"}
          </Button>
        </div>
      </div>
    );
  }

  const endDate = selection.end ?? selection.start;
  const iv = toInterval({ startDate: selection.start, endDate, allDay: true });
  const conflicts = findConflicts(bookings, meId, [iv]);
  const names = [...new Set(conflicts.map((c) => people.get(c.booking.ownerId).name))];
  const dayBookings = selection.end
    ? []
    : daySegments(bookings, selection.start)
        .filter((s) => !s.freed)
        .map((s) => s.booking);
  const title = selection.end ? `${formatDay(selection.start, selection.start.slice(0, 7) !== endDate.slice(0, 7))} – ${formatDay(endDate)}` : formatDay(selection.start);
  const past = endDate < today;

  const reserve = () => {
    void enqueue({ type: "create", payload: { clientId: crypto.randomUUID(), startDate: selection.start, endDate, allDay: true } }, `${title} · ganzer Tag`);
    onClear();
  };

  return (
    <div className={shell} role="region" aria-label="Auswahl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-[19px] font-bold">{title}</span>
          <span className="text-[13px] text-muted">
            Ganzer Tag{!selection.end && " · weiteren Tag antippen für Zeitraum"}
          </span>
        </div>
        <button type="button" aria-label="Auswahl aufheben" onClick={onClear} className="-mr-2 flex size-11 items-center justify-center rounded-full text-[22px] text-muted">
          ×
        </button>
      </div>
      {dayBookings.length > 0 && (
        <div className="-mx-1 flex flex-col rounded-xl bg-bg">
          {dayBookings.map((b, i) => (
            <BookingRow key={b.id} booking={b} people={people} last={i === dayBookings.length - 1} />
          ))}
        </div>
      )}
      {conflicts.length > 0 && (
        <span className="flex items-center gap-2 text-[13px] font-semibold text-warn-ink">
          <WarningIcon /> Überschneidet sich mit {names.join(" und ")} – wird zur Anfrage
        </span>
      )}
      <div className="grid grid-cols-[1fr_1.4fr] gap-2">
        <Button onClick={() => onOptions({ startDate: selection.start, endDate })}>Uhrzeit …</Button>
        <Button variant="primary" disabled={past} onClick={reserve}>
          {conflicts.length > 0 ? `${names.join(" & ")} fragen` : "Reservieren"}
        </Button>
      </div>
    </div>
  );
}

function MenuSheet({ open, onClose, isAdmin }: { open: boolean; onClose: () => void; isAdmin: boolean }) {
  const items = [
    { to: "/requests", label: "Anfragen" },
    { to: "/history", label: "Mein Verlauf" },
    { to: "/settings", label: "Einstellungen" },
    ...(isAdmin ? [{ to: "/admin", label: "Verwaltung" }] : []),
  ];
  return (
    <Sheet open={open} onClose={onClose} label="Menü">
      <nav className="flex flex-col pb-2">
        {items.map((i) => (
          <Link key={i.to} to={i.to} onClick={onClose} className="flex h-14 items-center border-b border-line px-1 text-[17px] font-semibold last:border-0">
            {i.label}
          </Link>
        ))}
      </nav>
    </Sheet>
  );
}
