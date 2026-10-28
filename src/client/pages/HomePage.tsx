import type { StartView } from "@shared/constants";
import { addDays, formatDay, todayLocal, toInterval, utcToLocal, utcToLocalEnd, type LocalDate } from "@shared/time";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { BookingRow, Legend, ListView, MonthNav, monthLabel, MonthView, SwipePager, WeekView, type Selection } from "../components/Calendar";
import { ReserveSheet, type ReserveInitial } from "../components/ReserveSheet";
import { InstallHint, OutboxBanner, UpdateBanner } from "../components/StatusBanners";
import { AnimatePresence, motion } from "motion/react";
import { Avatar, Badge, Button, Card, ChevronRight, Reveal, SectionLabel, Segmented, Sheet, WarningIcon } from "../components/ui";
import { FADE } from "../lib/motion";
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
  // Paging direction for the calendar slide: 1 = later, -1 = earlier.
  const [pageDir, setPageDir] = useState(0);

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

  const page = (delta: number) => {
    setPageDir(delta);
    if (view === "week") setWeek(addDays(week, 7 * delta));
    else setCursor(shiftMonth(cursor.year, cursor.month, delta));
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col">
      <header className="flex items-center justify-between px-5 pb-1 pt-safe">
        <h1 className="pt-4 font-rounded text-[34px] font-extrabold tracking-[-0.8px]">dibs</h1>
        <div className="flex items-center gap-2 pt-4">
          {offline && <Badge>Offline{dataTime ? ` · Stand ${dataTime}` : ""}</Badge>}
          <button type="button" aria-label="Menü" onClick={() => setMenuOpen(true)} className="pressable rounded-full">
            <Avatar name={me.user.name} color={me.user.color} />
          </button>
        </div>
      </header>

      <UpdateBanner />
      <InstallHint />
      <OutboxBanner />
      <Reveal show={waiting > 0}>
        <Link to="/requests" className="pressable mx-4 mt-3 flex items-center gap-3 rounded-2xl border border-warn-line bg-warn-bg px-3.5 py-3 text-warn-ink">
          <WarningIcon />
          <span className="flex-1 text-[15px] font-semibold">
            {waiting === 1 ? "1 Anfrage wartet auf deine Antwort" : `${waiting} Anfragen warten auf deine Antwort`}
          </span>
          <ChevronRight size={18} />
        </Link>
      </Reveal>
      <Reveal show={me.user.role === "admin" && othersWaiting > 0 && waiting === 0}>
        <Link to="/requests" className="pressable mx-4 mt-3 flex items-center rounded-2xl bg-fill px-3.5 py-3 text-[14px] font-semibold text-ink-soft">
          <span className="flex-1">
            {othersWaiting} offene Anfrage{othersWaiting > 1 ? "n" : ""} zwischen anderen
          </span>
          <ChevronRight size={18} />
        </Link>
      </Reveal>
      <Onboarding />

      <NowCard holder={holder} next={next5.find((b) => b.status === "active" && b.startsAt > now.toISOString())} people={people} />

      <Card className="mx-4 mt-4 px-3 pb-3 pt-3">
        <Segmented
          label="Ansicht"
          size="sm"
          className="mb-3"
          value={view}
          onChange={(v) => {
            setPageDir(0);
            setView(v);
          }}
          options={[
            { value: "month", label: "Monat" },
            { value: "week", label: "Woche" },
            { value: "list", label: "Liste" },
          ]}
        />
        <MonthNav
          label={view === "week" ? `${formatDay(week)} – ${formatDay(addDays(week, 6))}` : monthLabel(cursor.year, cursor.month)}
          onPrev={() => page(-1)}
          onNext={() => page(1)}
        />
        <SwipePager
          pageKey={view === "week" ? `w${week}` : `${view}${cursor.year}-${cursor.month}`}
          dir={pageDir}
          onPrev={() => page(-1)}
          onNext={() => page(1)}
        >
          {view === "week" ? (
            <WeekView start={week} bookings={bookings} people={people} selection={selection} onDayTap={onDayTap} now={now} />
          ) : view === "month" ? (
            <MonthView year={cursor.year} month={cursor.month} bookings={current.bookings} people={people} selection={selection} onDayTap={onDayTap} now={now} />
          ) : (
            <ListView bookings={current.bookings} people={people} now={now} />
          )}
        </SwipePager>
        {view !== "list" && <Legend people={people} />}
      </Card>

      {view !== "list" && next5.length > 0 && (
        <>
          <SectionLabel className="px-5 pb-1.5">Als Nächstes</SectionLabel>
          <Card className="mx-4">
            {next5.map((b, i) => (
              <BookingRow key={b.id} booking={b} people={people} last={i === next5.length - 1} />
            ))}
          </Card>
        </>
      )}
      <div className="h-6" />

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
          setPageDir(Math.sign(m.year * 12 + m.month - (cursor.year * 12 + cursor.month)));
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

/** The one loud element on the page: who has the car right now, in their colour. */
function NowCard({ holder, next, people }: { holder?: ViewBooking; next?: ViewBooking; people: People }) {
  const p = holder ? people.get(holder.ownerId) : null;
  const until = holder ? utcToLocalEnd(holder.endsAt) : null;
  const sameDay = until && holder && until.date === utcToLocal(new Date().toISOString()).date;
  if (holder && p && until) {
    const className = "relative mx-4 mt-3 flex items-center gap-4 overflow-hidden rounded-[24px] p-5 text-white shadow-float";
    const style = { background: `linear-gradient(140deg, ${p.color}, color-mix(in oklab, ${p.color} 72%, #000))` };
    const content = (
      <>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-[14px] font-medium opacity-80">Jetzt gerade</span>
          <span className="font-rounded text-[26px] leading-tight font-bold tracking-[-0.4px]">{p.name} hat das Auto</span>
          <span className="mt-1 self-start rounded-full bg-white/20 px-3 py-1 text-[14px] font-semibold">
            bis {sameDay ? until.time : `${formatDay(until.date)}${holder.allDay ? "" : ` ${until.time}`}`}
          </span>
        </span>
        <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-white/18 font-rounded text-[26px] font-bold">
          {p.name.slice(0, 1)}
        </span>
      </>
    );
    // A booking still in the outbox has no detail page yet (same rule as BookingRow).
    return holder.pending ? (
      <div className={className} style={style}>
        {content}
      </div>
    ) : (
      <Link to={`/bookings/${holder.id}`} className={`pressable ${className}`} style={style}>
        {content}
      </Link>
    );
  }
  return (
    <Card className="mx-4 mt-3 flex items-center gap-4 p-5">
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-[14px] font-medium text-muted">Jetzt gerade</span>
        <span className="font-rounded text-[26px] leading-tight font-bold tracking-[-0.4px] text-ok">Das Auto ist frei</span>
        {next && (
          <span className="text-[14px] text-muted">
            Als Nächstes: {people.get(next.ownerId).name} ab {formatDay(utcToLocal(next.startsAt).date)}
            {next.allDay ? "" : ` ${utcToLocal(next.startsAt).time}`}
          </span>
        )}
      </span>
      <span aria-hidden="true" className="flex size-14 shrink-0 items-center justify-center rounded-full bg-ok-soft text-ok">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
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
  return (
    <div className="sticky bottom-0 z-30 mt-auto rounded-t-[24px] bg-card/85 px-4 pb-safe pt-3 shadow-bar backdrop-blur-xl">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={selection ? "selection" : "quick"}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={FADE}
        >
          {selection ? (
            <SelectionActions selection={selection} bookings={bookings} people={people} meId={meId} today={today} onClear={onClear} onOptions={onOptions} />
          ) : (
            <QuickActions rangeMode={rangeMode} today={today} onQuick={onQuick} onRange={onRange} onClear={onClear} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function QuickActions({
  rangeMode,
  today,
  onQuick,
  onRange,
  onClear,
}: {
  rangeMode: boolean;
  today: LocalDate;
  onQuick: (date: LocalDate) => void;
  onRange: () => void;
  onClear: () => void;
}) {
  return (
      <div className="flex flex-col gap-2.5">
        <span className="text-center text-xs text-muted">
          {rangeMode ? "Ersten Tag antippen, dann den letzten" : "Tag antippen · zweiten Tag antippen = Zeitraum"}
        </span>
        <div className="grid grid-cols-3 gap-2">
          <Button variant="strong" onClick={() => onQuick(today)}>
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

function SelectionActions({
  selection,
  bookings,
  people,
  meId,
  today,
  onClear,
  onOptions,
}: {
  selection: Selection;
  bookings: ViewBooking[];
  people: People;
  meId: string;
  today: LocalDate;
  onClear: () => void;
  onOptions: (initial: ReserveInitial) => void;
}) {
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
    <div className="flex flex-col gap-2.5" role="region" aria-label="Auswahl">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col">
          <span className="font-rounded text-[20px] font-bold">{title}</span>
          <span className="text-[13px] text-muted">
            Ganzer Tag{!selection.end && " · weiteren Tag antippen für Zeitraum"}
          </span>
        </div>
        <button
          type="button"
          aria-label="Auswahl aufheben"
          onClick={onClear}
          className="pressable -mr-1 flex size-9 items-center justify-center rounded-full bg-fill text-muted"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
      {dayBookings.length > 0 && (
        <div className="-mx-1 flex flex-col rounded-xl bg-fill/60">
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
          <Link
            key={i.to}
            to={i.to}
            onClick={onClose}
            className="flex h-14 items-center border-b border-line px-1 text-[17px] font-semibold transition-colors last:border-0 active:text-muted"
          >
            <span className="flex-1">{i.label}</span>
            <span className="text-faint">
              <ChevronRight size={18} />
            </span>
          </Link>
        ))}
      </nav>
    </Sheet>
  );
}
