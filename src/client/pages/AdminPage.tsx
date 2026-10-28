import type { AdminUserDto } from "@shared/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Avatar, Button, Card, ErrorBox, ListRow, Screen, SectionLabel, Spinner } from "../components/ui";
import { api, errorMessage } from "../lib/api";
import { notify } from "../lib/notices";
import { useOnline } from "../lib/platform";
import { keys, useAdminUsers, useMe } from "../lib/queries";

function ago(iso: string) {
  const min = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60_000));
  if (min < 60) return `vor ${min} Min.`;
  if (min < 1440) return `vor ${Math.round(min / 60)} Std.`;
  return `vor ${Math.round(min / 1440)} Tagen`;
}

export function AdminPage() {
  const me = useMe().data!;
  const users = useAdminUsers();
  const online = useOnline();
  const queryClient = useQueryClient();
  const act = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "approve" | "reject" | "remove" }) => api(`/api/admin/users/${id}/${action}`, { method: "POST" }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.adminUsers });
      void queryClient.invalidateQueries({ queryKey: keys.users });
    },
    onError: (e) => notify({ tone: "error", title: "Nicht möglich", body: errorMessage(e) }),
  });

  if (users.isPending) return <Screen title="Verwaltung"><Spinner /></Screen>;
  if (!users.data) return <Screen title="Verwaltung"><ErrorBox message={errorMessage(users.error)} /></Screen>;
  const pending = users.data.filter((u) => u.status === "pending");
  const active = users.data.filter((u) => u.status === "active");
  const removed = users.data.filter((u) => u.status === "removed");
  const busy = act.isPending || !online;

  return (
    <Screen title="Verwaltung">
      <SectionLabel className="pt-1.5">Freigabe-Anfragen ({pending.length})</SectionLabel>
      {pending.length === 0 && <p className="px-1 text-[15px] text-muted">Niemand wartet auf Freigabe.</p>}
      {pending.map((u) => (
        <Card key={u.id} className="flex flex-col gap-3 p-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-base font-semibold">{u.email}</span>
            <span className="text-[13px] text-muted">
              {u.name} · über Google · {ago(u.createdAt)}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button size="sm" disabled={busy} onClick={() => act.mutate({ id: u.id, action: "reject" })}>
              Ablehnen
            </Button>
            <Button size="sm" variant="strong" disabled={busy} onClick={() => act.mutate({ id: u.id, action: "approve" })}>
              Freischalten
            </Button>
          </div>
        </Card>
      ))}

      <SectionLabel>Mitglieder</SectionLabel>
      <Card>
        {active.map((u, i) => (
          <MemberRow key={u.id} u={u} last={i === active.length - 1}>
            {u.id === me.user.id || u.role === "admin" ? (
              <span className="text-[13px] text-muted">Admin</span>
            ) : (
              <Button
                size="sm"
                variant="danger"
                className="h-9"
                disabled={busy}
                onClick={() =>
                  window.confirm(`${u.name} entfernen? Alle Sitzungen, Passkeys und künftigen Buchungen werden sofort gelöscht bzw. storniert.`) &&
                  act.mutate({ id: u.id, action: "remove" })
                }
              >
                Entfernen
              </Button>
            )}
          </MemberRow>
        ))}
      </Card>

      {removed.length > 0 && (
        <>
          <SectionLabel>Entfernt / abgelehnt</SectionLabel>
          <Card>
            {removed.map((u, i) => (
              <MemberRow key={u.id} u={u} last={i === removed.length - 1}>
                <Button size="sm" className="h-9" disabled={busy} onClick={() => act.mutate({ id: u.id, action: "approve" })}>
                  Wieder freischalten
                </Button>
              </MemberRow>
            ))}
          </Card>
        </>
      )}

      <SectionLabel>Für jemand anderen eintragen</SectionLabel>
      <Card className="p-3.5 text-[14px] text-muted">
        Im Reservieren-Sheet erscheint für dich zusätzlich „Für wen?“. Als Admin kannst du außerdem jede Reservierung bearbeiten, stornieren und jede Anfrage
        entscheiden.
      </Card>

      <Card className="mt-2">
        <ListRow to="/admin/audit" last>
          <span className="flex-1 text-[15px] font-semibold">Komplettes Audit-Log</span>
        </ListRow>
      </Card>
    </Screen>
  );
}

function MemberRow({ u, last, children }: { u: AdminUserDto; last: boolean; children: React.ReactNode }) {
  return (
    <ListRow last={last}>
      <Avatar name={u.name} color={u.color} size={32} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-base font-semibold">{u.name}</span>
        <span className="truncate text-[12px] text-muted">{u.email}</span>
      </span>
      {children}
    </ListRow>
  );
}
