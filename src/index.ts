import "./patches";

import "./main";

import { attachCaretProbe } from "./caret-probe";

/* Diagnostic cursor readout (F8). Attached from the entry so the line-capped,
 * untestable main.ts stays untouched — see CONSTRAINTS.md on main.ts size. */
attachCaretProbe();
