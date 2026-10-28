import type { BookingDto } from "@shared/api";
import type { Repeat } from "@shared/constants";
import { createBookingSchema, updateBookingSchema, type Scope } from "@shared/schemas";
import { defaultSeriesEnd, expandOccurrences } from "@shared/series";
import {
  formatDay,
  formatDuration,
  formatRange,
  timeSlots,
  toInterval,
  utcToLocal,
  utcToLocalEnd,
  type Interval,
  type LocalDate,
} from "@shared/time";
import { useState } from "react";
import { findConflicts, type Conflict, type ViewBooking } from "../lib/calendar";
import { enqueue } from "../lib/outbox";
import { useMe } from "../lib/queries";
import { usePeople, type People } from "../lib/people";
import { Button, Chip, Segmented, Sheet, WarningIcon, cx } from "./ui";

export interface ReserveInitial {
  startDate: LocalDate;
  endDate: LocalDate;
  allDay?: boolean;
  startTime?: string;
  endTime?: string;
  note?: string | null;
  ownerId?: string;
}

const REPEAT_OPTIONS: { value: Repeat; label: string }[] = [
  { value: "none", label: "Nie" },
  { value: "weekly", label: "Wöchentlich" },
  { value: "biweekly", label: "Alle 2 Wochen" },
];
const START_SLOTS = timeSlots(false);
const END_SLOTS = timeSlots(true).slice(1);
const WEEKDAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

export function initialFromBooking(b: BookingDto): ReserveInitial {
  const s = utcToLocal(b.startsAt);
  const e = utcToLocalEnd(b.endsAt);
  return { startDate: s.date, endDate: e.date, allDay: b.allDay, startTime: s.time, endTime: e.time, note: b.note, ownerId: b.ownerId };
}

export function ReserveSheet({
  open,
  onClose,
  initial,
  editing,
  bookings,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  initial: ReserveInitial;
  editing?: { booking: BookingDto; scope: Scope };
  bookings: ViewBooking[];
  onDone?: () => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} label={editing ? "Buchung bearbeiten" : "Reservieren"}>
      {/* Remount per opening so the form starts from the given initial values. */}
      {open && <ReserveForm key={JSON.stringify(initial)} initial={initial} editing={editing} bookings={bookings} onClose={onClose} onDone={onDone} />}
    </Sheet>
  );
}

