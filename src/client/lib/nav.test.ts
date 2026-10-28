import { describe, expect, it } from "vitest";
import { parentPath } from "./nav";

describe("parentPath", () => {
  it("drops the last path segment", () => {
    expect(parentPath("/admin/audit")).toBe("/admin");
    expect(parentPath("/requests/abc")).toBe("/requests");
    expect(parentPath("/settings")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});
