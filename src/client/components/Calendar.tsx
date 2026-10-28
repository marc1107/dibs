import { formatDay, formatRange, MONTHS_LONG, todayLocal, utcToLocal, type LocalDate } from "@shared/time";
import { Link } from "react-router";
import { daySegments, isPast, monthGrid, type DaySegment, type ViewBooking } from "../lib/calendar";
import type { People } from "../lib/people";
import { addDays } from "@shared/time";
import { ChevronLeft, ChevronRight, ClockIcon, cx } from "./ui";

export interface Selection {
  start: LocalDate;
  end: LocalDate | null;
}

export function inSelection(date: LocalDate, sel: Selection | null) {
  if (!sel) return false;
  const end = sel.end ?? sel.start;
  return date >= sel.start && date <= end;
}

export function MonthNav({ label, onPrev, onNext }: { label: string; onPrev: () => void; onNext: () => void }) {
  return (
    <div className="flex items-center justify-between px-1 pb-2.5">
      <button type="button" aria-label="Zurück" onClick={onPrev} className="flex size-11 items-center justify-center rounded-full active:bg-fill">
        <ChevronLeft size={18} />
      </button>
      <span className="text-base font-semibold" aria-live="polite">
        {label}
      </span>
      <button type="button" aria-label="Weiter" onClick={onNext} className="flex size-11 items-center justify-center rounded-full active:bg-fill">
        <ChevronRight size={18} />
      </button>
    </div>
  );
}

export const monthLabel = (year: number, month: number) => `${MONTHS_LONG[month - 1]} ${year}`;

function dayLabel(date: LocalDate, segments: DaySegment[], people: People) {
  const who = [...new Set(segments.filter((s) => !s.freed).map((s) => people.get(s.booking.ownerId).name))];
  const [, m, d] = date.split("-").map(Number);
  return `${d}. ${MONTHS_LONG[m! - 1]}${who.length ? `, ${who.join(", ")}` : ", frei"}`;
}

