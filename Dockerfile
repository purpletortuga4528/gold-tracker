# Two stages: the build tooling never reaches the running image.
#
# Node 24 to build, because Vite and the test tooling want a recent Node. Node
# 22 to run, because that is all the API needs and a smaller surface is worth
# having. The API's own floor is 20.6 and CI proves it, but there is no reason
# to ship the oldest thing that works.

FROM node:24-alpine AS build
WORKDIR /app

# Manifests first, so a source edit does not invalidate the dependency layer.
COPY package.json ./
COPY backend/package.json backend/package-lock.json ./backend/
COPY frontend/package.json frontend/package-lock.json ./frontend/

# `npm ci` rather than `npm install`: an image should build the lockfile's
# dependency tree, not resolve a new one.
RUN npm ci --prefix backend && npm ci --prefix frontend

COPY . .
RUN npm run build --prefix frontend


FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production
# The API serves the built app from this same process. There is no second
# container, no proxy, and nothing cross-origin.
ENV PORT=5174
ENV SERVE_FRONTEND=true

# Production dependencies only. The frontend's are all build-time.
COPY backend/package.json backend/package-lock.json ./backend/
RUN npm ci --omit=dev --prefix backend && npm cache clean --force

COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts
COPY backend/data ./backend/data
COPY --from=build /app/frontend/dist ./frontend/dist
COPY package.json LICENSE NOTICE.md ./

# The node image ships a non-root `node` user. The container writes only to
# backend/data, when the scheduled refresh rebuilds the snapshot, so that is
# the one path it needs to own.
RUN chown -R node:node /app/backend/data
USER node

EXPOSE 5174

# Reports unhealthy when the snapshot has gone stale as well as when the process
# is down. Stale means the thresholds in services/freshness.js: a snapshot over
# 70 days old, or figures over 120. A container that is up and serving a
# snapshot nobody has rebuilt since May is not healthy in any sense that
# matters, and a check that only pings the port would call it fine.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5174)+'/api/health').then(r=>r.json()).then(j=>process.exit(j.ok?0:1)).catch(()=>process.exit(1))"

# Directly, not through npm: npm swallows signals, so `docker stop` would wait
# out its timeout and then kill the container rather than shutting it down.
CMD ["node", "backend/src/index.js"]
