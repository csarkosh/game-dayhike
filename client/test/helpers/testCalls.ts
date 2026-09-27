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
/** Hooks that take a limit after their callback, including the around-hooks and the per-test finish hooks. */
const HOOKS = new Set(["beforeAll", "afterAll", "beforeEach", "afterEach", "aroundAll", "aroundEach", "onTestFinished", "onTestFailed"]);
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
  /**
   * Why the scan cannot tell this test's or suite's tags, or null when it can:
   * options it cannot resolve to an object literal in this file, or a `tags`
   * value that is not wholly string literals. Read as "may be tagged".
   */
  tagsUnknown: string | null;
  /** A wait or config call whose options the scan cannot resolve: its limit is unseen, not missing. */
  limitsUnseen: boolean;
}

export interface StrayClockRead {
  line: number;
  /** Tags of the suites around the read. */
  tags: string[];
}

export interface FileScan {
  /** Tags the file gives every test in it through vitest's module-tag pragma. */
  moduleTags: string[];
  calls: TestCall[];
  /** Clock reads inside no test's callback: in a suite body, a hook, or at top level. */
  strayClockReads: StrayClockRead[];
}

/** The last segment of a dotted receiver, without optional chaining: `globalThis.performance` → `performance`. */
function lastSegment(text: string): string {
  return text.replace(/\?/g, "").split(".").pop() ?? "";
}

/**
 * The tags vitest reads from a file's module-tag pragmas (a line comment or a
 * doc-comment line: the at-sign, "module-tag", then the tag), matched with
 * vitest's own pattern over the raw source, as vitest does, so a pragma inside
 * a string counts here exactly as it counts there.
 */
export function moduleTagsOf(source: string): string[] {
  const pattern = new RegExp("(\\/\\/|\\*)\\s*@" + "module-tag\\s+([\\w\\-/]+)\\b");
  const tags: string[] = [];
  let rest = source;
  for (let m = rest.match(pattern); m && m.index !== undefined; m = rest.match(pattern)) {
    tags.push(m[2] ?? "");
    rest = rest.slice(m.index + m[0].length);
  }
  return tags;
}

