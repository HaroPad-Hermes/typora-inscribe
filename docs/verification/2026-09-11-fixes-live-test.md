# Live verification protocol — fixes for the 2026-09-11 findings

**Written by:** the session that applied the fixes (author of commit `81a04a5`).
**For:** the session that produced `Inline Autocomplete — Findings 2026-09-11.md`.

> **Status of these fixes: unit-verified only.** The author never opened Typora.
> Every expectation below is derived from unit tests, source reading and your own
> report — the live run is yours. If a line you expect never appears, suspect the
> build (see §0) or an unreached path before suspecting the test.

---

## 0 — Confirm what you are testing (30 seconds, do this first)

| | |
|---|---|
| Build under test | `81a04a5` on `main` (includes your probe commit `1db4ecb`) |
| Bundle md5 | `b08ff8ea3e1c25ba284a3ba432171573` = `dist/index.js` |
| Installed | `C:\Program Files\Typora\resources\copilot\index.js` |
| Test doc | `C:\Users\HaroPad_\Documents\Typora Vault\Inline Autocomplete Test Document.md` — md5 `f70b02935edf7daf963fbb6adb83c9b9`, 2177 B, CRLF |
| Log | `%LOCALAPPDATA%\typora-inscribe\inscribe.log` |

```bash
md5sum "C:/Program Files/Typora/resources/copilot/index.js"     # expect b08ff8ea3e1c25ba284a3ba432171573
grep -o 'build [0-9a-f]\{7\}' "$LOCALAPPDATA/typora-inscribe/inscribe.log" | tail -1   # expect build 81a04a5
```

Two things to know, both **your** findings and both still true:

- A **new Typora window loads the freshly deployed bundle** — no restart, no relaunch.
- If the `[boot]` line says `build 1db4ecb` or `53065dc`, you are on an older bundle and
  every test below will look like a regression. Check this before anything else.
- Also read `apiKey=set` on that boot line; `MISSING` means nothing will ever call out.

Snapshot the test doc before destructive tests, and know your restore path:

```bash
cp "C:/Users/HaroPad_/Documents/Typora Vault/Inline Autocomplete Test Document.md" "$TEMP/testdoc.keep"
# restore, then: md5sum …  → expect f70b02935edf7daf963fbb6adb83c9b9
```

**F8 is your cheapest instrument.** `src/caret-probe.ts` runs the *same* derivation the
completion path runs, touches nothing, and calls no API. It logs
`[caret-probe] derived=… mdLen=…`. Use it for every caret-shape test (§2 T2, T3, T5, R1);
reserve real hotkey presses and API calls for the tests that need a completion.

---

## 1 — What changed, and what each change is for

| Finding | Now | File | Observable |
|---|---|---|---|
| 1 (high) table cell | A candidate that would break the table is **refused before it is offered** | `src/completions/structure.ts` (new), called from `src/completions/service.ts` | no ghost + `ghost refused: …` in the log |
| 2 fence trigger | The INPUT/TEXTAREA/SELECT guard no longer matches the editor's CodeMirror textarea | `src/keys/ui-input.ts` (new), `src/main.ts:713` | `manual hotkey pressed: …` appears for a fence keystroke |
| 3 fence mapping | Whitespace-insensitive match **locates** the fence, then the offset is **refused**, not guessed | `src/completions/caret.ts` | `block matched approximately — no rendered line separators, offset not derivable`, `derived=null` |
| 4 heading | A multi-line candidate at a heading is refused (heading = one line) | `src/completions/structure.ts` | `ghost refused: multi-line completion at a heading …` |
| 5 (high) ghost | The derivation no longer reads the plugin's own preview as document text; a stale tracked caret is validated against the markdown | `src/completions/preview-text.ts` (new), `src/completions/caret.ts`, `src/main.ts:663` | F8 with a ghost on screen returns the **same** caret as F8 with no ghost |
| 6 echo | **Not fixed.** `ECHO_MIN_SPAN = 12` still cannot catch a one-character echo | — | unchanged |

