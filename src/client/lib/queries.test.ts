import { describe, expect, it } from "vitest";
import { CACHE_TIME } from "./queries";

describe("query cache lifetime", () => {
  it("stays below the setTimeout limit, otherwise restored queries are collected immediately", () => {
    expect(CACHE_TIME).toBeLessThan(2 ** 31 - 1);
  });
});
