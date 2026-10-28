import { describe, expect, it } from "vitest";
import { counterPlan, defaultCounterTime, grantEffect } from "./resolution";

const t = (h: number, m = 0) => `2026-10-28T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00.000Z`;
const iv = (a: string, b: string) => ({ startsAt: a, endsAt: b });

describe("grantEffect", () => {
  const target = iv(t(10), t(18));

  it("shortens the target to the start of the request", () => {
    expect(grantEffect(target, iv(t(17), t(22)))).toEqual({ kind: "shorten", endsAt: t(17) });
  });

  it("splits the target when the request lies in the middle", () => {
    expect(grantEffect(target, iv(t(12), t(14)))).toEqual({ kind: "split", firstEndsAt: t(12), secondStartsAt: t(14) });
  });

  it("cancels the target when the request covers it completely", () => {
    expect(grantEffect(target, iv(t(9), t(19)))).toEqual({ kind: "cancel" });
    expect(grantEffect(target, target)).toEqual({ kind: "cancel" });
  });

  it("moves the target start when the request covers its beginning", () => {
    expect(grantEffect(target, iv(t(8), t(11)))).toEqual({ kind: "trimStart", startsAt: t(11) });
  });

  it("does nothing without overlap", () => {
    expect(grantEffect(target, iv(t(18), t(20)))).toEqual({ kind: "none" });
  });
});

describe("counterPlan", () => {
  const target = iv(t(15), t(16, 30));
  const incoming = iv(t(16), t(21));

  it("starts the request at X = own end without touching the target", () => {
    expect(counterPlan(target, incoming, t(16, 30))).toEqual({
      incoming: iv(t(16, 30), t(21)),
      extendTargetTo: null,
      effect: { kind: "none" },
    });
  });

  it("shortens the target when X is earlier than its end", () => {
    expect(counterPlan(target, incoming, t(16, 15))?.effect).toEqual({ kind: "shorten", endsAt: t(16, 15) });
  });

  it("extends the target when X is later than its end", () => {
    const plan = counterPlan(target, incoming, t(16, 45));
    expect(plan?.extendTargetTo).toBe(t(16, 45));
    expect(plan?.incoming).toEqual(iv(t(16, 45), t(21)));
  });

  it("splits the target when the shifted request still lies inside it", () => {
    expect(counterPlan(iv(t(10), t(20)), iv(t(12), t(14)), t(13))?.effect).toEqual({
      kind: "split",
      firstEndsAt: t(13),
      secondStartsAt: t(14),
    });
  });

  it("rejects X outside the requested interval", () => {
    expect(counterPlan(target, incoming, t(16))).toBeNull();
    expect(counterPlan(target, incoming, t(21))).toBeNull();
  });
});

describe("defaultCounterTime", () => {
  it("proposes the target end", () => {
    expect(defaultCounterTime(iv(t(15), t(16, 30)), iv(t(16), t(21)))).toBe(t(16, 30));
  });

  it("leaves the requester at least 15 minutes when the target outlasts the request", () => {
    expect(defaultCounterTime(iv(t(10), t(20)), iv(t(12), t(14)))).toBe(t(13, 45));
  });
});
