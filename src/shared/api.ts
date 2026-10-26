import type {
  AuditSource,
  BookingStatus,
  NotificationType,
  RequestStatus,
  Role,
  StartView,
  UserStatus,
} from "./constants";

/** JSON shapes exchanged between Worker and PWA. */

export interface MemberDto {
  id: string;
  name: string;
  color: string;
  role: Role;
}

/** Everyone who appears in the calendar; removed people stay resolvable by name for the history. */
export interface UserListEntry extends MemberDto {
  active: boolean;
}

export interface MeDto {
  user: MemberDto & { email: string; status: UserStatus; startView: StartView };
  notifications: Record<NotificationType, boolean>;
  vapidPublicKey: string | null;
  icalUrl: string | null;
}

export interface BookingDto {
  id: string;
  ownerId: string;
  createdBy: string;
  seriesId: string | null;
  startsAt: string;
  endsAt: string;
  originalStartsAt: string;
  originalEndsAt: string;
  allDay: boolean;
  status: BookingStatus;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RequestDto {
  id: string;
  bookingId: string;
  targetBookingId: string;
  status: RequestStatus;
  counterTime: string | null;
  decidedBy: string | null;
  createdAt: string;
  decidedAt: string | null;
}

/** A request together with both bookings, for the request screens. */
export interface RequestDetailDto extends RequestDto {
  booking: BookingDto;
  target: BookingDto;
}

export interface BookingsResponse {
  bookings: BookingDto[];
  requests: RequestDto[];
}

export interface BookingDetailDto {
  booking: BookingDto;
  /** Requests this booking sent (it is the requester). */
  outgoing: RequestDetailDto[];
  /** Requests other bookings sent to this one. */
  incoming: RequestDetailDto[];
}

export interface RequestsResponse {
  incoming: RequestDetailDto[];
  outgoing: RequestDetailDto[];
  /** Admin only: open requests between other people. */
  others: RequestDetailDto[];
}

export interface AuditEntryDto {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  bookingId: string | null;
  before: unknown;
  after: unknown;
  source: AuditSource;
}

export interface HistoryResponse {
  bookings: BookingDto[];
  audit: AuditEntryDto[];
}

export interface AdminUserDto extends MemberDto {
  email: string;
  status: UserStatus;
  createdAt: string;
}

/** Outcome of a single booking mutation (REST response body and per-action sync result). */
export type MutationResult =
  | {
      ok: true;
      /** "created" = active immediately, "requested" = became a request. */
      outcome: "created" | "requested" | "updated" | "cancelled" | "ended_early" | "ignored";
      bookings: BookingDto[];
      requests: RequestDto[];
      message?: string;
    }
  | {
      ok: false;
      error: "conflict" | "stale" | "forbidden" | "not_found" | "invalid" | "already_over" | "not_started";
      message: string;
      /** Server state of the booking (for "stale"), shown as before/after to the user. */
      server?: BookingDto;
      conflicts?: BookingDto[];
    };

export interface SyncResponse {
  results: (MutationResult & { clientId: string })[];
}
