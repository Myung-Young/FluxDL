import { describe, expect, it } from "vitest";
import { STRINGS } from "./strings.js";

function leaves(value: unknown, path: string, out: string[]): string[] {
  if (typeof value === "string") {
    out.push(`${path} = ${JSON.stringify(value)}`);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) leaves(v, path === "" ? k : `${path}.${k}`, out);
    return out;
  }
  throw new Error(`Non-string leaf at ${path}`);
}

describe("STRINGS", () => {
  it("has no empty user-facing copy", () => {
    const all = leaves(STRINGS, "", []);
    expect(all.length).toBeGreaterThan(40);
    for (const line of all) {
      const value = line.split(" = ")[1] ?? "";
      expect(value.length, line).toBeGreaterThan(2);
    }
  });
});
