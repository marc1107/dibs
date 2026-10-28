import { softColor } from "@shared/constants";
import { useMemo } from "react";
import { useMe, useUsers } from "./queries";

export interface Person {
  id: string;
  name: string;
  color: string;
  soft: string;
  active: boolean;
}

const UNKNOWN: Person = { id: "", name: "Unbekannt", color: "#9AA0AA", soft: "#EEF0F3", active: false };

/** Names and colours of everyone in the calendar, from the cached user list. */
export function usePeople() {
  const me = useMe();
  const users = useUsers(me.data?.user.status === "active");
  return useMemo(() => {
    const map = new Map<string, Person>();
    for (const u of users.data ?? []) map.set(u.id, { ...u, soft: softColor(u.color) });
    if (me.data) {
      const u = me.data.user;
      map.set(u.id, { id: u.id, name: u.name, color: u.color, soft: softColor(u.color), active: true });
    }
    const get = (id: string | null | undefined): Person => (id && map.get(id)) || UNKNOWN;
    const active = [...map.values()].filter((p) => p.active);
    return { get, active, all: [...map.values()] };
  }, [me.data, users.data]);
}

export type People = ReturnType<typeof usePeople>;
