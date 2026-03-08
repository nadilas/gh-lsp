/**
 * TypeScript/JavaScript language server adapter.
 *
 * Uses TypeScript's Language Service API to provide hover, go-to-definition,
 * and signature help. Since TypeScript is itself JavaScript, no WASM compilation
 * is required — the language service runs directly in the Web Worker.
 *
 * The adapter translates LSP methods to TypeScript Language Service API calls:
 *   textDocument/hover       → ts.LanguageService.getQuickInfoAtPosition
 *   textDocument/definition  → ts.LanguageService.getDefinitionAtPosition
 *   textDocument/signatureHelp → ts.LanguageService.getSignatureHelpItems
 */

import ts from 'typescript';
import type { WasmServer } from '../language-registry';
import type { VirtualFileSystem } from '../vfs';

// ─── LSP Parameter Types ─────────────────────────────────────────────────────

interface TextDocumentIdentifier {
  uri: string;
}

interface Position {
  line: number;
  character: number;
}

interface TextDocumentPositionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

interface DidOpenTextDocumentParams {
  textDocument: {
    uri: string;
    languageId: string;
    version: number;
    text: string;
  };
}

// ─── Position Conversion ─────────────────────────────────────────────────────

/**
 * Converts an LSP position (line, character) to a TypeScript offset
 * (number of characters from the start of the file).
 */
export function positionToOffset(
  content: string,
  line: number,
  character: number,
): number {
  const lines = content.split('\n');
  let offset = 0;

  for (let i = 0; i < line && i < lines.length; i++) {
    offset += lines[i]!.length + 1; // +1 for newline
  }

  const currentLineLength = lines[line]?.length ?? 0;
  return offset + Math.min(character, currentLineLength);
}

/**
 * Converts a TypeScript offset to an LSP position (line, character).
 */
export function offsetToPosition(
  content: string,
  offset: number,
): Position {
  const lines = content.split('\n');
  let remaining = offset;

  for (let line = 0; line < lines.length; line++) {
    if (remaining <= lines[line]!.length) {
      return { line, character: remaining };
    }
    remaining -= lines[line]!.length + 1;
  }

  // Past end of file — return last position
  const lastLine = lines.length - 1;
  return { line: lastLine, character: lines[lastLine]?.length ?? 0 };
}

// ─── Minimal Lib Declarations ────────────────────────────────────────────────

/**
 * A minimal set of TypeScript lib declarations that covers essential built-in
 * types. This enables the language service to provide useful hover info for
 * primitive types, common data structures, and utility types.
 *
 * Full lib support (lib.es5.d.ts, lib.dom.d.ts, etc.) can be added by
 * registering the full lib files from the TypeScript package as VFS entries.
 */
