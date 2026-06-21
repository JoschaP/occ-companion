import { describe, expect, it } from "vitest";

import { summarizeKeyChecks } from "./keycheck";
import type { KeyMatchStatus } from "../types";

const cache = (entries: Record<string, KeyMatchStatus>) =>
  new Map(Object.entries(entries));

describe("summarizeKeyChecks", () => {
  it("returns null when nothing is cached yet", () => {
    expect(summarizeKeyChecks(["a.age", "b.age"], new Map())).toBeNull();
  });

  it("counts each cached status for the given keys", () => {
    const c = cache({
      "a.age": "match",
      "b.age": "mismatch",
      "c.age": "match",
      "d.json": "plain",
    });
    expect(
      summarizeKeyChecks(["a.age", "b.age", "c.age", "d.json"], c),
    ).toEqual({ matches: 2, mismatches: 1, plain: 1, unknown: 0 });
  });

  it("only summarizes the requested keys, ignoring others in the cache", () => {
    const c = cache({ "a.age": "match", "b.age": "mismatch" });
    expect(summarizeKeyChecks(["a.age"], c)).toEqual({
      matches: 1,
      mismatches: 0,
      plain: 0,
      unknown: 0,
    });
  });

  it("partial cache: reflects only keys already known", () => {
    const c = cache({ "a.age": "match" }); // b.age not yet checked
    expect(summarizeKeyChecks(["a.age", "b.age"], c)).toEqual({
      matches: 1,
      mismatches: 0,
      plain: 0,
      unknown: 0,
    });
  });
});