function ReserveForm({
  initial,
  editing,
  bookings,
  onClose,
  onDone,
}: {
  initial: ReserveInitial;
  editing?: { booking: BookingDto; scope: Scope };
  bookings: ViewBooking[];
  onClose: () => void;
  onDone?: () => void;
}) {
  const me = useMe().data!;
  const people = usePeople();
  const isAdmin = me.user.role === "admin";
  const [ownerId, setOwnerId] = useState(initial.ownerId ?? me.user.id);
  const [startDate, setStartDate] = useState(initial.startDate);
  const [endDate, setEndDate] = useState(initial.endDate);
  const [allDay, setAllDay] = useState(initial.allDay ?? true);
  const [startTime, setStartTime] = useState(initial.startTime && initial.startTime !== "24:00" ? initial.startTime : "17:00");
  const [endTime, setEndTime] = useState(initial.endTime && initial.endTime !== "00:00" ? initial.endTime : "22:00");
  const [repeat, setRepeat] = useState<Repeat>("none");
  const [until, setUntil] = useState(defaultSeriesEnd(initial.startDate));
  const [note, setNote] = useState(initial.note ?? "");
  const [editDates, setEditDates] = useState(Boolean(editing));

  const spec = {
    startDate,
    endDate: endDate < startDate ? startDate : endDate,
    allDay,
    startTime: allDay ? null : startTime,
    endTime: allDay ? null : endTime,
    repeat,
    until: repeat === "none" ? null : until,
    note: note.trim() || undefined,
  };
  const validation = editing
    ? updateBookingSchema.safeParse({ ...spec, clientId: crypto.randomUUID(), scope: editing.scope })
    : createBookingSchema.safeParse({ ...spec, clientId: crypto.randomUUID(), ownerId });
  const occurrences = validation.success ? expandOccurrences(spec) : [];
  const conflicts = findConflicts(bookings, ownerId, occurrences, editing?.booking.id);
  const conflictNames = [...new Set(conflicts.map((c) => people.get(c.booking.ownerId).name))];
  const editBlocked = Boolean(editing && editing.booking.status === "active" && conflicts.length > 0);
  const single = occurrences.length === 1 ? occurrences[0]! : null;
  const laterStart = single && conflicts.length === 1 ? laterStartOption(conflicts[0]!, single) : null;

  const submit = async (override?: { startTime: string }) => {
    const clientId = crypto.randomUUID();
    const payload = { ...spec, ...(override ? { allDay: false, startTime: override.startTime } : {}), clientId };
    const label = formatRange(toInterval(payload), payload.allDay);
    if (editing) {
      await enqueue(
        { type: "update", bookingId: editing.booking.id, payload: { ...payload, scope: editing.scope, baseUpdatedAt: editing.booking.updatedAt } },
        label,
      );
    } else {
      await enqueue({ type: "create", payload: { ...payload, ownerId: ownerId === me.user.id ? undefined : ownerId } }, label);
    }
    onDone?.();
    onClose();
  };

  const title =
    startDate === spec.endDate ? formatDay(startDate) : `${formatDay(startDate, startDate.slice(0, 7) !== spec.endDate.slice(0, 7))} – ${formatDay(spec.endDate)}`;
  const primaryLabel = editing ? (editBlocked ? "Überschneidung" : "Speichern") : conflicts.length > 0 ? `${conflictNames.join(" & ")} fragen` : "Reservieren";

  return (
    <>
      <div className="flex flex-col gap-1">
        <span className="text-[13px] text-muted">
          {editing ? "Buchung bearbeiten" : "Reservierung"} für {people.get(ownerId).name}
          {editing?.scope === "following" && " · dieser und alle folgenden Termine"}
        </span>
        <button type="button" onClick={() => setEditDates((v) => !v)} className="self-start text-left" aria-expanded={editDates}>
          <h2 className="text-2xl font-bold">
            {title}
            {!allDay && single && ` · ${startTime}–${endTime}`}
          </h2>
          <span className="text-[13px] font-semibold text-accent">{editDates ? "Datum ausblenden" : "Datum ändern"}</span>
        </button>
      </div>

      {editDates && (
        <div className="grid grid-cols-2 gap-2.5">
          <DateField label="Erster Tag" value={startDate} onChange={(v) => { setStartDate(v); if (endDate < v) setEndDate(v); }} />
          <DateField label="Letzter Tag" value={spec.endDate} min={startDate} onChange={setEndDate} />
        </div>
      )}

      {isAdmin && !editing && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] text-muted">Für wen?</span>
          <Segmented label="Für wen" value={ownerId} onChange={setOwnerId} options={people.active.map((p) => ({ value: p.id, label: p.name }))} />
        </div>
      )}

      <Segmented
        label="Dauer"
        value={allDay ? "full" : "time"}
        onChange={(v) => setAllDay(v === "full")}
        options={[
          { value: "full", label: "Ganzer Tag" },
          { value: "time", label: "Mit Uhrzeit" },
        ]}
      />

      {!allDay && (
        <div className="grid grid-cols-2 gap-2.5">
          <TimeField label={startDate === spec.endDate ? "Von" : `Von (${formatDay(startDate, false)})`} value={startTime} options={START_SLOTS} onChange={setStartTime} />
          <TimeField label={startDate === spec.endDate ? "Bis" : `Bis (${formatDay(spec.endDate, false)})`} value={endTime} options={END_SLOTS} onChange={setEndTime} />
        </div>
      )}

      {!editing && (
        <div className="flex flex-col gap-2.5">
          <span className="text-[15px] font-semibold">Wiederholen</span>
          <div className="flex flex-wrap gap-2">
            {REPEAT_OPTIONS.map((o) => (
              <Chip key={o.value} active={repeat === o.value} onClick={() => setRepeat(o.value)}>
                {o.label}
              </Chip>
            ))}
          </div>
          {repeat !== "none" && (
            <label className="flex h-12 items-center justify-between rounded-xl bg-bg px-3.5 text-[15px]">
              Endet am
              <input
                type="date"
                value={until}
                min={startDate}
                onChange={(e) => setUntil(e.target.value)}
                className="bg-transparent text-[15px] font-semibold text-accent"
              />
            </label>
          )}
        </div>
      )}

      <label className="flex flex-col gap-1.5 text-[13px] text-muted">
        Notiz (optional)
        <input
          type="text"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          placeholder="z. B. Umzug, Baumarkt"
          className="h-12 rounded-xl border border-border px-3.5 text-[15px] text-ink placeholder:text-faint"
        />
      </label>

      {conflicts.length > 0 && <ConflictWarning conflicts={conflicts} people={people} editBlocked={editBlocked} series={occurrences.length > 1} myStartDate={startDate} />}
      {single && conflicts.length === 1 && !allDay && <Timeline conflict={conflicts[0]!} mine={single} people={people} ownerId={ownerId} />}

      {!validation.success && <p className="text-center text-[13px] font-semibold text-danger">{validation.error.issues[0]?.message}</p>}

      <div className="flex flex-col gap-2.5 pt-2">
        {repeat !== "none" && occurrences.length > 0 && (
          <span className="text-center text-[13px] text-muted">
            {occurrences.length} Termine · {repeat === "weekly" ? "jeden" : "jeden zweiten"} {WEEKDAY_LONG[(new Date(`${startDate}T12:00:00Z`).getUTCDay() + 6) % 7]} bis{" "}
            {until.split("-").reverse().join(".")}
            {conflicts.length > 0 && ` · ${conflicts.length === 1 ? "einer wird" : `${conflicts.length} werden`} zur Anfrage`}
          </span>
        )}
        <Button variant="primary" size="lg" disabled={!validation.success || editBlocked} onClick={() => void submit()}>
          {primaryLabel}
        </Button>
        {laterStart && !editing && (
          <Button variant="soft" size="sm" onClick={() => void submit({ startTime: laterStart })}>
            Erst ab {laterStart} reservieren
          </Button>
        )}
      </div>
    </>
  );
}