export function MonthView({
  year,
  month,
  bookings,
  people,
  selection,
  onDayTap,
  now,
}: {
  year: number;
  month: number;
  bookings: ViewBooking[];
  people: People;
  selection: Selection | null;
  onDayTap: (date: LocalDate) => void;
  now: Date;
}) {
  const today = todayLocal(now);
  return (
    <div>
      <div className="grid grid-cols-7 gap-1 pb-1.5 text-center text-xs text-muted" aria-hidden="true">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {monthGrid(year, month).map((cell, i) => {
          if (!cell.date) return <div key={`b${i}`} className="h-[46px]" />;
          const date = cell.date;
          const segs = daySegments(bookings, date);
          const used = segs.filter((s) => !s.freed);
          const fullOne = used.length === 1 && used[0]!.full ? used[0]! : null;
          const person = fullOne ? people.get(fullOne.booking.ownerId) : null;
          const selected = inSelection(date, selection);
          const past = isPast(date, now);
          return (
            <button
              key={date}
              type="button"
              aria-label={dayLabel(date, segs, people)}
              aria-pressed={selected}
              onClick={() => onDayTap(date)}
              className={cx(
                "relative flex h-[46px] flex-col items-center justify-center gap-1 rounded-xl",
                fullOne?.booking.status === "requested" && "striped",
                selected && "ring-2 ring-accent ring-inset",
                !selected && date === today && "ring-2 ring-ink ring-inset",
              )}
              style={{ background: selected ? "#DCE7FD" : person ? person.soft : undefined }}
            >
              <span
                className={cx("text-[15px]", date === today ? "font-bold" : "font-medium")}
                style={{ color: past ? "#9AA0AA" : person ? person.color : "#16181D" }}
              >
                {Number(date.slice(8))}
              </span>
              <span className="flex h-1 items-center gap-0.5" style={{ opacity: past ? 0.4 : 1 }}>
                {segs.slice(0, 3).map((s, j) => (
                  <span
                    key={j}
                    className={cx("h-1 rounded-sm", (s.booking.status === "requested" || s.freed) && "opacity-50")}
                    style={{
                      width: s.full && segs.length === 1 ? 22 : segs.length > 1 ? 8 : 12,
                      background: s.freed ? "#9AA0AA" : people.get(s.booking.ownerId).color,
                    }}
                  />
                ))}
              </span>
              {segs.some((s) => s.booking.pending) && (
                <span className="absolute right-1 top-1 text-muted">
                  <ClockIcon size={10} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Legend({ people }: { people: People }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-3.5 gap-y-1 pt-2.5 text-xs text-ink-soft">
      {people.active.map((p) => (
        <span key={p.id} className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-[3px]" style={{ background: p.color }} />
          {p.name}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="h-1 w-3.5 rounded-sm bg-faint" />
        Teil des Tages
      </span>
      <span className="flex items-center gap-1.5">
        <span className="striped h-2.5 w-3.5 rounded-[3px] bg-faint" />
        angefragt
      </span>
    </div>
  );
}

/** Seven rows with a 24-hour track each. */
export function WeekView({
  start,
  bookings,
  people,
  selection,
  onDayTap,
  now,
}: {
  start: LocalDate;
  bookings: ViewBooking[];
  people: People;
  selection: Selection | null;
  onDayTap: (date: LocalDate) => void;
  now: Date;
}) {
  const today = todayLocal(now);
  return (
    <div className="flex flex-col gap-1.5">
      {Array.from({ length: 7 }, (_, i) => addDays(start, i)).map((date) => {
        const segs = daySegments(bookings, date);
        return (
          <button
            key={date}
            type="button"
            onClick={() => onDayTap(date)}
            aria-label={dayLabel(date, segs, people)}
            aria-pressed={inSelection(date, selection)}
            className={cx(
              "flex min-h-12 items-center gap-3 rounded-xl px-2 text-left",
              inSelection(date, selection) && "bg-accent-soft ring-2 ring-accent ring-inset",
            )}
          >
            <span className={cx("w-14 shrink-0 text-[14px]", date === today ? "font-bold" : "font-medium", isPast(date, now) && "text-faint")}>
              {formatDay(date, false)}
            </span>
            <span className="relative h-8 flex-1 overflow-hidden rounded-lg bg-bg">
              {segs.map((s, j) => {
                const p = people.get(s.booking.ownerId);
                return (
                  <span
                    key={j}
                    className={cx(
                      "absolute inset-y-1 overflow-hidden rounded-md px-1.5 text-[11px] font-semibold leading-6 whitespace-nowrap",
                      (s.booking.status === "requested" || s.freed) && (s.freed ? "striped-grey" : "striped"),
                    )}
                    style={{
                      left: `${s.from * 100}%`,
                      width: `${Math.max(2, (s.to - s.from) * 100)}%`,
                      background: s.freed ? undefined : p.soft,
                      color: s.freed ? "#5B616E" : p.color,
                    }}
                  >
                    {s.freed ? "frei" : p.name}
                  </span>
                );
              })}
            </span>
          </button>
        );
      })}
      <div className="flex justify-between pl-[68px] pr-1 text-[10px] text-faint" aria-hidden="true">
        <span>0</span>
        <span>6</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>
    </div>
  );
}

/** Upcoming bookings as a plain list. */
export function ListView({ bookings, people, now }: { bookings: ViewBooking[]; people: People; now: Date }) {
  const t = now.toISOString();
  const items = bookings
    .filter((b) => (b.status === "active" || b.status === "requested" || b.status === "ended_early") && (b.status === "ended_early" ? b.originalEndsAt : b.endsAt) > t)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  if (items.length === 0) return <p className="px-2 py-6 text-center text-[15px] text-muted">Keine Buchungen in diesem Monat.</p>;
  return (
    <div className="flex flex-col">
      {items.map((b, i) => (
        <BookingRow key={b.id} booking={b} people={people} last={i === items.length - 1} />
      ))}
    </div>
  );
}

export function BookingRow({ booking: b, people, last, subtitle }: { booking: ViewBooking; people: People; last?: boolean; subtitle?: string }) {
  const p = people.get(b.ownerId);
  const days = Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 86_400_000);
  const sub =
    subtitle ??
    [
      b.allDay && (days > 1 ? `${days} ganze Tage` : "Ganzer Tag"),
      b.status === "requested" && "angefragt",
      b.status === "ended_early" && `frei ab ${utcToLocal(b.endsAt).time}`,
      b.seriesId && "Serie",
      b.note,
    ]
      .filter(Boolean)
      .join(" · ");
  const content = (
    <>
      <span className={cx("h-[34px] w-1.5 shrink-0 rounded-[3px]", b.status === "requested" && "striped")} style={{ background: p.color }} />
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="truncate text-[15px] font-semibold">
          {p.name} · {formatRange(b, b.allDay)}
        </span>
        {sub && <span className="truncate text-[13px] text-muted">{sub}</span>}
      </span>
      {b.pending && (
        <span className="flex items-center gap-1 text-[12px] text-muted">
          <ClockIcon /> wird gesendet
        </span>
      )}
    </>
  );
  const cls = cx("flex min-h-14 items-center gap-3 px-3.5 py-3", !last && "border-b border-line");
  return b.pending ? (
    <div className={cls}>{content}</div>
  ) : (
    <Link to={`/bookings/${b.id}`} className={cx(cls, "active:bg-fill")}>
      {content}
    </Link>
  );
}
