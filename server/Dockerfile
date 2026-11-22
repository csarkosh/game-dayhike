# syntax=docker/dockerfile:1

# The build context is the repo root, not server/, because this is an npm
# workspace: the lockfile lives above server/. Nothing is compiled here: the
# server is the engine's (`@csarkosh/engine-server`, the release named in
# server/package.json), which ships as compiled JavaScript.
# Build with:  docker build -f server/Dockerfile .

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The commit the image was built from, for the telemetry rows the process
# writes (the engine's server, `src/index.ts`). An argument rather than an
# environment variable on the Cloud Run service: the services' environment is
# Terraform's, and a value the deploy script set there would be a diff on every
# plan.
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
# Every workspace's package.json must be present for `npm ci` to resolve the
# lockfile, even though only the server's dependencies get used: this installs
# the server and the root and leaves the client's out, which would download the
# engine's release (116 MB) to run a server.
RUN npm ci --omit=dev --workspace server --include-workspace-root
# Which game this server serves (the engine's server reads `server/game.json`
# under its working directory).
COPY server/game.json ./server/game.json
# The saved telemetry queries the admin routes run (`queries` in game.json).
COPY tools/telemetry/queries ./tools/telemetry/queries
USER node
# Cloud Run injects PORT; 8080 is the default the server already falls back to.
ENV PORT=8080
CMD ["node", "node_modules/@csarkosh/engine-server/dist/index.js"]
