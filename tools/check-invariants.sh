#!/usr/bin/env bash
# typora-inscribe invariant sweep.
#
# Evaluates the ratchet table in CONSTRAINTS.md as PASS/FAIL. This is the
# VERIFIER, not a fixer: it never edits source, never updates a threshold, and
# never touches CONSTRAINTS.md. A checker that can reach green by moving its own
# bar is not a checker — that is the documented failure mode of autonomous
# hardening loops, and the whole reason this file is read-only.
#
# Thresholds are hardcoded HERE rather than parsed from CONSTRAINTS.md, so that
# raising one is a visible diff in a reviewed file. Raising one should be a
# deliberate act with a commit message, never a side effect of a run.
#
# Implementation notes (each learned the hard way — do not "simplify" them back):
#   * The lint baseline is `eslint src` = 161. `eslint .` = 167 because it also
#     lints config files outside src/. Scope mismatch here reads as a regression
#     that does not exist.
#   * CRLF is detected with file(1). `grep -rl $'\r' src/` reports 72 files on a
#     tree file(1) says is pure LF — a pure false positive in git-bash.
#   * Output is parsed as TEXT, never as JSON into a temp file: mktemp -d returns
#     an MSYS path (/tmp/...) that native node cannot open, which silently turned
#     every JSON-parsed gate into a false FAIL.
#
# Usage: bash tools/check-invariants.sh [--fast]
#   --fast   skip the slow gates (repo-wide eslint, npm audit)
# Exit:  0 = no regression, 1 = at least one invariant failed, 2 = could not run.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

FAST=0
[ "${1:-}" = "--fast" ] && FAST=1

# --- thresholds, mirrored from CONSTRAINTS.md "Enforced with numbers" ---------
MAX_SUPPRESSIONS=25          # must not rise
MAX_LINT_ERRORS=161          # must not rise; measured as `eslint src`
MAX_MAIN_LINES=930           # must not grow; new logic goes in its own module
MAX_DEV_ADVISORIES=29        # dev-only; must not rise
INSTALLED="C:/Program Files/Typora/resources/copilot/index.js"

FAILED=0
ok()   { printf '  PASS  %-24s %s\n' "$1" "$2"; }
bad()  { printf '  FAIL  %-24s %s\n' "$1" "$2"; FAILED=1; }
skip() { printf '  SKIP  %-24s %s\n' "$1" "$2"; }
info() { printf '  ..    %-24s %s\n' "$1" "$2"; }

echo "typora-inscribe invariants"
echo "  HEAD $(git rev-parse --short HEAD)  |  $(date '+%Y-%m-%d %H:%M')  |  node $(node --version)"
echo

# --- floor: no secret ever reaches the repo -----------------------------------
KEYS=$(rg -l 'sk-[A-Za-z0-9]{20,}' src/ 2>/dev/null)
[ -z "$KEYS" ] && ok secrets "none in src/" || bad secrets "API KEY PATTERN IN src/: $KEYS"

