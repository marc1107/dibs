import { describe, expect, it } from "vitest";
import { firstName } from "./names";

describe("firstName", () => {
  it("keeps only the first word of a full name", () => {
    expect(firstName("Luca Nuber")).toBe("Luca");
    expect(firstName("  Sophie   Bohner ")).toBe("Sophie");
    expect(firstName("Anna Maria Schmidt")).toBe("Anna");
  });

  it("leaves single names alone", () => {
    expect(firstName("Marc")).toBe("Marc");
  });

  it("falls back to the input when there is nothing to split", () => {
    expect(firstName("   ")).toBe("   ");
  });
});
