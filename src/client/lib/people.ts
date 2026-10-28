import { useMemo } from "react";
import { useMe, useUsers } from "./queries";

export interface Person {
  id: string;
  name: string;
  /** Solid person colour for bars, dots and filled surfaces. */
  color: string;
  /** Tinted background that works on light and dark cards. */
  soft: string;
  /** Text colour on `soft`: the person colour pulled towards the ink colour for contrast. */
  ink: string;
  active: boolean;
}

function tones(color: string) {
  return {
    soft: `color-mix(in oklab, ${color} 17%, var(--color-card))`,
    ink: `color-mix(in oklab, ${color} 72%, var(--color-ink))`,
  };
}

const UNKNOWN: Person = { id: "", name: "Unbekannt", color: "#9AA0AA", ...tones("#9AA0AA"), active: false };

/** Names and colours of everyone in the calendar, from the cached user list. */
export function usePeople() {
  const me = useMe();
  const users = useUsers(me.data?.user.status === "active");
  return useMemo(() => {
    const map = new Map<string, Person>();
    for (const u of users.data ?? []) map.set(u.id, { ...u, ...tones(u.color) });
    if (me.data) {
      const u = me.data.user;
      map.set(u.id, { id: u.id, name: u.name, color: u.color, ...tones(u.color), active: true });
    }
    const get = (id: string | null | undefined): Person => (id && map.get(id)) || UNKNOWN;
    const active = [...map.values()].filter((p) => p.active);
    return { get, active, all: [...map.values()] };
  }, [me.data, users.data]);
}

export type People = ReturnType<typeof usePeople>;
