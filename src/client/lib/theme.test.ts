import { describe, expect, it } from "vitest";
import { parseThemePref, resolveTheme } from "./theme";

describe("theme", () => {
  it("follows the system unless a fixed theme is chosen", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("falls back to the system setting for missing or unknown stored values", () => {
    expect(parseThemePref(null)).toBe("system");
    expect(parseThemePref("sepia")).toBe("system");
    expect(parseThemePref("dark")).toBe("dark");
  });
});
