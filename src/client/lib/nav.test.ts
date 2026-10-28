import { describe, expect, it } from "vitest";
import { parentPath } from "./nav";

describe("parentPath", () => {
  it("goes up to the nearest page that exists", () => {
    expect(parentPath("/admin/audit")).toBe("/admin");
    expect(parentPath("/requests/abc")).toBe("/requests");
    expect(parentPath("/settings")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });

  it("skips path levels that are not pages (notification deep links)", () => {
    expect(parentPath("/bookings/abc")).toBe("/");
  });
});
