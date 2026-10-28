// Bundles the API and the CLI (and the shared contracts they import from ../src) into dist/.
// esbuild is used everywhere, including `npm run dev` and `npm run migrate`: running the sources
// with tsx fails, because ../src has no "type": "module", so tsx loads it as CommonJS and the
// `export *` re-exports in src/lib/permissions lose their named exports.
//   node scripts/build.mjs          → dist/server.mjs + dist/cli.mjs
//   node scripts/build.mjs cli      → dist/cli.mjs only
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

export const options = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  sourcemap: true,
  alias: { "@": fileURLToPath(new URL("../../src", import.meta.url)) },
  // Native and WASM packages stay external and are installed from package.json.
  external: ["@node-rs/argon2", "@electric-sql/pglite", "pg", "pdfkit", "fastify", "@fastify/*"],
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
};

export const targets = {
  server: { entryPoints: ["src/server.ts"], outfile: "dist/server.mjs" },
  cli: { entryPoints: ["src/db/cli.ts"], outfile: "dist/cli.mjs" },
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const only = process.argv[2];
  if (only && !targets[only]) throw new Error(`Unknown target "${only}". Use: ${Object.keys(targets).join(", ")}`);
  for (const [name, t] of Object.entries(targets)) if (!only || only === name) await build({ ...options, ...t });
}
