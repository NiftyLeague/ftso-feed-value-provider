/**
 * Type utilities for mixins
 */

export type Constructor<TInstance = object, TArgs extends unknown[] = unknown[]> = new (...args: TArgs) => TInstance;

export type AbstractConstructor<TInstance = object, TArgs extends unknown[] = unknown[]> = abstract new (
  ...args: TArgs
) => TInstance;

// A "top" constructor type that preserves the real constructor args via inference.
//
// NOTE: TypeScript's built-in mixin checks require the base constructor type to be
// `new (...args: any[]) => any` for `return class extends Base {}` patterns.
// We keep the `any[]` localized to this mixin-typing utility.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyConstructor<TArgs extends any[] = any[], TInstance = object> = {
  new (...args: TArgs): TInstance;
  prototype: TInstance;
};

export type ConstructorArgs<TConstructor> = TConstructor extends abstract new (...args: infer TArgs) => unknown
  ? TArgs
  : TConstructor extends new (...args: infer TArgs) => unknown
    ? TArgs
    : TConstructor extends { new (...args: infer TArgs): unknown }
      ? TArgs
      : never;

export type ConstructorInstance<TConstructor> = TConstructor extends abstract new (
  ...args: unknown[]
) => infer TInstance
  ? TInstance
  : TConstructor extends new (...args: unknown[]) => infer TInstance
    ? TInstance
    : TConstructor extends { prototype: infer TInstance }
      ? TInstance
      : never;