const MINIMAL_LIB = `
interface Array<T> {
  length: number;
  [n: number]: T;
  push(...items: T[]): number;
  pop(): T | undefined;
  map<U>(callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[];
  filter<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S): S[];
  filter(predicate: (value: T, index: number, array: T[]) => unknown): T[];
  forEach(callbackfn: (value: T, index: number, array: T[]) => void): void;
  find<S extends T>(predicate: (value: T, index: number, obj: T[]) => value is S): S | undefined;
  find(predicate: (value: T, index: number, obj: T[]) => unknown): T | undefined;
  findIndex(predicate: (value: T, index: number, obj: T[]) => unknown): number;
  indexOf(searchElement: T, fromIndex?: number): number;
  includes(searchElement: T, fromIndex?: number): boolean;
  slice(start?: number, end?: number): T[];
  splice(start: number, deleteCount?: number, ...items: T[]): T[];
  join(separator?: string): string;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: T[]) => U, initialValue: U): U;
  some(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  every<S extends T>(predicate: (value: T, index: number, array: T[]) => value is S): this is S[];
  every(predicate: (value: T, index: number, array: T[]) => unknown): boolean;
  concat(...items: (T | ConcatArray<T>)[]): T[];
  flat<D extends number = 1>(depth?: D): FlatArray<T[], D>[];
  flatMap<U>(callback: (value: T, index: number, array: T[]) => U | ReadonlyArray<U>): U[];
  sort(compareFn?: (a: T, b: T) => number): this;
  reverse(): T[];
  fill(value: T, start?: number, end?: number): this;
  entries(): IterableIterator<[number, T]>;
  keys(): IterableIterator<number>;
  values(): IterableIterator<T>;
}
interface ConcatArray<T> { readonly length: number; readonly [n: number]: T; }
type FlatArray<Arr, Depth extends number> = Arr;
interface ReadonlyArray<T> {
  readonly length: number;
  readonly [n: number]: T;
  map<U>(callbackfn: (value: T, index: number, array: readonly T[]) => U): U[];
  filter(predicate: (value: T, index: number, array: readonly T[]) => unknown): T[];
  find(predicate: (value: T, index: number, obj: readonly T[]) => unknown): T | undefined;
  includes(searchElement: T): boolean;
  indexOf(searchElement: T): number;
  forEach(callbackfn: (value: T, index: number, array: readonly T[]) => void): void;
  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number, array: readonly T[]) => U, initialValue: U): U;
  slice(start?: number, end?: number): T[];
  join(separator?: string): string;
  every(predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean;
  some(predicate: (value: T, index: number, array: readonly T[]) => unknown): boolean;
}
interface ArrayConstructor {
  new <T>(...items: T[]): T[];
  isArray(arg: any): arg is any[];
  from<T>(arrayLike: ArrayLike<T>): T[];
  of<T>(...items: T[]): T[];
}
declare var Array: ArrayConstructor;
interface ArrayLike<T> { readonly length: number; readonly [n: number]: T; }
interface String {
  readonly length: number;
  charAt(pos: number): string;
  charCodeAt(index: number): number;
  includes(searchString: string, position?: number): boolean;
  indexOf(searchValue: string, fromIndex?: number): number;
  lastIndexOf(searchValue: string, fromIndex?: number): number;
  slice(start?: number, end?: number): string;
  substring(start: number, end?: number): string;
  split(separator: string | RegExp, limit?: number): string[];
  trim(): string;
  trimStart(): string;
  trimEnd(): string;
  toLowerCase(): string;
  toUpperCase(): string;
  replace(searchValue: string | RegExp, replaceValue: string): string;
  replaceAll(searchValue: string | RegExp, replaceValue: string): string;
  startsWith(searchString: string, position?: number): boolean;
  endsWith(searchString: string, endPosition?: number): boolean;
  padStart(maxLength: number, fillString?: string): string;
  padEnd(maxLength: number, fillString?: string): string;
  repeat(count: number): string;
  match(regexp: string | RegExp): RegExpMatchArray | null;
  matchAll(regexp: RegExp): IterableIterator<RegExpMatchArray>;
  search(regexp: string | RegExp): number;
  concat(...strings: string[]): string;
  toString(): string;
  valueOf(): string;
  [Symbol.iterator](): IterableIterator<string>;
}
interface Number {
  toFixed(fractionDigits?: number): string;
  toPrecision(precision?: number): string;
  toString(radix?: number): string;
  valueOf(): number;
}
interface Boolean { valueOf(): boolean; }
interface Object {
  constructor: Function;
  toString(): string;
  valueOf(): Object;
  hasOwnProperty(v: PropertyKey): boolean;
}
interface ObjectConstructor {
  new(value?: any): Object;
  keys(o: object): string[];
  values<T>(o: { [s: string]: T }): T[];
  entries<T>(o: { [s: string]: T }): [string, T][];
  assign<T extends {}, U>(target: T, source: U): T & U;
  freeze<T>(o: T): Readonly<T>;
  defineProperty<T>(o: T, p: PropertyKey, attributes: PropertyDescriptor): T;
  getOwnPropertyNames(o: any): string[];
  create(o: object | null, properties?: PropertyDescriptorMap): any;
  is(value1: any, value2: any): boolean;
  fromEntries<T = any>(entries: Iterable<readonly [PropertyKey, T]>): { [k: string]: T };
}
declare var Object: ObjectConstructor;
interface Function {
  apply(thisArg: any, argArray?: any): any;
  call(thisArg: any, ...argArray: any[]): any;
  bind(thisArg: any, ...argArray: any[]): any;
  readonly length: number;
  readonly name: string;
}
interface RegExp {
  test(string: string): boolean;
  exec(string: string): RegExpExecArray | null;
  readonly source: string;
  readonly flags: string;
  readonly global: boolean;
  readonly ignoreCase: boolean;
  readonly multiline: boolean;
}
interface RegExpMatchArray extends Array<string> { index?: number; input?: string; groups?: { [key: string]: string }; }
interface RegExpExecArray extends Array<string> { index: number; input: string; groups?: { [key: string]: string }; }
interface Promise<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): Promise<TResult1 | TResult2>;
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | undefined | null
  ): Promise<T | TResult>;
  finally(onfinally?: (() => void) | undefined | null): Promise<T>;
}
interface PromiseLike<T> {
  then<TResult1 = T, TResult2 = never>(
    onfulfilled?: ((value: T) => TResult1 | PromiseLike<TResult1>) | undefined | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | undefined | null
  ): PromiseLike<TResult1 | TResult2>;
}
interface PromiseConstructor {
  new <T>(executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void): Promise<T>;
  all<T extends readonly unknown[]>(values: T): Promise<{ -readonly [P in keyof T]: Awaited<T[P]> }>;
  allSettled<T extends readonly unknown[]>(values: T): Promise<{ -readonly [P in keyof T]: PromiseSettledResult<Awaited<T[P]>> }>;
  race<T extends readonly unknown[]>(values: T): Promise<Awaited<T[number]>>;
  resolve(): Promise<void>;
  resolve<T>(value: T | PromiseLike<T>): Promise<Awaited<T>>;
  reject<T = never>(reason?: any): Promise<T>;
}
declare var Promise: PromiseConstructor;
type PromiseSettledResult<T> = PromiseFulfilledResult<T> | PromiseRejectedResult;
interface PromiseFulfilledResult<T> { status: "fulfilled"; value: T; }
interface PromiseRejectedResult { status: "rejected"; reason: any; }
interface Map<K, V> {
  get(key: K): V | undefined;
  set(key: K, value: V): this;
  has(key: K): boolean;
  delete(key: K): boolean;
  clear(): void;
  readonly size: number;
  forEach(callbackfn: (value: V, key: K, map: Map<K, V>) => void): void;
  entries(): IterableIterator<[K, V]>;
  keys(): IterableIterator<K>;
  values(): IterableIterator<V>;
}
interface MapConstructor { new <K, V>(entries?: readonly (readonly [K, V])[] | null): Map<K, V>; }
declare var Map: MapConstructor;
interface WeakMap<K extends WeakKey, V> { get(key: K): V | undefined; set(key: K, value: V): this; has(key: K): boolean; delete(key: K): boolean; }
interface WeakMapConstructor { new <K extends WeakKey, V>(entries?: readonly (readonly [K, V])[] | null): WeakMap<K, V>; }
declare var WeakMap: WeakMapConstructor;
interface Set<T> {
  add(value: T): this;
  has(value: T): boolean;
  delete(value: T): boolean;
  clear(): void;
  readonly size: number;
  forEach(callbackfn: (value: T, value2: T, set: Set<T>) => void): void;
  entries(): IterableIterator<[T, T]>;
  keys(): IterableIterator<T>;
  values(): IterableIterator<T>;
}
interface SetConstructor { new <T>(values?: readonly T[] | null): Set<T>; }
declare var Set: SetConstructor;
interface WeakSet<T extends WeakKey> { add(value: T): this; has(value: T): boolean; delete(value: T): boolean; }
interface WeakSetConstructor { new <T extends WeakKey>(values?: readonly T[] | null): WeakSet<T>; }
declare var WeakSet: WeakSetConstructor;
interface WeakRef<T extends WeakKey> { deref(): T | undefined; }
interface WeakRefConstructor { new <T extends WeakKey>(target: T): WeakRef<T>; }
declare var WeakRef: WeakRefConstructor;
type WeakKey = object;
interface Error { name: string; message: string; stack?: string; }
interface ErrorConstructor { new(message?: string): Error; (message?: string): Error; }
declare var Error: ErrorConstructor;
interface TypeError extends Error {}
interface TypeErrorConstructor extends ErrorConstructor { new(message?: string): TypeError; (message?: string): TypeError; }
declare var TypeError: TypeErrorConstructor;
interface RangeError extends Error {}
interface RangeErrorConstructor extends ErrorConstructor { new(message?: string): RangeError; (message?: string): RangeError; }
declare var RangeError: RangeErrorConstructor;
interface SyntaxError extends Error {}
interface ReferenceError extends Error {}
interface JSON { parse(text: string, reviver?: (key: string, value: any) => any): any; stringify(value: any, replacer?: (key: string, value: any) => any, space?: string | number): string; }
declare var JSON: JSON;
interface Console { log(...data: any[]): void; warn(...data: any[]): void; error(...data: any[]): void; debug(...data: any[]): void; info(...data: any[]): void; }
declare var console: Console;
interface Math {
  readonly PI: number;
  readonly E: number;
  abs(x: number): number;
  ceil(x: number): number;
  floor(x: number): number;
  round(x: number): number;
  max(...values: number[]): number;
  min(...values: number[]): number;
  pow(x: number, y: number): number;
  sqrt(x: number): number;
  random(): number;
  sign(x: number): number;
  trunc(x: number): number;
  log(x: number): number;
  log2(x: number): number;
  log10(x: number): number;
}
declare var Math: Math;
interface Date {
  getTime(): number;
  toISOString(): string;
  toJSON(): string;
  toString(): string;
  valueOf(): number;
}
interface DateConstructor {
  new(): Date;
  new(value: number | string): Date;
  new(year: number, month: number, date?: number, hours?: number, minutes?: number, seconds?: number, ms?: number): Date;
  now(): number;
  parse(s: string): number;
}
declare var Date: DateConstructor;
interface Symbol { readonly description: string | undefined; toString(): string; valueOf(): symbol; }
interface SymbolConstructor {
  (description?: string | number): symbol;
  readonly iterator: unique symbol;
  readonly asyncIterator: unique symbol;
  readonly hasInstance: unique symbol;
  readonly toPrimitive: unique symbol;
  readonly toStringTag: unique symbol;
}
declare var Symbol: SymbolConstructor;
interface IterableIterator<T> extends Iterator<T> { [Symbol.iterator](): IterableIterator<T>; }
interface Iterator<T, TReturn = any, TNext = any> { next(...[value]: [] | [TNext]): IteratorResult<T, TReturn>; }
interface IteratorYieldResult<TYield> { done?: false; value: TYield; }
interface IteratorReturnResult<TReturn> { done: true; value: TReturn; }
type IteratorResult<T, TReturn = any> = IteratorYieldResult<T> | IteratorReturnResult<TReturn>;
interface Iterable<T> { [Symbol.iterator](): Iterator<T>; }
interface AsyncIterable<T> { [Symbol.asyncIterator](): AsyncIterator<T>; }
interface AsyncIterator<T> { next(...args: [] | [undefined]): Promise<IteratorResult<T>>; }
interface AsyncIterableIterator<T> extends AsyncIterator<T> { [Symbol.asyncIterator](): AsyncIterableIterator<T>; }
interface Generator<T = unknown, TReturn = any, TNext = unknown> extends Iterator<T, TReturn, TNext> { next(...args: [] | [TNext]): IteratorResult<T, TReturn>; return(value: TReturn): IteratorResult<T, TReturn>; throw(e: any): IteratorResult<T, TReturn>; [Symbol.iterator](): Generator<T, TReturn, TNext>; }
interface AsyncGenerator<T = unknown, TReturn = any, TNext = unknown> extends AsyncIterator<T, TReturn, TNext> { next(...args: [] | [TNext]): Promise<IteratorResult<T, TReturn>>; return(value: TReturn | PromiseLike<TReturn>): Promise<IteratorResult<T, TReturn>>; throw(e: any): Promise<IteratorResult<T, TReturn>>; [Symbol.asyncIterator](): AsyncGenerator<T, TReturn, TNext>; }
declare var undefined: undefined;
declare var NaN: number;
declare var Infinity: number;
declare function parseInt(string: string, radix?: number): number;
declare function parseFloat(string: string): number;
declare function isNaN(number: number): boolean;
declare function isFinite(number: number): boolean;
declare function encodeURIComponent(uriComponent: string | number | boolean): string;
declare function decodeURIComponent(encodedURIComponent: string): string;
declare function encodeURI(uri: string): string;
declare function decodeURI(encodedURI: string): string;
declare function setTimeout(handler: (...args: any[]) => void, timeout?: number, ...arguments: any[]): number;
declare function clearTimeout(id: number | undefined): void;
declare function setInterval(handler: (...args: any[]) => void, timeout?: number, ...arguments: any[]): number;
declare function clearInterval(id: number | undefined): void;
declare function queueMicrotask(callback: () => void): void;
declare function structuredClone<T>(value: T): T;
declare function fetch(input: string | Request, init?: RequestInit): Promise<Response>;
interface RequestInit { method?: string; headers?: HeadersInit; body?: BodyInit | null; }
interface Response { readonly ok: boolean; readonly status: number; readonly statusText: string; json(): Promise<any>; text(): Promise<string>; readonly headers: Headers; }
interface Headers { get(name: string): string | null; has(name: string): boolean; }
type HeadersInit = [string, string][] | Record<string, string> | Headers;
type BodyInit = string;
interface Request { readonly url: string; readonly method: string; }
interface PropertyDescriptor { configurable?: boolean; enumerable?: boolean; value?: any; writable?: boolean; get?(): any; set?(v: any): void; }
interface PropertyDescriptorMap { [key: string]: PropertyDescriptor; }
type PropertyKey = string | number | symbol;
type Awaited<T> = T extends null | undefined ? T : T extends object & { then(onfulfilled: infer F, ...args: infer _): any } ? F extends ((value: infer V, ...args: infer _) => any) ? Awaited<V> : never : T;
type Partial<T> = { [P in keyof T]?: T[P] };
type Required<T> = { [P in keyof T]-?: T[P] };
type Readonly<T> = { readonly [P in keyof T]: T[P] };
type Record<K extends keyof any, T> = { [P in K]: T };
type Pick<T, K extends keyof T> = { [P in K]: T[P] };
type Omit<T, K extends keyof any> = Pick<T, Exclude<keyof T, K>>;
type Exclude<T, U> = T extends U ? never : T;
type Extract<T, U> = T extends U ? T : never;
type NonNullable<T> = T & {};
type ReturnType<T extends (...args: any) => any> = T extends (...args: any) => infer R ? R : any;
type Parameters<T extends (...args: any) => any> = T extends (...args: infer P) => any ? P : never;
type ConstructorParameters<T extends abstract new (...args: any) => any> = T extends abstract new (...args: infer P) => any ? P : never;
type InstanceType<T extends abstract new (...args: any) => any> = T extends abstract new (...args: any) => infer R ? R : any;
type Uppercase<S extends string> = intrinsic;
type Lowercase<S extends string> = intrinsic;
type Capitalize<S extends string> = intrinsic;
type Uncapitalize<S extends string> = intrinsic;
interface TemplateStringsArray extends ReadonlyArray<string> { readonly raw: readonly string[]; }
`;

