import { overlaps, type Interval } from "./time";

/** What happens to an existing (target) booking when a request for `incoming` is granted. */
export type GrantEffect =
  | { kind: "none" }
  | { kind: "cancel" }
  | { kind: "shorten"; endsAt: string }
  | { kind: "trimStart"; startsAt: string }
  | { kind: "split"; firstEndsAt: string; secondStartsAt: string };

/**
 * "Klar, nimm's": the target booking gives way to the incoming interval.
 * - incoming covers the target completely → target is cancelled
 * - incoming starts inside the target and runs past its end → target ends where incoming starts
 * - incoming covers the start of the target → target starts where incoming ends
 * - incoming lies in the middle → target is split into two parts
 */
export function grantEffect(target: Interval, incoming: Interval): GrantEffect {
  if (!overlaps(target, incoming)) return { kind: "none" };
  const coversStart = incoming.startsAt <= target.startsAt;
  const coversEnd = incoming.endsAt >= target.endsAt;
  if (coversStart && coversEnd) return { kind: "cancel" };
  if (coversEnd) return { kind: "shorten", endsAt: incoming.startsAt };
  if (coversStart) return { kind: "trimStart", startsAt: incoming.endsAt };
  return { kind: "split", firstEndsAt: incoming.startsAt, secondStartsAt: incoming.endsAt };
}

export interface CounterPlan {
  /** New interval of the incoming (requesting) booking: it starts at X. */
  incoming: Interval;
  /** Target end after an extension ("brauch's bis X" later than the own end), if any. */
  extendTargetTo: string | null;
  /** Effect on the target relative to the shifted incoming interval. */
  effect: GrantEffect;
}

/**
 * "Brauch's bis X, danach gern": the incoming booking starts at X and is confirmed.
 * Returns null when X does not leave the incoming booking any time.
 */
export function counterPlan(target: Interval, incoming: Interval, counterTime: string): CounterPlan | null {
  if (counterTime <= incoming.startsAt || counterTime >= incoming.endsAt) return null;
  const shifted: Interval = { startsAt: counterTime, endsAt: incoming.endsAt };
  const extendTargetTo = counterTime > target.endsAt && target.startsAt < counterTime ? counterTime : null;
  const effectiveTarget: Interval = extendTargetTo ? { ...target, endsAt: extendTargetTo } : target;
  return { incoming: shifted, extendTargetTo, effect: grantEffect(effectiveTarget, shifted) };
}

/** Default "bis X" proposal: the target's own end, but always leaving the requester at least 15 minutes. */
export function defaultCounterTime(target: Interval, incoming: Interval): string {
  const latest = new Date(Date.parse(incoming.endsAt) - 15 * 60_000).toISOString();
  const proposal = target.endsAt < latest ? target.endsAt : latest;
  return proposal > incoming.startsAt ? proposal : latest;
}