export function scanTestSource(fileName: string, source: string): FileScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const moduleTags = moduleTagsOf(source);

  // Names bound at any depth in this file: consts (for limits, options and
  // tags kept in them), and aliases of vitest's own names and of the clocks.
  const consts = new Map<string, ts.Expression>();
  const vitestNames = new Map<string, string>();
  const vitestNamespaces = new Set<string>();
  const clockReceivers = new Set(["performance", "Date"]);
  const clockFunctions = new Set<string>();
  /** Names bound to a function in this file: a declaration, or a const holding an arrow or function expression. */
  const functionNames = new Set<string>();
  /** `const myTest = test.extend(...)`: resolved to test declarers once vitest's names are known. */
  const extended: { name: string; base: ts.Expression }[] = [];
  const collect = (n: ts.Node): void => {
    if (ts.isFunctionDeclaration(n) && n.name) functionNames.add(n.name.text);
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
          if ((from === "node:process" || from === "process") && (imported === "hrtime" || imported === "uptime")) clockFunctions.add(el.name.text);
        }
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer) {
      const init = n.initializer.getText(sf).replace(/\s+/g, "");
      if (ts.isIdentifier(n.name)) {
        consts.set(n.name.text, n.initializer);
        if (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) functionNames.add(n.name.text);
        if (ts.isCallExpression(n.initializer) && ts.isPropertyAccessExpression(n.initializer.expression) && n.initializer.expression.name.text === "extend") {
          extended.push({ name: n.name.text, base: n.initializer.expression.expression });
        }
        // const p = performance; const now = performance.now.bind(performance)
        if (clockReceivers.has(lastSegment(init))) clockReceivers.add(n.name.text);
        if (/(^|\.)(performance|Date)\??\.now(\.bind\(.*\))?$/.test(init)) clockFunctions.add(n.name.text);
      } else if (ts.isObjectBindingPattern(n.name)) {
        const from = lastSegment(init);
        for (const el of n.name.elements) {
          const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : "";
          if (!ts.isIdentifier(el.name)) continue;
          // const { now } = performance; const { hrtime } = process
          if (["performance", "Date", "process"].includes(from) && ["now", "hrtime", "uptime"].includes(key)) clockFunctions.add(el.name.text);
          // const { performance: p } = globalThis
          if (["globalThis", "window", "self"].includes(from) && (key === "performance" || key === "Date")) clockReceivers.add(el.name.text);
        }
      }
    }
    ts.forEachChild(n, collect);
  };
  collect(sf);

  /** vitest's name for a callee, through aliases, namespaces and `test.extend`, or null. */
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

  // A test made with `test.extend` (or an extension of one) declares tests like `test`.
  for (let changed = true; changed; ) {
    changed = false;
    for (const { name, base } of extended) {
      if (!vitestNames.has(name) && declarer(base) !== null && TESTS.has(declarer(base) ?? "")) {
        vitestNames.set(name, "test");
        changed = true;
      }
    }
  }

  /** `vi.waitFor`, `expect.poll`, `vi.setConfig` for those callees, through aliases. */
  function member(callee: ts.Expression): string | null {
    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return null;
    const base = vitestNamespaces.has(callee.expression.text) ? null : canonical(callee.expression);
    return base ? `${base}.${callee.name.text}` : null;
  }

  const isFunction = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
  /** A function, written here or named: a declaration or a const holding one, in this file. */
  const isFunctionRef = (n: ts.Node | undefined): boolean => isFunction(n) || (!!n && ts.isIdentifier(n) && functionNames.has(n.text));
  /** An argument that can only be a limit: a number, `timeLimit(...)`, arithmetic, or a const holding one of those. */
  function isLimitLike(n: ts.Expression | undefined): boolean {
    if (!n) return false;
    if (ts.isNumericLiteral(n) || ts.isBinaryExpression(n) || ts.isPrefixUnaryExpression(n)) return true;
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "timeLimit") return true;
    if (ts.isIdentifier(n)) {
      const init = consts.get(n.text);
      return !!init && !ts.isObjectLiteralExpression(init) && isLimitLike(init);
    }
    return false;
  }

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

  /**
   * The tags an options object gives, or why they cannot be told. Fails
   * closed: a spread or computed key the scan cannot follow, or a `tags` value
   * that is not a string literal or an array of them (directly or through a
   * const array in this file), is "cannot tell", never "untagged".
   */
  function tagsOf(obj: ts.ObjectLiteralExpression | null): { tags: string[]; unknown: string | null } {
    if (!obj) return { tags: [], unknown: null };
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p) && !optionsObject(p.expression)) return { tags: [], unknown: `a spread the scan cannot follow, \`...${p.expression.getText(sf)}\`` };
      if (p.name && ts.isComputedPropertyName(p.name)) return { tags: [], unknown: `a computed key, \`${p.name.getText(sf)}\`` };
    }
    let value = property(obj, "tags");
    if (!value) return { tags: [], unknown: null };
    if (ts.isIdentifier(value) && consts.get(value.text)) value = consts.get(value.text) ?? value;
    if (ts.isStringLiteral(value)) return { tags: [value.text], unknown: null };
    if (ts.isArrayLiteralExpression(value) && value.elements.every(ts.isStringLiteral)) {
      return { tags: value.elements.map((e) => (e as ts.StringLiteral).text), unknown: null };
    }
    return { tags: [], unknown: `tags written as \`${value.getText(sf)}\`` };
  }

  function isClockRead(node: ts.Node): boolean {
    if (ts.isNewExpression(node)) {
      // `new Date()` and `+new Date()` read the clock; `new Date(x)` does not.
      return ts.isIdentifier(node.expression) && node.expression.text === "Date" && (node.arguments?.length ?? 0) === 0;
    }
    if (!ts.isCallExpression(node)) return false;
    const callee = node.expression;
    if (ts.isIdentifier(callee)) return clockFunctions.has(callee.text) || (callee.text === "Date" && node.arguments.length === 0);
    // `x.now()` and `x["now"]()` alike.
    let name: string;
    let receiver: string;
    if (ts.isPropertyAccessExpression(callee)) {
      name = callee.name.text;
      receiver = callee.expression.getText(sf);
    } else if (ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)) {
      name = callee.argumentExpression.text;
      receiver = callee.expression.getText(sf);
    } else return false;
    const on = lastSegment(receiver);
    if (name === "now") return clockReceivers.has(on);
    if (name === "mark" || name === "measure") return clockReceivers.has(on) && on !== "Date";
    if (name === "hrtime" || name === "uptime") return on === "process";
    if (name === "bigint") return /(^|\.)process\??\.hrtime$/.test(receiver.replace(/\s+/g, ""));
    if (name === "getRealSystemTime") return on === "vi";
    if (["time", "timeEnd", "timeLog"].includes(name)) return on === "console";
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
    let optionsUnknown: string | null = null;
    let body: ts.Node | undefined;
    const readOptions = (arg: ts.Expression): void => {
      options = optionsObject(arg);
      if (!options) optionsUnknown = `options the scan cannot resolve, \`${arg.getText(sf)}\``;
      const t = options && property(options, "timeout");
      if (t) limit = limitValue(t);
    };
    if (kind === "hook") {
      body = args[0];
      if (args[1]) limit = limitValue(args[1]);
    } else {
      const [, a1, a2, a3] = args;
      if (a1 === undefined) {
        // it.todo(title)
      } else if (isFunctionRef(a1) || (!optionsObject(a1) && isLimitLike(a2))) {
        // it(title, fn, limit | options); fn may be a function passed by name,
        // even one imported, when what follows can only be a limit.
        body = a1;
        if (a2 && (optionsObject(a2) || !isLimitLike(a2))) readOptions(a2);
        else if (a2) limit = limitValue(a2);
      } else if (optionsObject(a1) || isFunctionRef(a2)) {
        // it(title, options, fn): a limit after fn is ignored by vitest.
        readOptions(a1);
        body = a2;
        if (a3) limit = { kind: "ignored", text: a3.getText(sf), line: lineOf(a3) };
      } else {
        // Neither argument resolves to a function or an options object here.
        optionsUnknown = `arguments the scan cannot resolve, \`${args.slice(1).map((a) => a.getText(sf)).join(", ")}\``;
      }
    }
    const read = tagsOf(options);
    const tags = read.tags;
    const call: TestCall = {
      kind,
      callee: node.expression.getText(sf),
      title: kind === "hook" ? "" : titleOf(args[0]),
      line: lineOf(node),
      limits: limit.kind === "none" ? [] : [limit],
      tags,
      inheritedTags: [...moduleTags, ...suites.flatMap((s) => s.tags), ...tags],
      clockReads: [],
      suiteReadsClock: false,
      tagsUnknown: kind === "hook" ? null : (optionsUnknown ?? read.unknown),
      limitsUnseen: false,
    };
    return { call, body };
  }

  function waitOrConfig(node: ts.CallExpression, name: string): TestCall | null {
    const base = { callee: node.expression.getText(sf), title: "", line: lineOf(node), tags: [], inheritedTags: [], clockReads: [], suiteReadsClock: false, tagsUnknown: null };
    if (WAITS.has(name)) {
      const arg = node.arguments[1];
      const options = optionsObject(arg);
      const hidden = options?.properties.some((p) => ts.isSpreadAssignment(p) && !optionsObject(p.expression)) ?? false;
      if ((arg && !options && !isLimitLike(arg)) || hidden) return { ...base, kind: "wait", limits: [], limitsUnseen: true };
      const t = options ? property(options, "timeout") : arg;
      return { ...base, kind: "wait", limits: t ? [limitValue(t)] : [], limitsUnseen: false };
    }
    if (name === "vi.setConfig") {
      const options = optionsObject(node.arguments[0]);
      const limits = ["testTimeout", "hookTimeout"].flatMap((key) => {
        const v = options && property(options, key);
        return v ? [limitValue(v)] : [];
      });
      return { ...base, kind: "config", limits, limitsUnseen: !options };
    }
    return null;
  }

  const visit = (node: ts.Node, suites: TestCall[], test: TestCall | null): void => {
    if (isClockRead(node)) {
      if (test) test.clockReads.push(lineOf(node));
      else {
        strayClockReads.push({ line: lineOf(node), tags: [...moduleTags, ...suites.flatMap((s) => s.tags)] });
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
  return { moduleTags, calls, strayClockReads };
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
      if (c.kind === "wait" && c.limits.length === 0 && !c.limitsUnseen) {
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
      if ((c.kind === "test" || c.kind === "suite") && c.tagsUnknown) {
        offenders.push(`${file}:${c.line} ${c.callee} "${c.title}": cannot tell whether this is tagged (${c.tagsUnknown}): write the options as an object literal on the call, with any tags as literal strings, e.g. { tags: ["wall-clock"] }`);
      }
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
