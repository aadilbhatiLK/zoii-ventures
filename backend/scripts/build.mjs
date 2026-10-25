// Bundles the API (and the shared contracts it imports from ../src) into dist/server.mjs.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

await build({
  entryPoints: ["src/server.ts"],
  outfile: "dist/server.mjs",
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
});
