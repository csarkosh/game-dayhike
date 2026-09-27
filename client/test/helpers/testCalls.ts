/**
 * Reads a test file's source for the calls that declare tests, suites and hooks,
 * with each one's time limit, tags and clock reads. The architecture test uses
 * it to hold two rules over every test file: time limits go through
 * `timeLimit`, and a test that reads a clock carries the `wall-clock` tag.
 * Parsed with the TypeScript compiler, not a regex, so a limit on the line after
 * its callback, or a suite's limit kept in a const, is still found.
 */
import ts from "typescript";

const TESTS = new Set(["it", "test"]);
const SUITES = new Set(["describe", "suite"]);
const HOOKS = new Set(["beforeAll", "afterAll", "beforeEach", "afterEach"]);
/** Chained modifiers that return the same call shape: `it.skip(...)`, `describe.concurrent(...)`. */
const MODIFIERS = new Set(["skip", "only", "todo", "concurrent", "sequential", "shuffle", "fails"]);
/** Chained factories whose result is then called: `it.each(table)(...)`, `it.skipIf(c)(...)`. */
const FACTORIES = new Set(["each", "for", "skipIf", "runIf"]);
/** The reads a wall-clock assertion is made of. */
const CLOCKS = ["performance.now", "Date.now", "process.hrtime", "process.hrtime.bigint"];

export type Limit =
  /** No limit at the call: it inherits its suite's, else the config default. */
  | { kind: "none" }
  /** `timeLimit(<ms>)`. */
  | { kind: "scaled"; text: string }
  /** Anything else: a bare number, a const, arithmetic. */
  | { kind: "bare"; text: string }
  /** A trailing limit after an options object: vitest ignores it. */
  | { kind: "ignored"; text: string };

export interface TestCall {
  kind: "test" | "suite" | "hook";
  /** it, describe, beforeAll, ... */
  callee: string;
  /** The title, with any `${...}` in a template title kept as written. */
  title: string;
  line: number;
  limit: Limit;
  /** Tags written on this call's options object. */
  tags: string[];
  /** Tags from this call and every suite around it. */
  inheritedTags: string[];
  /** Lines of clock reads inside this call's callback (tests only). */
  clockReads: number[];
}

export interface FileScan {
  calls: TestCall[];
  /** Lines of clock reads that sit inside no test's callback. */
  strayClockReads: number[];
}

function rootOf(callee: ts.Expression): { name: string; last: string } | null {
  let node: ts.Expression = callee;
  let last = "";
  for (;;) {
    if (ts.isIdentifier(node)) return { name: node.text, last: last || node.text };
    if (ts.isPropertyAccessExpression(node)) {
      if (!last) last = node.name.text;
      if (!MODIFIERS.has(node.name.text) && !FACTORIES.has(node.name.text)) return null;
      node = node.expression;
    } else if (ts.isCallExpression(node)) {
      // `it.each(table)(...)`: the callee is itself the factory call.
      if (!last) last = "()";
      node = node.expression;
    } else return null;
  }
}

function isFunction(node: ts.Node | undefined): boolean {
  return !!node && (ts.isArrowFunction(node) || ts.isFunctionExpression(node));
}

function titleOf(node: ts.Node | undefined, sf: ts.SourceFile): string {
  if (!node) return "";
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return node.getText(sf).replace(/^[`"']|[`"']$/g, "");
}

function limitValue(node: ts.Expression, sf: ts.SourceFile): Limit {
  const text = node.getText(sf);
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "timeLimit") {
    return { kind: "scaled", text };
  }
  return { kind: "bare", text };
}

/** The object literal an options argument is, directly or through a const in this file. */
function optionsObject(node: ts.Expression | undefined, consts: Map<string, ts.Expression>): ts.ObjectLiteralExpression | null {
  if (!node) return null;
  if (ts.isObjectLiteralExpression(node)) return node;
  if (ts.isIdentifier(node)) {
    const init = consts.get(node.text);
    if (init && ts.isObjectLiteralExpression(init)) return init;
  }
  return null;
}

function property(obj: ts.ObjectLiteralExpression, name: string): ts.Expression | null {
  for (const p of obj.properties) {
    if (ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && p.name.text === name) {
      return p.initializer;
    }
  }
  return null;
}

function tagsOf(obj: ts.ObjectLiteralExpression | null): string[] {
  const value = obj && property(obj, "tags");
  if (!value) return [];
  if (ts.isStringLiteral(value)) return [value.text];
  if (ts.isArrayLiteralExpression(value)) return value.elements.filter(ts.isStringLiteral).map((e) => e.text);
  return [];
}

function isClockRead(node: ts.Node, sf: ts.SourceFile): boolean {
  return ts.isCallExpression(node) && CLOCKS.includes(node.expression.getText(sf));
}

export function scanTestSource(fileName: string, source: string): FileScan {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const lineOf = (n: ts.Node): number => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

  const consts = new Map<string, ts.Expression>();
  const collectConsts = (n: ts.Node): void => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) consts.set(n.name.text, n.initializer);
    ts.forEachChild(n, collectConsts);
  };
  collectConsts(sf);

  const calls: TestCall[] = [];
  const strayClockReads: number[] = [];

  const visit = (node: ts.Node, suiteTags: string[], test: TestCall | null): void => {
    if (isClockRead(node, sf)) {
      if (test) test.clockReads.push(lineOf(node));
      else strayClockReads.push(lineOf(node));
    }
    if (ts.isCallExpression(node)) {
      const root = rootOf(node.expression);
      const factory = root && FACTORIES.has(root.last);
      if (root && !factory && (TESTS.has(root.name) || SUITES.has(root.name) || HOOKS.has(root.name))) {
        const kind = TESTS.has(root.name) ? "test" : SUITES.has(root.name) ? "suite" : "hook";
        const args = node.arguments;
        let limit: Limit = { kind: "none" };
        let options: ts.ObjectLiteralExpression | null = null;
        let body: ts.Node | undefined;
        if (kind === "hook") {
          body = args[0];
          if (args[1]) limit = limitValue(args[1], sf);
        } else if (isFunction(args[1])) {
          // it(title, fn, limit | options)
          body = args[1];
          const third = args[2];
          options = optionsObject(third, consts);
          if (options) {
            const t = property(options, "timeout");
            if (t) limit = limitValue(t, sf);
          } else if (third) limit = limitValue(third, sf);
        } else {
          // it(title, options, fn) — a limit after fn is ignored by vitest.
          options = optionsObject(args[1], consts);
          body = args[2];
          const t = options && property(options, "timeout");
          if (t) limit = limitValue(t, sf);
          if (args[3]) limit = { kind: "ignored", text: args[3].getText(sf) };
        }
        const tags = tagsOf(options);
        const call: TestCall = {
          kind,
          callee: node.expression.getText(sf),
          title: kind === "hook" ? "" : titleOf(args[0], sf),
          line: lineOf(node),
          limit,
          tags,
          inheritedTags: [...suiteTags, ...tags],
          clockReads: [],
        };
        calls.push(call);
        for (const a of args) {
          if (a === body) visit(a, call.inheritedTags, kind === "test" ? call : test);
          else visit(a, suiteTags, test);
        }
        visit(node.expression, suiteTags, test);
        return;
      }
    }
    ts.forEachChild(node, (child) => visit(child, suiteTags, test));
  };
  visit(sf, [], null);
  return { calls, strayClockReads };
}
