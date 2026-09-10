import { describe, expect, it } from "vitest";

import { ECHO_MIN_SPAN, computeGhost, echoesPrefix } from "./flow";

/**
 * These fixtures are the REAL values from the 2026-09-10 live run, in which the
 * suggestion panel showed a "completion" that was a verbatim repeat of the
 * paragraph the user had just written.
 *
 * `continuationWindow` windows the prompt to the last two lines before the
 * caret, so this is exactly the text the FIM endpoint was given.
 */
const WINDOW =
  "coverage is inherited at 35 % and cannot be moved by this change; changed lines\n" +
  "are the only number an implementation can actually be held to.*";

const ECHOED = "coverage is inherited at 35 % and cannot be moved by this change; changed lines";

describe("echoesPrefix", () => {
  it("rejects the completion that was actually echoed in the live run", () => {
    expect(echoesPrefix(ECHOED, WINDOW)).toBe(true);
  });

  it("accepts a genuine continuation of the same prefix", () => {
    expect(echoesPrefix("Send the change back for a smaller edit.", WINDOW)).toBe(false);
  });

  it("ignores overlaps shorter than the minimum span", () => {
    expect(echoesPrefix("changed", WINDOW)).toBe(false);
    expect(ECHO_MIN_SPAN).toBeGreaterThan("changed".length);
  });

  it("matches across whitespace and case differences", () => {
    expect(echoesPrefix("  CHANGED   LINES are the only number", WINDOW)).toBe(true);
  });
});

describe("computeGhost echo guard", () => {
  it("returns null instead of showing the echoed paragraph", async () => {
    const ghost = await computeGhost(WINDOW, "sys", {
      continueText: () => Promise.resolve(ECHOED),
    });
    expect(ghost).toBeNull();
  });

  it("still returns a genuine continuation", async () => {
    const ghost = await computeGhost(`${WINDOW} `, "sys", {
      continueText: () => Promise.resolve("Send the change back for a smaller edit."),
    });
    expect(ghost).toBe("Send the change back for a smaller edit.");
  });

  it("logs the rejection, so it is not a silent failure", async () => {
    const seen: string[] = [];
    await computeGhost(WINDOW, "sys", {
      continueText: () => Promise.resolve(ECHOED),
      log: (m) => seen.push(m),
    });
    expect(seen.some((m) => m.includes("echo"))).toBe(true);
  });
});