# --- the project's recurring failure shape: CRLF in source --------------------
CRLF=$(find src -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.scss' \) -print0 \
        | xargs -0 file | grep -c 'CRLF')
[ "$CRLF" = "0" ] && ok crlf "0 CRLF files (file(1))" \
                  || bad crlf "$CRLF file(s) with CRLF terminators"

# --- types --------------------------------------------------------------------
TSC_OUT=$(npx tsc --noEmit -p tsconfig.build.json 2>&1)
if [ -z "$TSC_OUT" ]; then
  ok types "0 errors"
else
  bad types "$(echo "$TSC_OUT" | grep -c 'error TS') error(s): $(echo "$TSC_OUT" | grep 'error TS' | head -1)"
fi

# --- tests --------------------------------------------------------------------
# NO_COLOR + an explicit ANSI strip: vitest colourises the number ("Tests  \e[32m37
# passed\e[39m"), which made the summary line unparseable and turned a failing
# suite into a silent "could not parse".
VITEST_OUT=$(NO_COLOR=1 CI=1 npx vitest run 2>&1 | sed -E 's/\x1b\[[0-9;]*[A-Za-z]//g')
TESTS_LINE=$(echo "$VITEST_OUT" | grep -oE 'Tests +[0-9]+ passed \([0-9]+\)' | tail -1 | tr -s ' ')
if echo "$VITEST_OUT" | grep -qE 'Tests +[0-9]+ failed'; then
  bad tests "FAILING: $(echo "$VITEST_OUT" | grep -oE 'Tests +[0-9]+ failed[^(]*' | tail -1 | tr -s ' ')"
elif [ -n "$TESTS_LINE" ]; then
  ok tests "$TESTS_LINE"
else
  bad tests "no parseable summary — the gate is blind, treat as failure"
fi

# --- floor: no skipped tests without a reason ---------------------------------
SKIPS=$(rg -l '\.skip\(|\.todo\(' src/ --glob '*.spec.ts' 2>/dev/null)
[ -z "$SKIPS" ] && ok "no skipped tests" "0 skip/todo markers" \
                || bad "no skipped tests" "marker(s) in: $SKIPS — reason must be in the commit message"

# --- suppressions ratchet -----------------------------------------------------
SUPP=$(rg -c '@ts-ignore|@ts-expect-error|eslint-disable|ts-nocheck|istanbul ignore' src/ 2>/dev/null \
       | awk -F: '{s+=$2} END {print s+0}')
if [ "$SUPP" -le "$MAX_SUPPRESSIONS" ]; then
  ok suppressions "$SUPP (max $MAX_SUPPRESSIONS)"
else
  bad suppressions "$SUPP exceeds $MAX_SUPPRESSIONS — the bar does not move to pass a change"
fi

# --- main.ts size ratchet -----------------------------------------------------
MAIN_LINES=$(wc -l < src/main.ts | tr -d ' \r')
if [ "$MAIN_LINES" -le "$MAX_MAIN_LINES" ]; then
  ok main.ts "$MAIN_LINES lines (max $MAX_MAIN_LINES)"
else
  bad main.ts "$MAIN_LINES lines exceeds $MAX_MAIN_LINES — extract a module"
fi

# --- BUILD stamp == the commit the bundle was built from ----------------------
EXPECTED_SHA="$(git log -1 --format=%h -- src rollup.config.ts)"
if [ ! -f dist/index.js ]; then
  bad "build stamp" "dist/index.js missing — never built, or cleaned"
elif grep -q '__BUILD_SHA__' dist/index.js; then
  bad "build stamp" "placeholder left in dist — the rollup stamp plugin did not run"
elif grep -q "$EXPECTED_SHA" dist/index.js; then
  ok "build stamp" "$EXPECTED_SHA == latest src/ commit"
else
  bad "build stamp" "bundle is from a different commit than $EXPECTED_SHA (docs-only commits need no rebuild; src/ commits do)"
fi

# --- dist == installed --------------------------------------------------------
if [ ! -f "$INSTALLED" ]; then
  bad deploy "installed bundle not found at $INSTALLED"
else
  A=$(md5sum dist/index.js | cut -d' ' -f1)
  B=$(md5sum "$INSTALLED" | cut -d' ' -f1)
  if [ "$A" = "$B" ]; then
    ok deploy "dist md5 == installed (${A:0:12})"
  else
    bad deploy "STALE DEPLOY — dist ${A:0:12} vs installed ${B:0:12}; rebuild + elevated copy"
  fi
fi

# --- slow gates ---------------------------------------------------------------
if [ "$FAST" = "1" ]; then
  skip lint "--fast"
  skip "runtime advisories" "--fast"
  skip "dev advisories" "--fast"
else
  LINT=$(npx eslint src 2>&1 | grep -oE '[0-9]+ problems' | head -1 | grep -oE '[0-9]+')
  if [ -z "$LINT" ]; then
    ok lint "0 repo-wide errors in src/"
  elif [ "$LINT" -le "$MAX_LINT_ERRORS" ]; then
    ok lint "$LINT errors in src/ (max $MAX_LINT_ERRORS)"
  else
    bad lint "$LINT errors in src/ exceeds $MAX_LINT_ERRORS — it must not rise"
  fi

  RUNTIME_ADV=$(npm audit --omit=dev 2>&1 | grep -oE 'found [0-9]+' | grep -oE '[0-9]+' | head -1)
  if [ "${RUNTIME_ADV:-0}" = "0" ]; then
    ok "runtime advisories" "0 in shipped deps"
  else
    bad "runtime advisories" "${RUNTIME_ADV:-unknown} in RUNTIME deps — this one gates the build"
  fi

  DEV_ADV=$(npm audit 2>&1 | grep -oE '^[0-9]+ vulnerabilities?' | grep -oE '^[0-9]+' | head -1)
  if [ -z "$DEV_ADV" ]; then
    ok "dev advisories" "0 total"
  elif [ "$DEV_ADV" -le "$MAX_DEV_ADVISORIES" ]; then
    ok "dev advisories" "$DEV_ADV total incl. dev toolchain (max $MAX_DEV_ADVISORIES)"
  else
    bad "dev advisories" "$DEV_ADV exceeds $MAX_DEV_ADVISORIES"
  fi
fi

# --- what this script CANNOT check (stated, not implied) ----------------------
DIRTY=$(git status --porcelain | wc -l | tr -d ' \r')
info "working tree" "$DIRTY uncommitted file(s) — informational, never a failure"
info "NOT COVERED" "live-plugin behaviour: derived=null on the test doc, ghost"
info "NOT COVERED" "  save-safety, table mapping, z-order — need Typora open"
info "NOT COVERED" "  and a human eye. Coverage ratchets and typroof also excluded."

echo
if [ "$FAILED" = "0" ]; then
  echo "RESULT: PASS — no invariant regressed"
else
  echo "RESULT: FAIL — at least one invariant regressed (report-only; nothing was changed)"
fi
exit "$FAILED"