const LIB_URI = '/__lib/lib.d.ts';

// ─── Server Factory ──────────────────────────────────────────────────────────

/**
 * Creates a TypeScript language server backed by the given VFS.
 * Suitable for both 'typescript' and 'javascript' languages since
 * TypeScript's language service handles both via allowJs/checkJs.
 */
export async function createTypeScriptServer(
  vfs: VirtualFileSystem,
): Promise<WasmServer> {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    strict: true,
    allowJs: true,
    checkJs: true,
    esModuleInterop: true,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
    skipDefaultLibCheck: true,
  };

  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => vfs.listFiles(),
    getScriptVersion: (fileName) => {
      const file = vfs.getFile(fileName);
      return file ? String(file.version) : '0';
    },
    getScriptSnapshot: (fileName) => {
      const file = vfs.getFile(fileName);
      if (!file) return undefined;
      return ts.ScriptSnapshot.fromString(file.content);
    },
    getCurrentDirectory: () => '/',
    getCompilationSettings: () => compilerOptions,
    getDefaultLibFileName: () => LIB_URI,
    fileExists: (path) => vfs.hasFile(path),
    readFile: (path) => vfs.getFile(path)?.content ?? undefined,
    readDirectory: () => [],
  };

  let service: ts.LanguageService | null = null;

  return {
    async initialize() {
      // Register minimal lib declarations in the VFS
      vfs.registerFile(LIB_URI, MINIMAL_LIB, 1);

      service = ts.createLanguageService(
        host,
        ts.createDocumentRegistry(),
      );

      return {
        capabilities: {
          hoverProvider: true,
          definitionProvider: true,
          signatureHelpProvider: true,
        },
      };
    },

    async handleRequest(method: string, params: unknown) {
      if (!service) return null;

      switch (method) {
        case 'textDocument/hover':
          return handleHover(service, vfs, params as TextDocumentPositionParams);
        case 'textDocument/definition':
          return handleDefinition(service, vfs, params as TextDocumentPositionParams);
        case 'textDocument/signatureHelp':
          return handleSignatureHelp(service, vfs, params as TextDocumentPositionParams);
        default:
          return null;
      }
    },

    handleNotification(method: string, params: unknown) {
      switch (method) {
        case 'textDocument/didOpen': {
          const p = params as DidOpenTextDocumentParams;
          vfs.registerFile(
            p.textDocument.uri,
            p.textDocument.text,
            p.textDocument.version,
          );
          break;
        }
      }
    },

    async shutdown() {
      if (service) {
        service.dispose();
        service = null;
      }
    },
  };
}

