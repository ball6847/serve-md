/**
 * Synchronous counterpart to `to()` from `await-to-js`.
 *
 * Wraps a synchronous function call, returning a `[error, result]` tuple:
 * - `[undefined, value]` on success
 * - `[error, undefined]` on failure
 *
 * Use this for synchronous operations that can throw, maintaining the same
 * error-handling pattern as async `to()` calls throughout the codebase.
 *
 * @example
 * ```ts
 * const [err, stat] = trySync(() => this.#store.stat("README"));
 * if (!err && stat?.isFile) return "README";
 * ```
 *
 * @param fn Synchronous function to execute
 * @param onError Optional error transformer (defaults to the raw thrown value)
 */
export function trySync<T, E = Error>(
  fn: () => T,
  onError?: (err: unknown) => E,
): [E, undefined] | [undefined, T] {
  try {
    return [undefined, fn()];
  } catch (err) {
    return [onError ? onError(err) : (err as E), undefined];
  }
}
