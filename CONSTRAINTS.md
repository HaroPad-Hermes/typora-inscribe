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
- **No silent failure on the completion path.** Every block the editor renders —
  paragraph, heading, list item, **code fence** — must be mappable by the caret
  derivation. A block that cannot be mapped must log `block NO-MATCH` naming its
  tag, and a trigger must not reuse a caret the derivation rejected without
  saying so. *Reason: every "the completions are nonsense" report traced back to
  a stale-caret completion that looked coherent. A fenced block could not map,
  the trigger fell through to a stale tracker, and the failure was invisible — so
  it was misdiagnosed as a model problem for three sessions. Fixed in P0.3.*
- This file does not get weakened to make a change pass.

## Enforced with numbers

| Dimension | Rule | Checked by | Runs at |
|-----------|------|-----------|---------|
| Types | Zero type errors | `npx tsc --noEmit -p tsconfig.build.json` | every edit (~8 s) |
| Lint (changed files) | Zero errors on the files a change touches | `npx eslint <changed files>` | every edit |
| Tests | All pass, none skipped | `npx vitest run` | every edit (~2 s) |
| Public type surface | `typroof` passes | `npm run test-types` | not enforceable yet — see Known gaps |
| Build | Bundle rolls up clean | `npm run build:dev` | task end |
| Suppressions | Count ≤ **25**, never rises | `rg -c '@ts-ignore\|@ts-expect-error\|eslint-disable' src/` | task end |
| Changed-line coverage | ≥ **80 %** of lines a change touches | `npm run test:cov` + `git diff` | task end |
| Dependency risk (shipped) | Zero advisories in **runtime** deps | `npm audit --omit=dev` | task end |

*Changed-line coverage is 80 % rather than project coverage because project
coverage is inherited at 35 % and cannot be moved by this change; changed lines
are the only number an implementation can actually be held to.*

## Measured, not yet enforced (ratchets — must not get worse)

| Metric | Today | Direction |
|--------|-------|-----------|
| Project statement coverage | 43.88 % (was 35.26 % before P1.1) | must not fall |
| Project line coverage | 46.51 % (was 38.27 %) | must not fall |
| **Completion-path coverage** | `completions/caret.ts` **76.99 % lines / 100 % funcs** — was 0 %. `main.ts`, `providers/*`, `typora-utils.ts` still 0 % | must rise |
| Suppression count | 25 across 12 files | must not rise |
| Repo-wide lint errors | **190** (was 6044 — P0.4 removed the CRLF noise) | must not rise; burn-down is its own task on its own branch |
| `src/main.ts` size | **915** lines (was 1071 — P1.1 moved 156 lines to `completions/caret.ts`) | must not grow — new completion logic goes in its own module |
| `BUILD` marker == the commit the bundle was built from | **TRUE** — stamped at rollup time; verified across two builds (P0.1). Rebuild and redeploy after any commit touching `src/` or `rollup.config.ts` — not for docs-only commits, which cannot change the bundle. | must stay true |
| `dist/index.js` md5 == installed md5 | TRUE — re-verified after each deploy | must stay true |
| `derived=null` on the test doc | 0 at list items (last live run 12/12); **code fences now map too** (P0.3, unit-covered) | must stay 0 — live run still hand-verified until Phase 4 |
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
| **CRLF breaks lint on every Windows checkout** | `core.autocrlf=true`, no `.gitattributes`, `prettier.config.cjs` sets no `endOfLine` (defaults to `lf`) → `npm run lint` → **6044 errors**, nearly all `Delete ␍`. | `.gitattributes` with `* text=auto eol=lf` + `core.autocrlf=false` + forced re-checkout. **Commit before running it** — the re-checkout is `git rm --cached -r . && git reset --hard`, which silently discards uncommitted edits (it ate an edit of this very file). | **DONE — P0.4.** 6044 → 190; the remaining 190 are unrelated to EOL |
| **CI has never executed** | `gh api repos/HaroPad-Hermes/typora-inscribe/actions/runs --jq .total_count` → **0**, while `actions/permissions` reports `enabled: true`. The workflow file exists and has never once run, so every "Runs at: CI" gate in this file was aspirational. | Either confirm the workflow triggers on a real push, or drop "CI" as a stage and run those checks locally | open — P0.5 |
| **`typroof` fails locally** | `npm run test-types` → `Error: Cannot find module symbol for ".../typroof/assertions/assert.d.ts"`. typroof 0.6.0 declares Node ≥20 and this is Node v24.13.0, so it is a typroof/TypeScript-5.9 incompatibility, not a Node gate; the file it chokes on is LF, so it is not the CRLF issue either. | Pin the TypeScript version typroof expects, or record a real exception. It cannot be parked in CI — see the row above. | open — P0.5 |

*Consequence for P0.5: `typroof` cannot be parked in CI, because there is no CI.
It has to be resolved locally — fix the tool, pin the TypeScript version it
expects, or record it as an exception with a real owner.*

*Why this matters beyond lint: an LF/CRLF mismatch is this project's recurring
failure shape. The tracker-nulling bug (`df9ac20`) was the same mismatch, but at
**runtime** — `editor.getMarkdown()` and the change-event payload disagreed on
EOL, so every keystroke diffed as a multi-hunk change; that one was fixed by
normalising inside `computeTextChanges` and is a separate fix. Source-file EOLs
are the other instance: they cannot affect runtime behaviour, but they make every
diff noisy and accounted for 5854 of the 6044 lint errors. One canonical EOL
removes the source-side half of the pattern.*

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
