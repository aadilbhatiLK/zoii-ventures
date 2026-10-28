import type { Deps } from "./lib/context";

/** Background jobs (automation engine, scheduled scans, outbox). Filled in by later modules. */
export function startWorker(deps: Deps) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { runWorkerOnce } = await import("./modules/automation/engine");
      await runWorkerOnce(deps);
    } catch (e) {
      console.error("[worker]", (e as Error).message);
    } finally {
      running = false;
    }
  };
  const t = setInterval(tick, deps.config.workerIntervalMs);
  t.unref();
  return { stop: () => clearInterval(t), tick };
}
