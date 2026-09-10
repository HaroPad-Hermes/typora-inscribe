# AGENTS.md

Read `CONSTRAINTS.md` before writing code. Do not weaken it to make a change pass.

## Project

`typora-inscribe` — a Typora plugin porting the Inscribe autocomplete/doc-agent
feature set. Plain JS bundle injected into `C:\Program Files\Typora\resources\window.html`;
bundle output is `dist/index.js`, deployed to `resources\copilot\`.

## Commands

| Task | Command |
|------|---------|
| Typecheck | `npx tsc --noEmit -p tsconfig.build.json` |
| Lint | `npm run lint` |
| Tests | `npx vitest run` |
| Coverage | `npm run test:cov` |
| Build (manual, use this) | `npm run build:dev` |
| Deploy | `Copy-Item dist/* "C:\Program Files\Typora\resources\copilot\"` — no elevation needed after the `icacls` grant |

**Do not use `npm run build:release`** — it runs `typroof` and dies with
"Cannot find module symbol".

## Rules that are specific to this project

- **Diagnose with `inscribe.log`, not the devtools console.** Devtools are
  debug-gated in production and `--remote-debugging-port` crashes Typora 1.14.9.
  Log via `src/diag.ts` (`reqnode("fs").appendFileSync`).
- **Check the deployed hash before debugging a "regression".** A stale bundle has
  caused this twice. `md5sum dist/index.js` vs the installed `index.js`, and read
  the boot line to see which build actually ran.
- **Never silently fall back to a stale caret.** See the floor in `CONSTRAINTS.md`.
- `main.ts` is 1071 lines and untestable by construction. Put new logic in its
  own module with a spec; do not grow `main.ts`.
