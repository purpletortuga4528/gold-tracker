import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { priceRouter } from './routes/price.js';
import { reservesRouter } from './routes/reserves.js';
import { getFreshness } from './services/freshness.js';
import { securityHeaders, HttpError } from './lib/http.js';
import { createLimiters, warnIfProxied } from './lib/rateLimit.js';
import { serveFrontend } from './lib/serveFrontend.js';

export function createApp() {
  const app = express();

  // Must be set before the rate limiters, which read req.ip. Left off unless
  // configured: trusting a forwarded header nothing sets would let any caller
  // present a new IP per request and bypass every limit below.
  app.set('trust proxy', config.trustProxy);

  const allowAny = config.corsOrigins.includes('*');
  app.use(cors({ origin: allowAny ? true : config.corsOrigins }));
  app.use(securityHeaders);
  app.disable('x-powered-by');

  // Built per app, not shared: each limiter owns its own store, and module
  // level instances would pool every app in the process into one set of buckets.
  const limiters = createLimiters();

  // Says something only when the misconfiguration is actually happening.
  app.use('/api', warnIfProxied(config.trustProxy));

  // The tighter bucket for the 694 kB history payload sits in front of the
  // general one, so that route draws on both and runs out of the strict one
  // first. Health is exempt from the general bucket via its own skip rule.
  app.use('/api/health', limiters.health);
  app.use('/api/price/history', limiters.priceHistory);
  app.use('/api', limiters.general);

  app.get('/api/health', async (_req, res, next) => {
    // Health includes data freshness on purpose. A process that is up but
    // serving a three-month-old snapshot is not healthy in any useful sense,
    // and a monitor watching only `ok` would never notice.
    //
    // The whole body is wrapped, not just the freshness read. Express 4 does
    // not catch a rejected async handler: it never reaches the error middleware
    // and surfaces as an unhandled rejection, which terminates the process.
    try {
      let freshness;
      try {
        freshness = await getFreshness();
      } catch (err) {
        console.error('[health] could not read freshness:', err);
        freshness = { overall: 'unknown' };
      }
      res.json({
        ok: freshness.overall !== 'stale' && freshness.overall !== 'unknown',
        priceProvider: config.priceProvider,
        uptimeSeconds: Math.round(process.uptime()),
        freshness,
      });
    } catch (err) {
      next(err);
    }
  });

  app.use('/api/price', priceRouter);
  app.use('/api/reserves', reservesRouter);

  // After the API, before the 404: /api/* is always answered by the routes
  // above, never by the app's client-side-routing fallback.
  if (config.serveFrontend) serveFrontend(app);

  app.use((req, res) => {
    res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
  });

  // Express 4 identifies an error handler by its arity, so `next` has to stay.
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    const status = Number.isInteger(err?.status) ? err.status : 500;

    // What decides whether a message is returned is who wrote it, not its
    // status code. An unexpected error's message routinely carries absolute
    // filesystem paths, upstream URLs or driver internals -- the dataset
    // loader's ENOENT was doing exactly that -- so anything not deliberately
    // marked safe is logged and replaced.
    //
    // Keying that off `status >= 500` instead was wrong: it swallowed the
    // deliberate 503 telling you to run `npm run build:data`, and the 502
    // saying the price provider was unreachable, replacing both with a blank
    // "Internal server error" that gives the operator nothing to act on.
    const safe = err instanceof HttpError || err?.expose === true;

    if (status >= 500) console.error('[api] error:', err);
    res.status(status).json({
      error: safe ? err.message : status >= 500 ? 'Internal server error' : 'Bad request',
    });
  });

  return app;
}
