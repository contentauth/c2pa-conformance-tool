/**
 * Ambient types for `@adobe/json-formula` 2.x.
 *
 * The published package has no `.d.ts` files — this shim covers the shape we
 * actually consume in `engine.ts`. It is intentionally narrow.
 */
declare module '@adobe/json-formula' {
  /** Opaque AST returned by `compile()`. Only valid input for `run()`. */
  export type JsonFormulaAst = unknown

  /** The interpreter instance passed as the 3rd arg to custom `_func`s. */
  export interface Interpreter {
    /** Mutable map of `$name → value`. Used to inject `$argN` at call time. */
    globals: Record<string, unknown>
    /** Evaluate a compiled AST against a data value. */
    search(ast: JsonFormulaAst, data: unknown): unknown
  }

  /** A parameter slot's type constraints — we pass `[]` or a list of `TYPE_ANY`. */
  export interface FunctionSignatureSlot {
    types: number[]
    optional?: boolean
    variadic?: boolean
  }

  export interface CustomFunctionEntry {
    /** Called with (resolvedArgs, data, interpreter). */
    _func: (
      args: unknown[],
      data: unknown,
      interpreter: Interpreter,
    ) => unknown
    _signature: FunctionSignatureSlot[]
  }

  export default class JsonFormula {
    constructor(
      customFunctions?: Record<string, CustomFunctionEntry>,
      stringToNumber?: ((s: string) => number) | null,
      debug?: unknown[],
    )

    /** Compile + run in one shot. */
    search(
      expression: string,
      json: unknown,
      globals?: Record<string, unknown>,
      language?: string,
    ): unknown

    /** Parse an expression once; reuse the AST with `run()`. */
    compile(
      expression: string,
      allowedGlobalNames?: string[],
    ): JsonFormulaAst

    /** Evaluate a previously compiled AST. */
    run(
      ast: JsonFormulaAst,
      json: unknown,
      language?: string,
      globals?: Record<string, unknown>,
    ): unknown
  }

  /** Enum of type constants used in `_signature` slots. `TYPE_ANY` is 1. */
  export const dataTypes: {
    TYPE_NUMBER: 0
    TYPE_ANY: 1
    TYPE_STRING: 2
    TYPE_ARRAY: 3
    TYPE_OBJECT: 4
    TYPE_BOOLEAN: 5
    TYPE_EXPREF: 6
    TYPE_NULL: 7
    TYPE_ARRAY_NUMBER: 8
    TYPE_ARRAY_STRING: 9
    TYPE_ARRAY_ARRAY: 10
    TYPE_EMPTY_ARRAY: 11
  }

  /** One-shot convenience — compiles + runs. */
  export function jsonFormula(
    json: unknown,
    globals: Record<string, unknown>,
    expression: string,
    customFunctions?: Record<string, CustomFunctionEntry>,
    stringToNumber?: ((s: string) => number) | null,
    debug?: unknown[],
    language?: string,
  ): unknown
}