Deliberately **not** touched: the `echoesPrefix` guard (still the only protection on the
FIM path), and the FIM endpoint itself — a powered 450-call run already closed
`frequency_penalty`/`presence_penalty` as inert (commit `8a68ebc`).

---

## 2 — Test matrix

Each test states PASS and the **old symptom** so a fix is never mistaken for a regression.
Run T2 first: it is the most deterministic and it covers the other high-severity finding.

### T1 — table cell: no data loss (finding 1, high)

**Deterministic entry point:** the pipe case. With no suffix sent, a continuation inside a
row very often continues with `|`, and an unescaped pipe in a cell now refuses.

1. Caret inside a **body-row cell** of an existing table (reuse the exact cell that produced
   `| "sent" | "sentence" or "sent" |` in your report — that is the case this exists for).
2. Press the hotkey.

- **PASS:** either a normal single-line ghost (legal — the cell can hold it), or **no ghost**
  with one of:
  - `ghost refused: newline inside a table cell would start a new row and merge cells (data loss)`
  - `ghost refused: unescaped pipe inside a table cell would open a new column`
  and the table is **byte-identical** apart from what you typed (verify with md5).
- **FAIL (= old symptom):** the table is re-padded, two cells merge, or a cell's text is gone.
- **Do not score as FAIL:** "no suggestion offered". A refusal is the fix. A silent bad insert
  is what this removes.

Known gap, already documented in the module: a row written **without a leading pipe**, caret in
its first cell before any pipe has been typed, is not recognised as a cell and is **not**
guarded. If you hit that, it is a known limitation, not a new bug.

### T2 — the ghost must not corrupt the derivation (finding 5, high)

F8 only, no API call, fully deterministic.

1. Put the caret at the end of a paragraph line.
2. Press the hotkey and **leave the ghost on screen, undismissed** (do not press Escape).
3. Press **F8**.

- **PASS:** `[caret-probe] derived={"line":N,"character":M}` — the caret where your cursor
  actually is. Same answer as F8 with no ghost present.
- **FAIL (= old symptom):** `derived=null` while the ghost is visible, or a line/character
  that is off by the ghost's length. In your report this was markdown one `X`, DOM two,
  `derived=null`, then a completion built for the stale tracker position.

Also verify the second cause directly: at a line end, let the tracker hold a position one
character past the line, then press the hotkey. **PASS:** `trigger … caret=null source=tracked`
followed by `manual trigger: no caret position (derivation failed, tracker null)` — a visible
no-op. **FAIL (= old symptom):** a request built one character past the end of the line.

### T3 — the hotkey is alive inside a fence (finding 2)

1. Caret inside a ```` ``` ```` fence.
2. Press the hotkey.

- **PASS:** `manual hotkey pressed: <your hotkey>` appears in the log. Before this fix the
  guard returned *above* that line, so a fence keystroke left **no trace at all** — the mere
  presence of the line is the fix.
- **PASS, equally:** a following `caret=null` / `block matched approximately …` line and the ✦
  no-suggestion flash.
- **FAIL (= old symptom):** complete silence in the log for a fence keystroke.
- **Explicitly not claimed:** fences do not complete. The trigger runs and the derivation
  refuses honestly instead of dying silently.

### T4 — heading (finding 4)

1. Caret after `# ` on a heading line.
2. Press the hotkey.

- **PASS:** if the candidate carries a newline → no ghost +
  `ghost refused: multi-line completion at a heading — a heading is a single line`.
- **Also PASS:** a single-line ghost. A heading can hold one line.
- **Open, not a regression:** the model half of finding 4 — a two-character prompt answered with
  a Python file header at document start — is **not fixed**. At character 2 there is nothing to
  condition on. If you see junk again, it is a known open decision (minimum prefix length, or
  seeding the prompt with following text), so report it as *that*, not as this fix failing.

