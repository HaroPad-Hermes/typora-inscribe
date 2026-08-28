import * as path from "@modules/path";

import { TYPORA_RESOURCE_DIR } from "./typora-utils";
import { setGlobalVar } from "./utils/tools";

/**
 * Plugin version.
 */
export const VERSION = "0.1.0";
export const BUILD = "c0b2817";

/**
 * Inscribe plugin directory.
 */
export const PLUGIN_DIR = path.join(TYPORA_RESOURCE_DIR, "copilot");
setGlobalVar("__copilotDir", PLUGIN_DIR);