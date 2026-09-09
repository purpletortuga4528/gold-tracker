#!/usr/bin/env node
/**
 * Runs the API and the Vite dev server together, prefixing each line so you can
 * tell them apart. Ctrl+C stops both.
 *
 * This exists instead of a `concurrently` dependency so `npm run dev` behaves
 * the same on Windows, macOS and Linux with nothing extra installed.
 *
 * Both children are launched as `node <script>` rather than `npm run dev`, with
 * no shell. Going through npm on Windows means spawning `npm.cmd`, which needs
 * `shell: true`, which Node now warns about (DEP0190) because arguments are
 * concatenated rather than escaped. Calling the scripts directly sidesteps all
 * of that. The trade-off is that the paths below have to stay in step with the
 * `dev` script in each package.json.
 */
import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TARGETS = [
  {
    name: 'api',
    cwd: resolve(ROOT, 'backend'),
    args: ['--watch', 'src/index.js'],
    color: '\x1b[33m',
    check: resolve(ROOT, 'backend/node_modules'),
    port: 5174,
  },
  {
    name: 'web',
    cwd: resolve(ROOT, 'frontend'),
    args: [resolve(ROOT, 'frontend/node_modules/vite/bin/vite.js')],
    color: '\x1b[36m',
    check: resolve(ROOT, 'frontend/node_modules/vite/bin/vite.js'),
    port: 5173,
  },
];
const RESET = '\x1b[0m';

for (const target of TARGETS) {
  if (!existsSync(target.check)) {
    console.error(
      `Missing ${target.check}\nRun "npm run setup" first to install both packages.`,
    );
    process.exit(1);
  }
}

/**
 * Resolves true when nothing is listening on the port.
 *
 * Probes by connecting, not by binding. A bind probe on 127.0.0.1 reports the
 * port free on Windows even while another process holds 0.0.0.0 on it, so the
 * first version of this check passed and the launcher went on to hit
 * EADDRINUSE anyway, which is the exact failure it exists to prevent.
 */
const portFree = (port) =>
  new Promise((res) => {
    const socket = new Socket();
    let settled = false;
    const done = (free) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      res(free);
    };
    socket.setTimeout(700);
    socket.once('connect', () => done(false));
    socket.once('timeout', () => done(true));
    socket.once('error', () => done(true));
    socket.connect(port, '127.0.0.1');
  });

/*
 * Ports are checked up front rather than left to the children to discover.
 *
 * The API runs under `node --watch`, which does NOT exit when its listen fails:
 * it prints EADDRINUSE and sits waiting for a file change. So a stale server on
 * 5174 left this launcher believing both children were healthy while the API
 * was dead. Vite meanwhile defaults to hopping to the next free port, took 5174
 * itself, and the app proxied /api to Vite and got HTML where JSON was due.
 * strictPort in vite.config.js closes the second half of that; this closes the
 * first, and says which port and which side is the problem.
 */
for (const { name, port } of TARGETS) {
  if (!(await portFree(port))) {
    console.error(
      `Port ${port} (${name}) is already in use. ` +
        'Another copy of this project is probably still running. Stop it, then try again.',
    );
    process.exit(1);
  }
}

const children = [];
let shuttingDown = false;

function stopAll(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill();
  }
  process.exitCode = code;
}

for (const { name, cwd, args, color } of TARGETS) {
  const child = spawn(process.execPath, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  children.push(child);

  const prefix = (stream) => (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) stream.write(`${color}[${name}]${RESET} ${line}\n`);
    }
  };
  child.stdout.on('data', prefix(process.stdout));
  child.stderr.on('data', prefix(process.stderr));

  child.on('exit', (code) => {
    console.log(`${color}[${name}]${RESET} exited with code ${code}`);
    stopAll(code ?? 1);
  });
  child.on('error', (err) => {
    console.error(`${color}[${name}]${RESET} failed to start: ${err.message}`);
    stopAll(1);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => stopAll(0));
}

console.log('API on http://localhost:5174, web on http://localhost:5173. Ctrl+C stops both.\n');