### T5 — fence caret is refused, not guessed (finding 3)

F8 only, deterministic.

1. Caret inside a fence.
2. Press **F8**.

- **PASS:** `deriveCaret TRACE: block matched approximately — no rendered line separators,
  offset not derivable` and `[caret-probe] derived=null`.
- **FAIL:** a `derived` caret with a plausible-looking but **wrong** line/character; or the old
  `block NO-MATCH … tag=FIGURE` with no mention of the fence.
- Rationale, so you can judge it: whitespace-insensitive matching locates the block, but a
  fence's indentation and line breaks are CSS, so squashing cannot recover the column. A
  confident wrong caret is the failure this derivation exists to remove, so it refuses.

### Regressions that must still hold

- **R1 — table cell mapping still works.** F8 inside a mapped cell →
  `deriveCaret TRACE: table mapped row=2 col=0 -> line=50 char=8`-shaped line. Your report's
  first PASS. This path is untouched; if it moved, it is a regression.
- **R2 — save safety.** Ghost visible → `Ctrl+S` → doc md5 unchanged; Escape/blur/`Ctrl+Cmd+S`
  tears the ghost down.
- **R3 — list items.** F8 at a list item never returns `derived=null` (your 12/12).
- **R4 — no stuck markers.** No orphaned `.inscribe-ghost` span after any refusal.

---

## 3 — Refusals that are fixes (do not score these as failures)

A test written against the old build will read these as "the feature stopped working". They are
the point of the change:

| You will now see | Instead of |
|---|---|
| no ghost in a table cell, with a `ghost refused: …` line | a merged cell / lost text |
| no ghost at a heading after a multi-line candidate | the rest of the document turned into heading text |
| `derived=null` inside a fence, with the approximate-match line | a nonsense completion built on an unmapped block, or silence |
| `caret=null` + `manual trigger: no caret position …` at a stale tracker | a request one character past the line |

---

## 4 — Known unguarded (report as open, not as new bugs)

1. **Finding 6, the one-character echo** — not fixed; `ECHO_MIN_SPAN = 12` cannot see it.
2. **Finding 4's model half** — a 2-character prompt can still produce junk.
3. A table row **without a leading pipe**, caret in its first cell — not recognised as a cell.
4. **Fence caret positions** — refused by design; a real fix needs the CodeMirror anchor.
5. FIM repetition in general — the penalty avenue is closed by measurement (`8a68ebc`).

---

## 5 — Log cookbook (exact strings)

```bash
LOG="$LOCALAPPDATA/typora-inscribe/inscribe.log"
tail -f "$LOG"                                                   # during a test session
grep -E 'ghost refused|block matched approximately|manual hotkey pressed|caret=|derived=' "$LOG"
grep -o 'build [0-9a-f]\{7\}' "$LOG" | tail -1                   # which bundle is live
grep '\[caret-probe\]' "$LOG"                                    # F8 output
grep -c 'ghost refused' "$LOG"                                   # refusals are not failures
```

| String | Means |
|---|---|
| `manual hotkey pressed: …` | the trigger ran (was unreachable in fences) |
| `trigger caret={…} source=dom` | derivation succeeded |
| `trigger caret=… source=tracked` | derivation failed, tracker used — check it was validated |
| `trigger caret=null …` | both refused — visible no-op, the safe outcome |
| `ghost refused: …` (3 variants) | structural guard fired — **expected**, not a bug |
| `block matched approximately …` | fence located, offset refused |
| `block NO-MATCH isCaret=false tag=FIGURE reason="…"` | table matcher did not map the figure |
| `deriveCaret TRACE: table mapped row=… col=…` | table cell mapping working |

---

## 6 — What to send back

Per finding: **PASS/FAIL**, the exact log excerpt (not a paraphrase), the test-doc md5 before and
after, and — for any FAIL — whether the boot line's build hash was `81a04a5`. The build hash
disambiguates "fix failed" from "fix never loaded", and that is the single most expensive
ambiguity in this loop.

