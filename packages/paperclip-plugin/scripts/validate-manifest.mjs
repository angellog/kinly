// Validate dist/manifest.js against the installed Paperclip host's own manifest schema (E1).
// Usage: node scripts/validate-manifest.mjs [path-to-@paperclipai/shared]
import path from "node:path";
import { pathToFileURL } from "node:url";
import os from "node:os";
import { existsSync } from "node:fs";

const shared = process.argv[2] ?? path.join(os.homedir(), ".paperclip/cli/installs/npm/2026.1005.0/node_modules/@paperclipai/shared");
if (!existsSync(path.join(shared, "dist/index.js"))) {
  console.log(`skip: no Paperclip host install at ${shared}`);
  process.exit(0);
}
const { pluginManifestV1Schema } = await import(pathToFileURL(path.join(shared, "dist/index.js")).href);
const manifest = (await import(pathToFileURL(path.resolve("dist/manifest.js")).href)).default;
const res = pluginManifestV1Schema.safeParse(manifest);
if (!res.success) {
  console.error("manifest INVALID:");
  for (const issue of res.error.issues) console.error(`  ${issue.path.join(".")}: ${issue.message}`);
  process.exit(1);
}
console.log(`manifest valid against ${shared}: ${manifest.id}@${manifest.version}, ${manifest.capabilities.length} capabilities, ${manifest.tools.length} tools`);
