/**
 * Safely read a message out of a caught value.
 *
 * `catch` binds an `unknown` in modern JS/TS — for a good reason: NOT everything thrown is an
 * `Error`. `throw 'something broke'`, a rejected promise with a string, or a Firebase error object
 * all land in the same block. Reading `.message` off a string yields `undefined`, so the UI would
 * show nothing at all instead of the failure.
 *
 * This coerces any thrown value into a printable string and never throws itself.
 *
 * @param {unknown} err
 * @param {string} [fallback]
 * @returns {string}
 */
export const errorMessage = (err, fallback = 'Something went wrong.') => {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === 'string' && err) return err;
  if (err && typeof err === 'object' && 'message' in err) {
    const m = /** @type {{ message?: unknown }} */ (err).message;
    if (typeof m === 'string' && m) return m;
  }
  if (err != null) {
    const s = String(err);
    if (s) return s;
  }
  return fallback;
};

/**
 * Read a machine-readable code off a caught value (Firebase uses `auth/*` codes).
 * Returns `''` when the value carries no usable code, so callers can compare without guards.
 *
 * @param {unknown} err
 * @returns {string}
 */
export const errorCode = (err) => {
  if (err && typeof err === 'object' && 'code' in err) {
    const c = /** @type {{ code?: unknown }} */ (err).code;
    if (typeof c === 'string') return c;
  }
  return '';
};
