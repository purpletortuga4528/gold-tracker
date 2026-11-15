import express from 'express';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Where `npm run build` puts the built app. */
export const DIST = resolve(HERE, '../../../frontend/dist');

export const distExists = (dir = DIST) => existsSync(join(dir, 'index.html'));

/**
 * Content Security Policy for the app itself.
 *
 * Deliberately not the API's policy. The API sends `default-src 'none'`, which
 * is right for a JSON endpoint and would block the app's own script and
 * stylesheet outright. This is the loosest thing that still runs:
 *
 *   script-src 'self'      only our own bundle, no CDN, no inline <script>...
 *   'unsafe-inline'        ...except the theme boot script in index.html, which
 *                          has to run before first paint and so cannot be a
 *                          separate request. Scoped to script-src-elem below so
 *                          it does not also permit inline event handlers.
 *   style-src-attr         React and Recharts set style attributes on elements;
 *                          without this every chart renders unstyled.
 *   connect-src 'self'     the API is same-origin here, so nothing else is
 *                          reachable, which is the point of serving both from
 *                          one process.
 *   font-src 'self'        the typeface is self-hosted; no font CDN is allowed.
 *   frame-ancestors 'none' the app is not framable.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "script-src-elem 'self' 'unsafe-inline'",
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

function appHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', APP_CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
}

/** Shown instead of a broken page when the app has not been built yet. */
const NOT_BUILT = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Gold Tracker: not built</title>
<style>
  :root { color-scheme: light dark }
  body { font: 16px/1.6 system-ui, sans-serif; margin: 3rem auto; max-width: 34rem; padding: 0 1rem }
  code { background: color-mix(in srgb, currentColor 10%, transparent); padding: .15em .4em; border-radius: 4px }
</style></head>
<body>
  <h1>The app has not been built</h1>
  <p>The API is running and serving JSON, but there is no built frontend to show.
     Build it once and reload:</p>
  <p><code>npm run build</code></p>
  <p>For development with hot reloading, use <code>npm run dev</code> instead,
     which runs Vite on port 5173 and proxies the API.</p>
</body></html>`;

/**
 * Serves the built frontend alongside the API, so self-hosting is one process
 * on one port rather than a dev server plus a proxy.
 *
 * Mounted after the API routes and before the 404 handler, so `/api/*` is
 * always answered by the API and never by the SPA fallback. A request for a
 * missing asset gets a 404, not index.html: returning HTML for a missing
 * JavaScript file produces a syntax error in the console rather than an honest
 * failure.
 */
export function serveFrontend(app, { dir = DIST } = {}) {
  if (!distExists(dir)) {
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.status(503).type('html').send(NOT_BUILT);
    });
    return { serving: false, dir };
  }

  /*
   * index.html is re-read when it changes on disk, rather than held from
   * startup.
   *
   * Holding it meant that rebuilding while the server ran left it serving the
   * previous shell, which names the previous bundle by its fingerprinted
   * filename. That file is gone after a rebuild, so the browser got the app
   * shell, asked for a script that 404s, and rendered nothing: a blank page,
   * no error anywhere on the server, and a stale document it had read once and
   * never checked again. It cost a confusing half hour of the browser suite
   * failing on "no table rows" before the cause turned out to be the server,
   * not the app.
   *
   * A stat per navigation is nothing next to the 180 kB bundle the same page
   * load fetches, and it removes the whole class of problem rather than
   * documenting it.
   */
  const indexPath = join(dir, 'index.html');
  let cached = { mtimeMs: -1, html: '' };

  const readIndex = () => {
    try {
      const { mtimeMs } = statSync(indexPath);
      if (mtimeMs !== cached.mtimeMs) {
        cached = { mtimeMs, html: readFileSync(indexPath, 'utf8') };
      }
    } catch {
      // Removed or unreadable mid-flight. Whatever was last read is a better
      // answer than a crash, and the 503 branch above covers a missing build
      // at startup.
    }
    return cached.html;
  };

  readIndex();

  app.use(appHeaders);

  // Fingerprinted assets can be cached hard; index.html must not be, or a
  // rebuild leaves browsers pinned to a stale bundle.
  app.use(
    express.static(dir, {
      index: false,
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  // Client-side routes such as /countries/USA must survive a refresh, so a
  // remaining non-API GET returns the app shell.
  //
  // But only for navigations. An earlier version fell back for everything,
  // which meant a request for a missing /assets/*.js answered 200 with HTML;
  // the browser then reported a syntax error in a script that does not exist,
  // rather than the 404 that would have said what was actually wrong. A path
  // whose last segment carries an extension is a file request, and a missing
  // file is a 404.
  const looksLikeAFile = (path) => /\.[a-zA-Z0-9]+$/.test(path.split('/').pop() ?? '');

  app.get(/^\/(?!api\/).*/, (req, res, next) => {
    if (looksLikeAFile(req.path)) return next();

    const html = readIndex();
    // Empty only if the very first read failed, in the gap between the
    // distExists check above and the read below. Narrow, but an empty 200 is
    // the worst available answer: a blank page that claims to have worked. The
    // same page a never-built checkout gets is the honest one.
    if (!html) return res.status(503).type('html').send(NOT_BUILT);

    res.type('html').set('Cache-Control', 'no-cache').send(html);
  });

  return { serving: true, dir };
}