---

## 7 — Housekeeping (this worktree is shared)

- The shared checkout at `C:\Users\HaroPad_\Documents\typora-inscribe` is on
  `probe/caret-cursor-log` @ `815f85c` (identical to `main`) — check with `git rev-parse --abbrev-ref HEAD`,
  not the hash, because the two branches point at the same commit and the checkout is not on `main`. Do not switch branches or `git checkout --` in it while another session is working;
  use a worktree (`git worktree add ../typora-inscribe-<name> <branch>`).
- Build **after** committing (`npm run build:dev` stamps the commit at rollup time), then
  `cp dist/index.js "C:/Program Files/Typora/resources/copilot/index.js"` — no elevation needed.
  Never `npm run build:release` (dies on `typroof`).
- One artifact, one owner: whoever deploys last wins the installed bundle. Check §0's md5 before
  blaming a code path.
- Gates, if you change anything: `npx tsc --noEmit -p tsconfig.build.json`;
  `npx eslint <changed files>` (`main.ts` is capped at **930 lines** — new logic goes in its own
  module); `npx vitest run`; `bash tools/check-invariants.sh`. Current state: 123 tests, lint 158
  (≤161), suppressions 25, sweep 12/12 PASS.
- **Never run `eslint --fix` / `prettier --write` over `src/completions` or `src/components`.**
  It reformats ~600 lines of pre-existing prettier debt in unrelated files and drops the lint
  count 161 → 72, which invalidates every ratchet number. It was reverted once already.
- **`eslint <file>` prints "1 problem" in the singular.** A grep for `[0-9]+ problems` silently
  reports 0 for any file with exactly one error — check the bare count, not a phrase.

---

## Post-run follow-up — what changed after this verification

The three new findings are handled as follows. This section is for whoever next touches
`caret.ts` or `preview-text.ts`.

**Finding B (the trace logged the raw read) — fixed.** `caretBlockText=` now prints the
preview-filtered text, the same string the matcher compares, so the log can no longer
disagree with what the code did.

**Finding C (one message for two causes) — fixed.** `noCaretReason(tracked, markdown)`
separates "the tracker never saw an edit" from "the tracked caret is past the end of its
line", and the log names which one fired. `validTrackedCaret` is a wrapper over
`trackedRefusal`.

**Finding A (the phantom leading `x `) — instrumented, not closed.** The root cause is not
identified, and guessing a filter is the confidently-wrong move this derivation exists to
prevent. So instead:

- every block read now excludes subtrees that cannot contribute rendered text — form
  controls (`TEXTAREA`/`INPUT`/`SELECT`, whose content is a *value*, which is what a fence's
  hidden input holds) and hidden elements (inline `display:none` / `visibility:hidden`,
  `[hidden]`, and computed styles, which covers a widget hidden by a class such as
  CodeMirror's measurement node). **The phantom may already be gone** — the class-based
  hide is exactly what the earlier build comparison suggested;
- a NO-MATCH now logs `html="…"` with the block's first 120 characters of HTML, so any
  surviving widget is identifiable **from the log alone**, no devtools needed (devtools are
  debug-gated and `--remote-debugging-port` crashes Typora 1.14.9);
- the suggested "tolerate a leading token / match on a suffix" was **not** taken. It makes
  matching guess, and a wrong block match is a wrong caret. If the phantom survives, the new
  `html=` field names the node and the rule can be extended for that actual node.

Unchanged and still true: the approximate branch is unreachable for a live fence caret (the
CodeMirror anchor is refused before matching), so T5's expected trace cannot appear and its
absence is **not** a regression. The fence path needs the CodeMirror anchor, not this path.

> Note the phantom is not necessarily a fence-only hazard: the exclusion applies to every
> block read, and the `html=` field is logged for every NO-MATCH.
