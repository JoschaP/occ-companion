// Generate the Homebrew Cask and Scoop manifest for a release from its built
// assets. Driven by the real downloaded files (not guessed names), so it adapts
// to whatever the bundler produced.
//
// Usage:
//   node scripts/update-packages.mjs <version> <assetsDir> <caskOut> <scoopOut>
//
// Env: REPO (owner/repo, default JoschaP/occ-secure-exports)
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [version, assetsDir, caskOut, scoopOut] = process.argv.slice(2);
const REPO = process.env.REPO || "JoschaP/occ-secure-exports";

if (!version || !assetsDir || !caskOut || !scoopOut) {
  console.error("Usage: update-packages.mjs <version> <assetsDir> <caskOut> <scoopOut>");
  process.exit(1);
}

const files = readdirSync(assetsDir);
const sha256 = (name) =>
  createHash("sha256").update(readFileSync(join(assetsDir, name))).digest("hex");
const url = (name) =>
  `https://github.com/${REPO}/releases/download/v${version}/${encodeURIComponent(name)}`;

function pick(re, label) {
  const hit = files.find((f) => re.test(f));
  if (!hit) {
    console.error(`Missing asset for ${label} (pattern ${re}). Found: ${files.join(", ")}`);
    process.exit(1);
  }
  return hit;
}

// macOS: per-arch DMGs.
const dmgArm = pick(/aarch64.*\.dmg$/i, "macOS arm64 .dmg");
const dmgIntel = pick(/x64.*\.dmg$/i, "macOS x86_64 .dmg");
// Windows: NSIS installer.
const winSetup = pick(/x64-setup\.exe$/i, "Windows x64 NSIS setup");

const cask = `cask "occ-secure-exports" do
  version "${version}"

  on_arm do
    sha256 "${sha256(dmgArm)}"
    url "${url(dmgArm)}",
        verified: "github.com/${REPO}/"
  end
  on_intel do
    sha256 "${sha256(dmgIntel)}"
    url "${url(dmgIntel)}",
        verified: "github.com/${REPO}/"
  end

  name "OCC Secure Exports"
  desc "Retrieve & decrypt your age-encrypted data exports"
  homepage "https://github.com/${REPO}"

  app "OCC Secure Exports.app"

  zap trash: [
    "~/Library/Application Support/de.occ-secure-exports.app",
    "~/Library/Caches/de.occ-secure-exports.app",
    "~/Library/WebKit/de.occ-secure-exports.app",
  ]
end
`;

const scoop = {
  version,
  description: "Retrieve & decrypt your age-encrypted data exports from your own S3 bucket.",
  homepage: `https://github.com/${REPO}`,
  license: "MIT",
  architecture: {
    "64bit": {
      url: url(winSetup),
      hash: sha256(winSetup),
    },
  },
  installer: {
    script: [
      "Start-Process -Wait -FilePath \"$dir\\\\$fname\" -ArgumentList '/S'",
    ],
  },
  uninstaller: {
    script: [
      "$u = \"$env:LOCALAPPDATA\\\\OCC Secure Exports\\\\uninstall.exe\"",
      "if (Test-Path $u) { Start-Process -Wait -FilePath $u -ArgumentList '/S' }",
    ],
  },
  checkver: {
    github: `https://github.com/${REPO}`,
  },
  autoupdate: {
    architecture: {
      "64bit": {
        url: `https://github.com/${REPO}/releases/download/v$version/OCC.Secure.Exports_$version_x64-setup.exe`,
      },
    },
  },
};

writeFileSync(caskOut, cask);
writeFileSync(scoopOut, `${JSON.stringify(scoop, null, 2)}\n`);
console.log(`Wrote ${caskOut} and ${scoopOut} for v${version}`);
console.log(`  arm dmg:   ${dmgArm}`);
console.log(`  intel dmg: ${dmgIntel}`);
console.log(`  win setup: ${winSetup}`);
