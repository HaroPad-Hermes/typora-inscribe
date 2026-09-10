# Constraints

Last reviewed: 2026-09-10 by @HaroPad

Scope: `typora-inscribe` — a Typora plugin (Electron renderer JS bundle), not a
web app. There is **no URL to hit**, so the usual web dimensions (Lighthouse,
axe-core, bundle-size-limit) are deliberately absent: a constraint with no
command that can run is an aspiration. The equivalent external opinion for this
project is the **live FIM API contract**, listed below.

## Floor (always enforced, no setup required)

- No **new** suppression comments: `@ts-ignore`, `@ts-expect-error`,
  `eslint-disable`, `ts-nocheck`, `istanbul ignore`. Existing ones are frozen by
  count in the ratchet table and itemised in Exceptions.
- No unimplemented stubs: `throw new Error("Not implemented")`, empty `catch {}`
  that turns a failure into silence.
- No skipped or deleted tests without the reason in the commit message.
- No secrets in source. The API key lives in Chromium localStorage, never in
  the repo.
- **No silent failure on the completion path.** A caret-derivation failure must
  produce a visible `✦ no suggestion`, never a quiet fall-through to a stale
  caret. *Reason: every "the completions are nonsense" report traced back to a
  stale-caret completion that looked coherent — the failure was invisible, so it
  was misdiagnosed as a model problem for three sessions.*
- This file does not get weakened to make a change pass.

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Types | Zero type errors | `npx tsc --noEmit -p tsconfig.build.json` | every edit (~8 s) |
| Lint | Zero errors **and** zero warnings | `npm run lint` (needs LF — see Known gaps) | every edit |
| Tests | All pass, none skipped | `npx vitest run` | every edit (~2 s) |
| Public type surface | `typroof` passes | `npm run test-types` (locally broken — see Known gaps) | CI |
| Build | Bundle rolls up clean | `npm run build:dev` | task end |
| Suppressions | Count ≤ **25**, never rises | `rg -c '@ts-ignore\|@ts-expect-error\|eslint-disable' src/` | task end |
| Changed-line coverage | ≥ **80 %** of lines a change touches | `npm run test:cov` + `git diff` | task end |
| Dependency risk (shipped) | Zero advisories in **runtime** deps | `npm audit --omit=dev` | CI |

*Changed-line coverage is 80 % rather than project coverage because project
coverage is inherited at 35 % and cannot be moved by this change; changed lines
are the only number an implementation can actually be held to.*

## Measured, not yet enforced (ratchets — must not get worse)

| Metric | Today | Direction |
|--------|-------|-----------|
| Project statement coverage | 35.26 % | must not fall |
| Project line coverage | 38.27 % | must not fall |
| **Completion-path coverage** | **0 %** — `main.ts`, `completions/*`, `providers/*`, `typora-utils.ts` are never imported by a test | must rise (Phase 1) |
| Suppression count | 25 across 12 files | must not rise |
| `src/main.ts` size | 1071 lines | must not grow — new completion logic goes in its own module |
| `BUILD` marker == `git rev-parse --short HEAD` | **FALSE** — marker frozen at `c0b2817`, HEAD `bcce35a` | must become true (P0.1) |
| `dist/index.js` md5 == installed md5 | TRUE (`5cb9e711…`) | must stay true |
| `derived=null` at list items, on the test doc | 0 (last live run: 12/12 derivations) | must stay 0 — currently verified only by hand, automated in Phase 4 |
| Dev-toolchain advisories | 29 (17 high, 3 critical) — **dev-only** | must not rise |

*The split matters. All 29 advisories live in build tooling (vite via vitest,
svgo, a dev copy of ws, yaml) and none of them can reach `dist/index.js`; a
plain `npm audit` gate would fail on day one and teach everyone to ignore it.
`npm audit fix` is available but touches the toolchain mid-port, so the count is
ratcheted instead of the toolchain being upgraded under a project that is
currently green.*

## Known environment gaps (fix these or the gates above are not trustworthy)

| Gap | Evidence | Fix | Status |
|-----|----------|-----|--------|
| **CRLF breaks lint on every Windows checkout** | `core.autocrlf=true`, no `.gitattributes`, `prettier.config.cjs` sets no `endOfLine` (defaults to `lf`) → `npm run lint` → **6044 errors**, nearly all `Delete ␍`. CI passes because Ubuntu checks out LF. | Add `.gitattributes` with `* text=auto eol=lf`, set `core.autocrlf=false`, re-checkout | open — P0.4 |
| **`typroof` fails locally** | `npm run test-types` → `Error: Cannot find module symbol for ".../typroof/assertions/assert.d.ts"` on Node v24.13.0. The file is LF, so it is not the CRLF issue. | Confirm CI's `test-types` job is actually green; if it is, this is a local Node-version gap and the gate lives in CI only. Otherwise it is a genuine exception. | open — P0.5 |

*The CRLF item is not cosmetic housekeeping. An LF/CRLF mismatch between
`editor.getMarkdown()` and the change-event payload was the root cause of the
tracker-nulling bug fixed in `df9ac20` — every keystroke diffed as a multi-hunk
change. Normalising the repo to LF removes that entire class of failure rather
than re-fixing it per bug.*

## Exceptions

| ID | Rule | Path | Reason | Owner | Expires |
|----|------|------|--------|-------|---------|
| E1 | `@ts-expect-error` | `src/main.ts:287` | CodeMirror accepts a 2nd parameter that `@types/codemirror` does not declare | @HaroPad | 2026-12-09 |
| E2 | `@ts-expect-error` | `src/components/SuggestionPanel.tsx:107` | Prop extracted from Typora internals; upstream undocumented and unversioned | @HaroPad | 2026-12-09 |
| E3 | `react-hooks/exhaustive-deps` (×9) | `src/components/ChatPanel.tsx` | Intentional — deps narrowed to avoid re-subscribing the stream on every render | @HaroPad | 2026-12-09 |
| E4 | File-level `eslint-disable` | `src/typora-utils.ts:1`, `src/global.d.ts:8-9` | Typora's own globals and unbound-method pattern; file-scoped by design | @HaroPad | 2026-12-09 |
| E5 | Line-level `eslint-disable` | `src/modules/fs.ts`, `src/patches/promise.ts`, `src/utils/random.ts`, `src/client/chat.ts`, `src/components/*.tsx` | Narrow, individually commented suppressions carried from the upstream fork | @HaroPad | 2026-12-09 |

Exception lifetime is the 90-day default, and it is a real deadline: `E1`–`E5`
are inherited from the upstream fork and nobody is going to fix them by
Christmas, so the date exists to force a **decision** — fix, keep with a new
reason, or delete the suppression — not to be renewed on autopilot.

## Where the external opinion comes from

A bar checked only by this project's own tests proves only that the code agrees
with itself. Two checks here are outside it:

- `npm audit --omit=dev` — reads an external advisory database, scoped to what
  actually ships.
- **The live FIM contract probe.** The FIM spacing rule (leading whitespace in
  the raw response *is* the word-boundary signal: `/^\s/` → prepend one space,
  else attach) is a model behaviour, not a code property. It is verified by
  probing `https://api.deepseek.com/beta/completions` with a fixed matrix at
  temperature 0.5 and asserting 5/5 determinism.

*The probe costs tokens, so it runs at **review**, not per edit. If it ever
disagrees with the unit tests in `src/completions/normalize.ts`, the probe wins
and the unit tests encode the wrong assumption.*
