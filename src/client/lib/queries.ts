import type {
  AdminUserDto,
  AuditEntryDto,
  BookingDetailDto,
  BookingsResponse,
  HistoryResponse,
  MeDto,
  RequestDetailDto,
  RequestsResponse,
  UserListEntry,
} from "@shared/api";
import { QueryClient, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api, ApiError } from "./api";
import { monthRange, type ViewBooking } from "./calendar";
import { applyOutbox } from "./overlay";
import { outbox } from "./outbox";
import { useStore } from "./store";

/**
 * How long cached data is kept (in memory and IndexedDB). Must stay below the setTimeout
 * limit of ~24.8 days: larger values overflow and garbage-collect queries immediately.
 */
export const CACHE_TIME = 14 * 24 * 3600_000;

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cached data (persisted in IndexedDB) is shown first; refetched when online.
      networkMode: "offlineFirst",
      gcTime: CACHE_TIME,
      staleTime: 30_000,
      retry: (count, err) => !(err instanceof ApiError && err.status < 500) && count < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { networkMode: "online" },
  },
});

export const keys = {
  me: ["me"] as const,
  users: ["users"] as const,
  bookings: (year: number, month: number) => ["bookings", year, month] as const,
  booking: (id: string) => ["booking", id] as const,
  requests: ["requests"] as const,
  request: (id: string) => ["request", id] as const,
  history: ["history"] as const,
  adminUsers: ["admin", "users"] as const,
  audit: ["admin", "audit"] as const,
};

/** Looks up who owns a booking in any cached month, for sync messages. */
export function cachedOwnerName(bookingId: string): string | undefined {
  const months = queryClient.getQueriesData<BookingsResponse>({ queryKey: ["bookings"] });
  const owner = months.flatMap(([, data]) => data?.bookings ?? []).find((b) => b.id === bookingId)?.ownerId;
  return queryClient.getQueryData<UserListEntry[]>(keys.users)?.find((u) => u.id === owner)?.name;
}

export function invalidateData() {
  void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== "me" && q.queryKey[0] !== "users" });
}

export const useMe = () =>
  useQuery({ queryKey: keys.me, queryFn: () => api<MeDto>("/api/me"), retry: false, staleTime: 60_000 });

export const useUsers = (enabled = true) =>
  useQuery({ queryKey: keys.users, queryFn: () => api<{ users: UserListEntry[] }>("/api/users").then((r) => r.users), enabled });

export function useMonthBookings(year: number, month: number) {
  return useQuery({
    queryKey: keys.bookings(year, month),
    queryFn: () => {
      const { startsAt, endsAt } = monthRange(year, month);
      return api<BookingsResponse>(`/api/bookings?from=${startsAt}&to=${endsAt}`);
    },
  });
}

/** Server bookings of a month with unsent outbox actions applied on top. */
export function useViewBookings(year: number, month: number, me: string | undefined) {
  const query = useMonthBookings(year, month);
  const entries = useStore(outbox);
  const bookings = useMemo<ViewBooking[]>(
    () => (me ? applyOutbox(query.data?.bookings ?? [], entries, me) : []),
    [query.data, entries, me],
  );
  return { ...query, bookings, requests: query.data?.requests ?? [] };
}

export const useBookingDetail = (id: string, enabled = true) =>
  useQuery({ queryKey: keys.booking(id), queryFn: () => api<BookingDetailDto>(`/api/bookings/${id}`), enabled });

export const useRequests = () => useQuery({ queryKey: keys.requests, queryFn: () => api<RequestsResponse>("/api/requests") });

export const useRequest = (id: string) =>
  useQuery({ queryKey: keys.request(id), queryFn: () => api<RequestDetailDto>(`/api/requests/${id}`) });

export const useHistory = () => useQuery({ queryKey: keys.history, queryFn: () => api<HistoryResponse>("/api/history") });

export const useAdminUsers = () =>
  useQuery({ queryKey: keys.adminUsers, queryFn: () => api<{ users: AdminUserDto[] }>("/api/admin/users").then((r) => r.users) });

export const useAudit = () =>
  useQuery({ queryKey: keys.audit, queryFn: () => api<{ entries: AuditEntryDto[] }>("/api/admin/audit").then((r) => r.entries) });
