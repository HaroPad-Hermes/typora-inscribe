// Local stand-ins for the (removed) Copilot LSP types.
export interface LspPosition {
  line: number;
  character: number;
}
export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}
export type EOL = "\n" | "\r\n";
export type ReadonlyRecord<K extends PropertyKey, V> = Readonly<Record<K, V>>;
export type integer = number;
export type Merge<F, S> = Omit<F, keyof S> & S;
export type _Id<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

/** JSON-RPC error code names (used by the logger). */
export const getErrorCodeName = (code: integer): string | null => {
  const names: Record<number, string> = {
    [-32700]: "ParseError",
    [-32600]: "InvalidRequest",
    [-32601]: "MethodNotFound",
    [-32602]: "InvalidParams",
    [-32603]: "InternalError",
    [-32000]: "ServerNotInitialized",
    [-32001]: "UnknownErrorCode",
    [-32002]: "RequestFailed",
    [-32003]: "ServerCancelled",
    [-32004]: "ContentModified",
    [-32099]: "RequestCancelled",
  };
  return names[code] ?? null;
};

/**
 * Assert that the value is never (i.e., this statement should never be reached).
 * @param value The value to assert.
 */
export const assertNever = (value: never): never => {
  throw new Error(`Unexpected value: ${JSON.stringify(value)}`);
};

/**
 * Omit keys from an object
 * @param obj The object to omit keys from.
 * @param keys The keys to omit.
 * @returns
 *
 * @example
 * ```javascript
 * omit({ a: 1, b: 2, c: 3 }, "a"); // => { b: 2, c: 3 }
 * omit({ a: 1, b: 2, c: 3 }, "a", "c"); // => { b: 2 }
 * ```
 */
export const omit = <O extends ReadonlyRecord<PropertyKey, unknown>, KS extends (keyof O)[]>(
  obj: O,
  ...keys: KS
): Omit<O, KS[number]> extends infer U ? { [K in keyof U]: U[K] } : never => {
  const result: Record<PropertyKey, unknown> = {};
  for (const key in obj) if (!keys.includes(key)) result[key] = obj[key];
  return result as never;
};

/**
 * A stricter version of {@linkcode Object.keys} that makes TS happy.
 * @param obj The object to get keys from.
 * @returns
 */
export const keysOf = <O extends object>(obj: O): readonly `${keyof O & (string | number)}`[] =>
  Object.keys(obj) as readonly `${keyof O & (string | number)}`[];

/**
 * A stricter version of {@linkcode Object.values} that makes TS happy.
 * @param obj The object to get values from.
 * @returns
 */
export const valuesOf = <O extends object>(obj: O): readonly O[keyof O][] =>
  Object.values(obj) as readonly O[keyof O][];

/**
 * A stricter version of {@linkcode Object.entries} that makes TS happy.
 * @param obj The object to get entries from.
 * @returns
 */
export const entriesOf = <O extends object>(
  obj: O,
): O extends O ? readonly (readonly [`${keyof O & (string | number)}`, O[keyof O]])[] : never =>
  Object.entries(obj) as unknown as O extends O ?
    readonly (readonly [`${keyof O & (string | number)}`, O[keyof O]])[]
  : never;

export const isKeyOf = <O extends object>(obj: O, key: PropertyKey): key is keyof O => key in obj;

/**
 * Get a global variable.
 * @param name The name of the global variable.
 * @returns The value of the global variable.
 */
export const getGlobalVar = <K extends keyof typeof globalThis | (string & NonNullable<unknown>)>(
  name: K,
): K extends keyof typeof globalThis ? (typeof globalThis)[K] : unknown => {
  try {
    return global[name as keyof typeof globalThis];
  } catch {
    return globalThis[name as keyof typeof globalThis];
  }
};
/**
 * Set a global variable.
 * @param name The name of the global variable.
 * @param value The value of the global variable to set.
 */
export const setGlobalVar = <K extends keyof typeof globalThis | (string & NonNullable<unknown>)>(
  name: K,
  value: K extends keyof typeof globalThis ? (typeof globalThis)[K] : unknown,
) => {
  try {
    Object.defineProperty(global, name, { value });
  } catch {
    Object.defineProperty(globalThis, name, { value });
  }
};

/**
 * Replace `text` in `range` with `newText`.
 * @param text The text to replace.
 * @param range The range to replace.
 * @param newText The new text.
 * @param eol The end of line character. Defaults to `"\n"`.
 * @returns
 */
export const replaceTextByRange = (
  text: string,
  range: LspRange,
  newText: string,
  eol: EOL = "\n",
) => {
  const { end, start } = range;
  const lines = text.split(eol);
  const startLine = lines[start.line]!;

  if (start.line === end.line)
    return [
      ...lines.slice(0, start.line),
      startLine.slice(0, start.character) + newText + startLine.slice(end.character),
      ...lines.slice(end.line + 1),
    ].join(eol);

  const endLine = lines[end.line]!;
  // The span is REPLACED: its middle lines go, and the tail of the last line
  // joins the replacement directly. Keeping the middle lines and emitting the
  // tail as its own array element left both the discarded text and a spurious
  // newline (replacing "on|two|o" with "X" produced "onX\no" for "onXo").
  return [
    ...lines.slice(0, start.line),
    startLine.slice(0, start.character) + newText + endLine.slice(end.character),
    ...lines.slice(end.line + 1),
  ].join(eol);
};
