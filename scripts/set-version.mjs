// Sync a release version into all manifests. Called by semantic-release's
// prepare step: `node scripts/set-version.mjs <version>`.
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error(`Usage: set-version.mjs <semver>  (got: ${version})`);
  process.exit(1);
}

function patchJson(path, mutate) {
  const json = JSON.parse(readFileSync(path, "utf8"));
  mutate(json);
  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  console.log(`updated ${path} -> ${version}`);
}

patchJson("package.json", (j) => (j.version = version));
patchJson("src-tauri/tauri.conf.json", (j) => (j.version = version));

// Cargo.toml: only the [package] version line (column 0), never dependency
// version fields like `tauri = { version = "2" }`.
const cargoPath = "src-tauri/Cargo.toml";
const cargo = readFileSync(cargoPath, "utf8").replace(
  /^version = "[^"]*"/m,
  `version = "${version}"`,
);
writeFileSync(cargoPath, cargo);
console.log(`updated ${cargoPath} -> ${version}`);
