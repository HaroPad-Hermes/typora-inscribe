import "./patches";

import "./main";

import { attachCaretProbe } from "./caret-probe";
import { attachSelectionActions } from "./selection/host";

/* Diagnostic cursor readout (F8). Attached from the entry so the line-capped,
 * untestable main.ts stays untouched — see CONSTRAINTS.md on main.ts size. */
attachCaretProbe();

/* Selection actions (Rewrite / Shorten). Attached here for the same reason as
 * the probe: `main.ts` is line-capped, and this is a surface, not completion
 * logic. */
attachSelectionActions();