// ─── Request Handlers ────────────────────────────────────────────────────────

function handleHover(
  service: ts.LanguageService,
  vfs: VirtualFileSystem,
  params: TextDocumentPositionParams,
): {
  contents: { kind: string; value: string };
  range?: { start: Position; end: Position };
} | null {
  const file = vfs.getFile(params.textDocument.uri);
  if (!file) return null;

  const offset = positionToOffset(
    file.content,
    params.position.line,
    params.position.character,
  );

  const info = service.getQuickInfoAtPosition(params.textDocument.uri, offset);
  if (!info) return null;

  const displayParts = info.displayParts ?? [];
  const signature = displayParts.map((p) => p.text).join('');
  if (!signature) return null;

  const documentation = info.documentation
    ? info.documentation.map((d) => d.text).join('\n')
    : '';

  const hoverContent = documentation
    ? `\`\`\`typescript\n${signature}\n\`\`\`\n---\n${documentation}`
    : `\`\`\`typescript\n${signature}\n\`\`\``;

  const result: {
    contents: { kind: string; value: string };
    range?: { start: Position; end: Position };
  } = {
    contents: {
      kind: 'markdown',
      value: hoverContent,
    },
  };

  if (info.textSpan) {
    result.range = {
      start: offsetToPosition(file.content, info.textSpan.start),
      end: offsetToPosition(
        file.content,
        info.textSpan.start + info.textSpan.length,
      ),
    };
  }

  return result;
}