/** "Erst ab 18:30 reservieren": offered when the only conflict ends inside the wanted slot. */
function laterStartOption(c: Conflict, mine: Interval): string | null {
  if (c.booking.startsAt > mine.startsAt || c.booking.endsAt >= mine.endsAt) return null;
  const end = utcToLocal(c.booking.endsAt);
  if (end.date !== utcToLocal(mine.startsAt).date) return null;
  return end.time;
}

function ConflictWarning({
  conflicts,
  people,
  editBlocked,
  series,
  myStartDate,
}: {
  conflicts: Conflict[];
  people: People;
  editBlocked: boolean;
  series: boolean;
  myStartDate: LocalDate;
}) {
  const first = conflicts[0]!;
  const p = people.get(first.booking.ownerId);
  const until = utcToLocalEnd(first.booking.endsAt);
  const untilLabel = until.date === myStartDate ? until.time : `${formatDay(until.date)} ${until.time}`;
  return (
    <div className="flex items-start gap-3 rounded-[14px] bg-warn-bg p-3.5 text-warn-ink" role="alert">
      <WarningIcon />
      <div className="flex flex-col gap-1">
        <span className="text-[15px] font-semibold">
          Überschneidet sich mit {[...new Set(conflicts.map((c) => people.get(c.booking.ownerId).name))].join(" und ")}
        </span>
        <span className="text-[14px]">
          {editBlocked
            ? "Eine bestehende Buchung kann nicht auf fremde Zeit verschoben werden. Reserviere die zusätzliche Zeit separat, dann wird sie zur Anfrage."
            : series
              ? `${conflicts.length} Termin${conflicts.length > 1 ? "e" : ""} überschneide${conflicts.length > 1 ? "n" : "t"} sich, z. B. ${formatDay(utcToLocal(first.booking.startsAt).date)} (${formatDuration(first.minutes)}). Nur diese werden zur Anfrage, der Rest wird normal angelegt.`
              : `${p.name} hat das Auto ${first.booking.allDay ? `am ${formatDay(utcToLocal(first.booking.startsAt).date)}` : `bis ${untilLabel}`} (${formatDuration(first.minutes)} Überschneidung). Wir fragen, ob du es haben kannst.`}
        </span>
      </div>
    </div>
  );
}

