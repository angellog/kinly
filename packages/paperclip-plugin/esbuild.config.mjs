import { build, context } from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets({
  workerEntry: "src/worker.ts",
  manifestEntry: "src/manifest.ts",
  uiEntry: "src/ui/index.tsx",
  outdir: "dist",
});

const targets = [presets.esbuild.manifest, presets.esbuild.worker, presets.esbuild.ui].filter(Boolean);
const watch = process.argv.includes("--watch");

for (const options of targets) {
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
  } else {
    await build(options);
  }
}

console.log(watch ? "watching…" : "built dist/");