function handleDefinition(
  service: ts.LanguageService,
  vfs: VirtualFileSystem,
  params: TextDocumentPositionParams,
): { uri: string; range: { start: Position; end: Position } }[] {
  const file = vfs.getFile(params.textDocument.uri);
  if (!file) return [];

  const offset = positionToOffset(
    file.content,
    params.position.line,
    params.position.character,
  );

  const definitions = service.getDefinitionAtPosition(
    params.textDocument.uri,
    offset,
  );
  if (!definitions) return [];

  return definitions
    .map((def) => {
      const defFile = vfs.getFile(def.fileName);
      if (!defFile) return null;

      return {
        uri: def.fileName,
        range: {
          start: offsetToPosition(defFile.content, def.textSpan.start),
          end: offsetToPosition(
            defFile.content,
            def.textSpan.start + def.textSpan.length,
          ),
        },
      };
    })
    .filter((loc): loc is NonNullable<typeof loc> => loc !== null);
}

function handleSignatureHelp(
  service: ts.LanguageService,
  vfs: VirtualFileSystem,
  params: TextDocumentPositionParams,
): {
  signatures: Array<{
    label: string;
    documentation?: { kind: string; value: string };
    parameters?: Array<{
      label: string;
      documentation?: { kind: string; value: string };
    }>;
  }>;
  activeSignature?: number;
  activeParameter?: number;
} | null {
  const file = vfs.getFile(params.textDocument.uri);
  if (!file) return null;

  const offset = positionToOffset(
    file.content,
    params.position.line,
    params.position.character,
  );

  const sigHelp = service.getSignatureHelpItems(
    params.textDocument.uri,
    offset,
    {},
  );
  if (!sigHelp) return null;

  return {
    signatures: sigHelp.items.map((item) => {
      const label = [
        ...item.prefixDisplayParts.map((p) => p.text),
        ...item.parameters.flatMap((param, i) => {
          const paramText = param.displayParts.map((p) => p.text).join('');
          return i < item.parameters.length - 1
            ? [paramText, ', ']
            : [paramText];
        }),
        ...item.suffixDisplayParts.map((p) => p.text),
      ].join('');

      return {
        label,
        documentation:
          item.documentation.length > 0
            ? {
                kind: 'markdown' as const,
                value: item.documentation.map((d) => d.text).join('\n'),
              }
            : undefined,
        parameters: item.parameters.map((param) => ({
          label: param.displayParts.map((p) => p.text).join(''),
          documentation:
            param.documentation.length > 0
              ? {
                  kind: 'markdown' as const,
                  value: param.documentation.map((d) => d.text).join('\n'),
                }
              : undefined,
        })),
      };
    }),
    activeSignature: sigHelp.selectedItemIndex,
    activeParameter: sigHelp.argumentIndex,
  };
}
