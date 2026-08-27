/* Crash-safe diagnostic logger for Typora Inscribe.
 * Writes synchronously via Typora's `reqnode("fs")` hook so the log
 * survives even a hard crash of the renderer. */
const DIAG_PATH = (() => {
  try {
    const env = (window.process?.env ?? {}) as Record<string, string | undefined>;
    const base = env.LOCALAPPDATA || env.APPDATA || "";
    return base ? `${base}\\typora-inscribe\\inscribe.log` : "";
  } catch {
    return "";
  }
})();

export const diagLog = (msg: string): void => {
  if (!DIAG_PATH) return;
  try {
    // NOTE: `reqnode` is a FUNCTION (reqnode("fs")), not an object with .fs.
    const reqnode: any = (window as any).reqnode;
    const fsmod = typeof reqnode === "function" ? reqnode("fs") : null;
    if (fsmod?.appendFileSync) {
      fsmod.appendFileSync(DIAG_PATH, `[${new Date().toISOString()}] ${msg}\n`);
    } else if (fsmod?.writeFileSync) {
      // fallback: read+append (slower, but works if append is unavailable)
      let prev = "";
      try {
        prev = fsmod.readFileSync(DIAG_PATH, "utf-8");
      } catch {
        /* first write */
      }
      fsmod.writeFileSync(DIAG_PATH, prev + `[${new Date().toISOString()}] ${msg}\n`);
    }
  } catch {
    /* never crash the editor on a logging failure */
  }
};
