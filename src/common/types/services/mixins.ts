/**
 * Type utilities for mixins
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = {}> = new (...args: any[]) => T;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractConstructor<T = {}> = abstract new (...args: any[]) => T;
