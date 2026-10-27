// Development server: rebuilds dist/dev/server.mjs on change and restarts it (see build.mjs for why
// this doesn't use tsx). Reads .env when present.
import { spawn } from "node:child_process";
import { context } from "esbuild";
import { options } from "./build.mjs";

let child = null;
const restart = () => {
  if (child) child.kill("SIGTERM");
  child = spawn(process.execPath, ["--enable-source-maps", "--env-file-if-exists=.env", "dist/dev/server.mjs"], { stdio: "inherit" });
};
const ctx = await context({
  ...options,
  entryPoints: ["src/server.ts"],
  outfile: "dist/dev/server.mjs",
  logLevel: "warning",
  plugins: [{ name: "restart", setup: (b) => b.onEnd((r) => { if (!r.errors.length) restart(); }) }],
});
await ctx.watch();
console.log("[dev] watching src/ and ../src/ — the API restarts on every change");
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { child?.kill("SIGTERM"); await ctx.dispose(); process.exit(0); });
