/**
 * Request/response helpers.
 */

/** An error carrying an HTTP status whose message is safe to send to a client. */
export class HttpError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
    this.expose = true;
  }
}

/**
 * Reads a query parameter as a single string, or undefined.
 *
 * Express parses `?kind=a&kind=b` into an array and `?kind[x]=y` into an object,
 * so a handler that assumes a string and calls `.split` or `.trim` throws a
 * TypeError on input any client can send. That surfaced as an unhandled 502
 * leaking the internal error text. Anything that is not a plain string is
 * rejected here rather than coerced, because coercing an array to "a,b" invents
 * a value the caller never asked for.
 *
 * @throws {HttpError} 400 when the parameter was supplied but is not a string.
 */
export function stringParam(query, name) {
  // Own properties only. Express builds req.query as a plain object, so
  // `query.constructor` would answer with an inherited function rather than
  // undefined, and a parameter that was never sent would look present.
  if (!Object.hasOwn(query ?? {}, name)) return undefined;
  const value = query[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(400, `"${name}" must be given at most once, as a single value`);
  }
  return value;
}

/**
 * Reads a query parameter as a finite number within bounds, or undefined.
 *
 * @throws {HttpError} 400 when the value is not a number, or is out of range.
 */
export function numberParam(query, name, { min = -Infinity, max = Infinity, integer = false } = {}) {
  const raw = stringParam(query, name);
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new HttpError(400, `"${name}" must be a number`);
  if (integer && !Number.isInteger(n)) {
    throw new HttpError(400, `"${name}" must be a whole number`);
  }
  if (n < min || n > max) {
    throw new HttpError(400, `"${name}" must be between ${min} and ${max}`);
  }
  return n;
}

/**
 * Response headers that cost nothing and close off whole classes of problem.
 * This is a small hand-rolled set rather than a Helmet dependency: the API
 * serves JSON only, so the useful subset is short.
 */
export function securityHeaders(_req, res, next) {
  // Stops a browser from re-interpreting a JSON body as HTML or script.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // The API has no UI, so it never needs to be framed.
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  // Keeps full URLs out of Referer when a response leads somewhere else.
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
}
