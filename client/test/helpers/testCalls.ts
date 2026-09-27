/**
 * Reads a test file's source for the calls that declare tests, suites and hooks,
 * with each one's time limit, tags and clock reads, and for the waits and config
 * calls that carry a time limit of their own. The architecture test uses it to
 * hold two rules over every client test file: time limits go through
 * `timeLimit`, and the `wall-clock` tag sits on exactly the tests that assert on
 * a clock reading. Parsed with the TypeScript compiler, not a regex, so a limit
 * on the line after its callback, or a suite's limit kept in a const, is still
 * found.
 *
 * It reads one file at a time and follows names only to consts declared in that
 * file. What it cannot see is listed where each rule is stated, in
 * architecture.test.ts.
 */
import { dirname, relative } from "node:path";
import ts from "typescript";

const TESTS = new Set(["it", "test"]);
const SUITES = new Set(["describe", "suite"]);
const HOOKS = new Set(["beforeAll", "afterAll", "beforeEach", "afterEach"]);
/** Chained modifiers that return the same call shape: `it.skip(...)`, `describe.concurrent(...)`. */
const MODIFIERS = new Set(["skip", "only", "todo", "concurrent", "sequential", "shuffle", "fails"]);
/** Chained factories whose result is then called: `it.each(table)(...)`, `it.skipIf(c)(...)`. */
const FACTORIES = new Set(["each", "for", "skipIf", "runIf"]);
/** Waits that give up after a limit of their own: vitest's default for both is 1 s, unscaled. */
const WAITS = new Set(["vi.waitFor", "vi.waitUntil", "expect.poll"]);

/** Where a limit is written, and what to write there instead when it is bare. */
export type Limit =
  /** No limit at the call: a test or suite inherits its suite's, else the config default. */
  | { kind: "none" }
  /** `timeLimit(<ms>)`, directly or through a const in this file. */
  | { kind: "scaled"; text: string; line: number }
  /** Anything else: a bare number, a const holding one, arithmetic. `fix` is what to write at `line`. */
  | { kind: "bare"; text: string; line: number; fix: string }
  /** A trailing limit after an options object: vitest ignores it. */
  | { kind: "ignored"; text: string; line: number };

export interface TestCall {
  kind: "test" | "suite" | "hook" | "wait" | "config";
  /** it, describe, beforeAll, vi.waitFor, vi.setConfig, ... as written. */
  callee: string;
  /** The title, with any `${...}` in a template title kept as written. */
  title: string;
  line: number;
  /** One per limit the call carries: `vi.setConfig` can carry two. */
  limits: Limit[];
  /** Tags written on this call's options object. */
  tags: string[];
  /** Tags from this call and every suite around it. */
  inheritedTags: string[];
  /** Lines of clock reads inside this call's own callback (tests only). */
  clockReads: number[];
  /** A clock is read in an enclosing suite's body or hooks, outside any test. */
  suiteReadsClock: boolean;
}

export interface StrayClockRead {
  line: number;
  /** Tags of the suites around the read. */
  tags: string[];
}

export interface FileScan {
  calls: TestCall[];
  /** Clock reads inside no test's callback: in a suite body, a hook, or at top level. */
  strayClockReads: StrayClockRead[];
}

/** The last segment of a dotted receiver, without optional chaining: `globalThis.performance` → `performance`. */
function lastSegment(text: string): string {
  return text.replace(/\?/g, "").split(".").pop() ?? "";
}

