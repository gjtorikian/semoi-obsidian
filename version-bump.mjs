import { readFileSync, writeFileSync } from "node:fs";

// `npm version` exports the new version as npm_package_version before running
// the "version" lifecycle script, which is where this runs from.
const target = process.env.npm_package_version;
if (!target) {
  console.error("version-bump: npm_package_version not set — run via `npm version`");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.version = target;
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");

let versions = {};
try {
  versions = JSON.parse(readFileSync("versions.json", "utf8"));
} catch {
  // first bump — file doesn't exist yet
}
versions[target] = manifest.minAppVersion;
writeFileSync("versions.json", JSON.stringify(versions, null, 2) + "\n");

console.log(`bumped to ${target} (minAppVersion ${manifest.minAppVersion})`);
