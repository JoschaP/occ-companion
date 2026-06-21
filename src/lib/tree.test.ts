import { describe, expect, it } from "vitest";

import { buildTree, checkableAgeKeys, collectKeys } from "./tree";
import type { ObjectInfo } from "../types";

const objects: ObjectInfo[] = [
  { key: "acme/api/2026-06-20/a.json.age", size: 10, lastModified: null },
  { key: "acme/api/manifest.json", size: 20, lastModified: null },
  { key: "acme/README.txt", size: 5, lastModified: null },
];

describe("buildTree / collectKeys", () => {
  it("collects every object key beneath a folder", () => {
    const tree = buildTree(objects);
    const acme = tree.find((n) => n.name === "acme")!;
    expect(collectKeys(acme).sort()).toEqual(
      [
        "acme/api/2026-06-20/a.json.age",
        "acme/api/manifest.json",
        "acme/README.txt",
      ].sort(),
    );
  });
});

describe("checkableAgeKeys", () => {
  it("returns only directly-selected .age files", () => {
    expect(
      checkableAgeKeys([
        { isFolder: false, key: "x/a.json.age" },
        { isFolder: false, key: "x/b.json" }, // not encrypted
      ]),
    ).toEqual(["x/a.json.age"]);
  });

  it("never probes a selected folder, even if it contains .age files", () => {
    // A folder node carries no `key`; its .age contents must NOT be checked.
    expect(
      checkableAgeKeys([
        { isFolder: true, key: undefined },
        { isFolder: true, key: undefined },
      ]),
    ).toEqual([]);
  });

  it("ignores folders mixed in with a selected file", () => {
    expect(
      checkableAgeKeys([
        { isFolder: true, key: undefined },
        { isFolder: false, key: "x/a.json.age" },
      ]),
    ).toEqual(["x/a.json.age"]);
  });

  it("matches the .age suffix case-insensitively", () => {
    expect(
      checkableAgeKeys([{ isFolder: false, key: "x/A.JSON.AGE" }]),
    ).toEqual(["x/A.JSON.AGE"]);
  });
});