export function scanTestSource(fileName: string, source: string): FileScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  // Names bound at any depth in this file: consts (for limits, options and
  // tags kept in them), and aliases of vitest's own names and of the clocks.
  const consts = new Map<string, ts.Expression>();
  const vitestNames = new Map<string, string>();
  const vitestNamespaces = new Set<string>();
  const clockReceivers = new Set(["performance", "Date"]);
  const clockFunctions = new Set<string>();
  const collect = (n: ts.Node): void => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && n.importClause?.namedBindings) {
      const from = n.moduleSpecifier.text;
      const bindings = n.importClause.namedBindings;
      if (ts.isNamespaceImport(bindings)) {
        if (from === "vitest") vitestNamespaces.add(bindings.name.text);
      } else {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (from === "vitest") vitestNames.set(el.name.text, imported);
          if ((from === "node:perf_hooks" || from === "perf_hooks") && imported === "performance") clockReceivers.add(el.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = n.initializer.getText(sf).replace(/\s+/g, "");
      if (ts.isIdentifier(n.name)) {
        consts.set(n.name.text, n.initializer);
        // const p = performance; const now = performance.now.bind(performance)
        if (clockReceivers.has(lastSegment(init))) clockReceivers.add(n.name.text);
        if (/(^|\.)(performance|Date)\??\.now(\.bind\(.*\))?$/.test(init)) clockFunctions.add(n.name.text);
      } else if (ts.isObjectBindingPattern(n.name) && ["performance", "Date", "process"].includes(lastSegment(init))) {
        // const { now } = performance
        for (const el of n.name.elements) {
          const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
          if ((key === "now" || key === "hrtime") && ts.isIdentifier(el.name)) clockFunctions.add(el.name.text);
        }
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  /** vitest's name for a callee, through aliases and namespaces, or null. */
  const canonical = (id: ts.Identifier): string | null => vitestNames.get(id.text) ?? (["vi", "expect"].includes(id.text) ? id.text : TESTS.has(id.text) || SUITES.has(id.text) || HOOKS.has(id.text) ? id.text : null);

  /** it / describe / beforeAll ... for a test-declaring callee, or null. */
  function declarer(callee: ts.Expression): string | null {
    let node: ts.Expression = callee;
    let last = "";
    for (;;) {
      if (ts.isIdentifier(node)) {
        if (FACTORIES.has(last)) return null;
        return canonical(node);
      }
      if (ts.isPropertyAccessExpression(node)) {
        if (!last) last = node.name.text;
        if (ts.isIdentifier(node.expression) && vitestNamespaces.has(node.expression.text)) {
          return FACTORIES.has(last) ? null : node.name.text;
        }
        if (!MODIFIERS.has(node.name.text) && !FACTORIES.has(node.name.text)) return null;
        node = node.expression;
      } else if (ts.isCallExpression(node)) {
        // `it.each(table)(...)`: the callee is itself the factory call.
        if (!last) last = "()";
        node = node.expression;
      } else return null;
    }
  }

  /** `vi.waitFor`, `expect.poll`, `vi.setConfig` for those callees, through aliases. */
  function member(callee: ts.Expression): string | null {
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null;
    const base = vitestNamespaces.has(callee.expression.text) ? null : canonical(callee.expression);
    return base ? `${base}.${callee.name.text}` : null;
  }

  const isFunction = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));

  function titleOf(node: ts.Node | undefined): string {
    if (!node) return "";
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    return node.getText(sf).replace(/^[`"']|[`"']$/g, "");
  }

  function limitValue(node: ts.Expression): Limit {
    const text = node.getText(sf);
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "timeLimit") {
      return { kind: "scaled", text, line: lineOf(node) };
    }
    if (ts.isIdentifier(node)) {
      const init = consts.get(node.text);
      if (init) {
        const inner = limitValue(init);
        // A const holding a limit is fixed at the const, not at each use.
        return inner.kind === "bare" ? { kind: "bare", text, line: inner.line, fix: `const ${node.text} = ${inner.fix}` } : inner;
      }
    }
    return { kind: "bare", text, line: lineOf(node), fix: `timeLimit(${text})` };
  }

  /** The object literal an options argument is, directly or through a const in this file. */
  function optionsObject(node: ts.Expression | undefined): ts.ObjectLiteralExpression | null {
    if (!node) return null;
    if (ts.isObjectLiteralExpression(node)) return node;
    if (ts.isIdentifier(node)) {
      const init = consts.get(node.text);
      if (init && ts.isObjectLiteralExpression(init)) return init;
    }
    return null;
  }

  /** A property's value, following `{ name }` shorthand and `{ ...CONST }` spreads in this file; the last one wins, as in JS. */
  function property(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
    let found: ts.Expression | null = null;
    for (const p of obj.properties) {
      if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) found = p.initializer;
      else if (ts.isShorthandPropertyAssignment(p) && p.name.text === name) found = p.name;
      else if (ts.isSpreadAssignment(p)) {
        const spread = optionsObject(p.expression);
        const inner = spread && property(spread, name);
        if (inner) found = inner;
      }
    }
    return found;
  }

  function tagsOf(obj: ts.ObjectLiteralExpression | null): string[] {
    let value = obj && property(obj, "tags");
    if (value && ts.isIdentifier(value)) value = consts.get(value.text) ?? value;
    if (!value) return [];
    if (ts.isStringLiteral(value)) return [value.text];
    if (ts.isArrayLiteralExpression(value)) return value.elements.filter(ts.isStringLiteral).map((e) => e.text);
    return [];
  }

  function isClockRead(node: ts.Node): boolean {
    if (ts.isNewExpression(node)) {
      // `new Date()` and `+new Date()` read the clock; `new Date(x)` does not.
      return ts.isIdentifier(node.expression) && node.expression.text === "Date" && (node.arguments?.length ?? 0) === 0;
    }
    if (!ts.isCallExpression(node)) return false;
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return clockFunctions.has(callee.text) || (callee.text === "Date" && node.arguments.length === 0);
    if (!ts.isPropertyAccessExpression(callee)) return false;
    const name = callee.name.text;
    const receiver = callee.expression.getText(sf);
    if (name === "now") return clockReceivers.has(lastSegment(receiver));
    if (name === "hrtime") return lastSegment(receiver) === "process";
    if (name === "bigint") return /(^|\.)process\??\.hrtime$/.test(receiver.replace(/\s+/g, ""));
    if (["time", "timeEnd", "timeLog"].includes(name)) return lastSegment(receiver) === "console";
    return false;
  }

  const calls: TestCall[] = [];
  const strayClockReads: StrayClockRead[] = [];
  /** Suites whose body or hooks read a clock outside any test. */
  const suitesReadingClock = new Set<TestCall>();
  const testSuites = new Map<TestCall, TestCall[]>();

  function declare(node: ts.CallExpression, name: string, suites: TestCall[]): { call: TestCall; body: ts.Node | undefined } {
    const kind = TESTS.has(name) ? "test" : SUITES.has(name) ? "suite" : "hook";
    const args = node.arguments;
    let limit: Limit = { kind: "none" };
    let options: ts.ObjectLiteralExpression | null = null;
    let body: ts.Node | undefined;
    if (kind === "hook") {
      body = args[0];
      if (args[1]) limit = limitValue(args[1]);
    } else {
      const [, a1, a2, a3] = args;
      const a1Options = a1 !== undefined && !isFunction(a1) && (optionsObject(a1) !== null || isFunction(a2));
      if (a1Options) {
        // it(title, options, fn): a limit after fn is ignored by vitest.
        options = optionsObject(a1);
        body = a2;
        const t = options && property(options, "timeout");
        if (t) limit = limitValue(t);
        if (a3) limit = { kind: "ignored", text: a3.getText(sf), line: lineOf(a3) };
      } else {
        // it(title, fn, limit | options); fn may be a function passed by name.
        body = a1;
        options = optionsObject(a2);
        if (options) {
          const t = property(options, "timeout");
          if (t) limit = limitValue(t);
        } else if (a2) limit = limitValue(a2);
      }
    }
    const tags = tagsOf(options);
    const call: TestCall = {
      kind,
      callee: node.expression.getText(sf),
      title: kind === "hook" ? "" : titleOf(args[0]),
      line: lineOf(node),
      limits: limit.kind === "none" ? [] : [limit],
      tags,
      inheritedTags: [...suites.flatMap((s) => s.tags), ...tags],
      clockReads: [],
      suiteReadsClock: false,
    };
    return { call, body };
  }

  function waitOrConfig(node: ts.CallExpression, name: string): TestCall | null {
    const base = { callee: node.expression.getText(sf), title: "", line: lineOf(node), tags: [], inheritedTags: [], clockReads: [], suiteReadsClock: false };
    if (WAITS.has(name)) {
      const arg = node.arguments[1];
      const options = optionsObject(arg);
      const t = options ? property(options, "timeout") : arg;
      return { ...base, kind: "wait", limits: t ? [limitValue(t)] : [] };
    }
    if (name === "vi.setConfig") {
      const options = optionsObject(node.arguments[0]);
      const limits = ["testTimeout", "hookTimeout"].flatMap((key) => {
        const v = options && property(options, key);
        return v ? [limitValue(v)] : [];
      });
      return { ...base, kind: "config", limits };
    }
    return null;
  }

  const visit = (node: ts.Node, suites: TestCall[], test: TestCall | null): void => {
    if (isClockRead(node)) {
      if (test) test.clockReads.push(lineOf(node));
      else {
        strayClockReads.push({ line: lineOf(node), tags: suites.flatMap((s) => s.tags) });
        const inner = suites[suites.length - 1];
        if (inner) suitesReadingClock.add(inner);
      }
    }
    if (ts.isCallExpression(node)) {
      const name = declarer(node.expression);
      if (name && (TESTS.has(name) || SUITES.has(name) || HOOKS.has(name))) {
        const { call, body } = declare(node, name, suites);
        calls.push(call);
        if (call.kind === "test") testSuites.set(call, suites);
        for (const a of node.arguments) {
          if (a === body && call.kind === "suite") visit(a, [...suites, call], test);
          else if (a === body && call.kind === "test") visit(a, suites, call);
          else visit(a, suites, test);
        }
        visit(node.expression, suites, test);
        return;
      }
      const m = member(node.expression);
      const extra = m && waitOrConfig(node, m);
      if (extra) calls.push(extra);
    }
    ts.forEachChild(node, (child) => visit(child, suites, test));
  };
  visit(sf, [], null);

  for (const [call, suites] of testSuites) call.suiteReadsClock = suites.some((s) => suitesReadingClock.has(s));
  return { calls, strayClockReads };
}

export interface ScannedFile {
  /** Path relative to client/test, as the messages print it. */
  file: string;
  scan: FileScan;
}

/**
 * Every time limit in the files that does not go through `timeLimit`, as a
 * message naming the line to edit and what to write there. A wait with no
 * limit counts too: its 1 s default does not scale.
 */
export function limitOffenders(files: ScannedFile[]): string[] {
  const out = new Set<string>();
  for (const { file, scan } of files) {
    let helper = relative(dirname(file), "helpers/timeLimit.js");
    if (!helper.startsWith(".")) helper = `./${helper}`;
    const importLine = `import { timeLimit } from "${helper}"`;
    for (const c of scan.calls) {
      if (c.kind === "wait" && c.limits.length === 0) {
        out.add(`${file}:${c.line} ${c.callee}: no limit, so vitest's unscaled 1 s default applies — pass { timeout: timeLimit(1_000) } (${importLine})`);
      }
      for (const limit of c.limits) {
        if (limit.kind === "ignored") {
          out.add(`${file}:${limit.line} ${c.callee}: the limit ${limit.text} after the callback is ignored when an options object is given; put \`timeout: timeLimit(<ms>)\` in the options`);
        } else if (limit.kind === "bare") {
          out.add(`${file}:${limit.line} ${c.callee}: limit ${limit.text} — write ${limit.fix} (${importLine})`);
        }
      }
    }
  }
  return [...out];
}

export interface WallClockReport {
  /** `file > title` of every test carrying the tag, directly or from a suite. */
  tagged: string[];
  /** Messages for each broken rule; empty when the files hold both rules. */
  offenders: string[];
}

/**
 * Holds the `wall-clock` tag to exactly the tests that assert on a clock
 * reading: a test that reads a clock carries the tag unless it is listed as
 * printing the timing without asserting on it; a tagged test reads a clock in
 * its callback or its suite's; and every listed test still reads one, untagged.
 */
export function wallClockOffenders(files: ScannedFile[], printedNotAsserted: Record<string, string>): WallClockReport {
  const tagged: string[] = [];
  const offenders: string[] = [];
  const untaggedReaders = new Set<string>();
  for (const { file, scan } of files) {
    for (const c of scan.calls) {
      if (c.kind !== "test") continue;
      const key = `${file} > ${c.title}`;
      const isTagged = c.inheritedTags.includes("wall-clock");
      const reads = c.clockReads.length > 0;
      if (isTagged) {
        tagged.push(key);
        if (!reads && !c.suiteReadsClock) {
          offenders.push(`${key} (line ${c.line}) carries the wall-clock tag but reads no clock: the tag keeps it off CI, so it is only for tests that assert on elapsed time; remove the tag`);
        }
      } else if (reads) {
        untaggedReaders.add(key);
        if (!(key in printedNotAsserted)) {
          offenders.push(`${key} (line ${c.line}) reads a clock: if it asserts on the time, add { tags: ["wall-clock"] } to its options; if it only prints it, add it to PRINTED_NOT_ASSERTED with why`);
        }
      }
    }
    for (const read of scan.strayClockReads) {
      if (read.tags.includes("wall-clock")) continue;
      const key = `${file} (outside any test)`;
      untaggedReaders.add(key);
      if (!(key in printedNotAsserted)) {
        offenders.push(`${key} (line ${read.line}) reads a clock outside a test, in an untagged suite or at top level: move it into the test that uses it, or tag the suite if its tests assert on the time`);
      }
    }
  }
  for (const key of Object.keys(printedNotAsserted)) {
    if (!untaggedReaders.has(key)) {
      offenders.push(`${key} is on PRINTED_NOT_ASSERTED but no untagged test by that title reads a clock: remove the entry, or update it to the test's new title`);
    }
  }
  return { tagged, offenders };
}