function Timeline({ conflict, mine, people, ownerId }: { conflict: Conflict; mine: Interval; people: People; ownerId: string }) {
  const other = conflict.booking;
  const lo = Math.min(Date.parse(other.startsAt), Date.parse(mine.startsAt));
  const hi = Math.max(Date.parse(other.endsAt), Date.parse(mine.endsAt));
  const pad = (hi - lo) * 0.06;
  const pos = (iso: string) => ((Date.parse(iso) - lo + pad) / (hi - lo + 2 * pad)) * 100;
  const op = people.get(other.ownerId);
  const me = people.get(ownerId);
  const overlapStart = other.startsAt > mine.startsAt ? other.startsAt : mine.startsAt;
  const overlapEnd = other.endsAt < mine.endsAt ? other.endsAt : mine.endsAt;
  const label = (iv: Interval) => `${utcToLocal(iv.startsAt).time}–${utcToLocalEnd(iv.endsAt).time}`;
  return (
    <div className="flex flex-col gap-2" aria-label="Zeitstrahl">
      <span className="text-[13px] text-muted">Zeitstrahl {formatDay(utcToLocal(mine.startsAt).date)}</span>
      <div className="relative h-14 overflow-hidden rounded-xl bg-bg">
        <div
          className="absolute top-2 h-[18px] truncate rounded-md pl-2 text-[12px] font-semibold leading-[18px]"
          style={{ left: `${pos(other.startsAt)}%`, width: `${pos(other.endsAt) - pos(other.startsAt)}%`, background: op.soft, color: op.ink }}
        >
          {op.name} {label(other)}
        </div>
        <div
          className="striped absolute top-[30px] h-[18px] truncate rounded-md border border-dashed pl-2 text-[12px] font-semibold leading-4"
          style={{ left: `${pos(mine.startsAt)}%`, width: `${pos(mine.endsAt) - pos(mine.startsAt)}%`, background: me.soft, color: me.ink, borderColor: me.color }}
        >
          Du {label(mine)}
        </div>
        <div
          className={cx("absolute inset-y-0 border-x")}
          style={{ left: `${pos(overlapStart)}%`, width: `${pos(overlapEnd) - pos(overlapStart)}%`, background: `${op.color}1F`, borderColor: op.color }}
        />
      </div>
    </div>
  );
}

function DateField({ label, value, onChange, min }: { label: string; value: string; onChange: (v: string) => void; min?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-muted">
      {label}
      <input
        type="date"
        value={value}
        min={min}
        onChange={(e) => e.target.value && onChange(e.target.value)}
        className="h-12 rounded-xl border border-border bg-card px-3 text-[16px] text-ink"
      />
    </label>
  );
}

function TimeField({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1.5 text-[13px] text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-12 appearance-none rounded-xl border border-border bg-card px-3 text-[17px] text-ink"
      >
        {options.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </label>
  );
}
