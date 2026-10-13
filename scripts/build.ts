/**
 * يبني البوت لـ txiki.js (الذاكرة < 20 ميقا):  bun run build
 *   → dist/rift.js  (حزمة وحدة، مضغوطة)
 *   شغّله:  ./runtime/tjs run dist/rift.js     (أو bash start.sh)
 * الاستيرادات الخاصة بـ Node تتحول لبدائل txiki في src/platform/tjs.
 */
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const shim = (name: string) => resolve(root, "src/platform/tjs", `${name}.ts`);
const MAP: Record<string, string> = {
  "node:fs": shim("fs"), fs: shim("fs"), "node:path": shim("path"), path: shim("path"),
  "node:crypto": shim("crypto"), crypto: shim("crypto"), "node:url": shim("url"), url: shim("url"),
};

const result = await Bun.build({
  entrypoints: [resolve(root, "src/platform/tjs/main.ts")],
  outdir: resolve(root, "dist"),
  naming: "rift.js",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "none",
  external: ["tjs:*"],
  define: { "import.meta.dir": "undefined" },
  plugins: [{
    name: "txiki",
    setup(b) {
      b.onResolve({ filter: /^(node:)?(fs|path|crypto|url)$/ }, (a) => ({ path: MAP[a.path]! }));
    },
  }],
});
if (!result.success) {
  for (const l of result.logs) console.error(l);
  process.exit(1);
}
const out = result.outputs[0]!;
console.log(`dist/rift.js · ${(out.size / 1024).toFixed(0)} KB`);
