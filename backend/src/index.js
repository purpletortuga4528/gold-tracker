import { createApp } from './app.js';

/*
 * A crash should say what happened.
 *
 * Express 4 does not catch a rejected async route handler; it bypasses the
 * error middleware entirely and surfaces here, where the default behaviour is
 * to terminate. Every route wraps its own body, so this should never fire, but
 * "should never fire" is exactly when a bare stack trace is least useful.
 *
 * These log and exit rather than swallow. Carrying on after an unknown failure
 * leaves the process in a state nobody has reasoned about, and for a server
 * that answers questions about money that is worse than stopping.
 */
for (const [event, label] of [
  ['unhandledRejection', 'unhandled promise rejection'],
  ['uncaughtException', 'uncaught exception'],
]) {
  process.on(event, (err) => {
    console.error(`
[fatal] ${label}. The API is stopping rather than continuing in an unknown state.`);
    console.error(err);
    process.exit(1);
  });
}
import { config } from './config.js';
import { listProviders } from './services/priceProviders/index.js';
import { startAutoRefresh } from './services/refresh.js';

const app = createApp();

if (config.autoRefresh.enabled) startAutoRefresh();

const server = app.listen(config.port, () => {
  const active = listProviders().find((p) => p.active);
  console.log(`Gold Tracker API listening on http://localhost:${config.port}`);
  console.log(`  price provider: ${active ? active.label : config.priceProvider}`);
  if (active && active.verified === false) {
    console.log('  ! this adapter is unverified; run: npm run verify:provider -- ' + active.id);
  }
  console.log(`  CORS origins:   ${config.corsOrigins.join(', ')}`);
  console.log(
    `  rate limits:    ${config.rateLimit.general}/min general, ` +
      `${config.rateLimit.priceHistory}/min price history, ${config.rateLimit.health}/min health`,
  );
  console.log(`  trust proxy:    ${config.trustProxy === false ? 'off' : config.trustProxy}`);
  console.log(
    `  auto refresh:   ${
      config.autoRefresh.enabled
        ? `every ${config.autoRefresh.intervalHours}h, when the snapshot is over ${config.autoRefresh.minAgeHours}h old`
        : 'off'
    }`,
  );
  // Stated unconditionally, on purpose. This is a standing property of how the
  // limits behave, not an event, and the person who needs to know it is the one
  // about to put a proxy in front. warnIfProxied then reports the moment it
  // actually starts happening.
  if (config.trustProxy === false) {
    console.log('    Rate limits key on the client IP. Self-hosted with nothing in front,');
    console.log('    that is one bucket for you, which is correct and needs no change.');
    console.log('    Behind a reverse proxy it is one bucket for EVERYONE, because every');
    console.log('    request arrives wearing the proxy address. Set TRUST_PROXY then.');
  } else {
    console.log(`    Forwarded headers are trusted (${config.trustProxy}). Only correct if a`);
    console.log('    proxy you control is genuinely in front; otherwise limits are bypassable.');
  }
});

/*
 * Shut down on a signal rather than being killed.
 *
 * A container restarts often, and without this every restart severs whatever
 * requests were in flight. `docker stop` sends SIGTERM and waits ten seconds
 * before killing, so closing the listener and letting open requests finish
 * costs nothing and avoids truncated responses.
 *
 * The forced exit is the backstop: a connection that never closes must not
 * hold the process past the grace period, or the shutdown becomes the kill it
 * was meant to replace.
 */
let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`
${signal} received, finishing in-flight requests`);

    const forced = setTimeout(() => {
      console.error('shutdown timed out, exiting anyway');
      process.exit(1);
    }, 8000);
    forced.unref();

    server.close((err) => {
      if (err) {
        console.error('error while closing:', err);
        process.exit(1);
      }
      console.log('stopped cleanly');
      process.exit(0);
    });
  });
}
