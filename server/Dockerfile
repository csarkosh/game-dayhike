# syntax=docker/dockerfile:1

# The build context is the repo root, not server/, because this is an npm
# workspace: the lockfile and the base tsconfig both live above server/.
# Build with:  docker build -f server/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app
# Every workspace's package.json must be present for `npm ci` to resolve the
# lockfile, even though only the server's dependencies get used.
COPY package.json package-lock.json tsconfig.base.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci
COPY server server
RUN npm run build -w server

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
# The commit the image was built from, for the telemetry rows the process
# writes (`server/src/index.ts`). An argument rather than an environment
# variable on the Cloud Run service: the services' environment is Terraform's,
# and a value the deploy script set there would be a diff on every plan.
ARG BUILD_SHA=unknown
ENV BUILD_SHA=$BUILD_SHA
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace server --include-workspace-root
COPY --from=build /app/server/dist ./server/dist
# The saved telemetry queries the admin routes run (`server/src/adminQueries.ts`).
COPY tools/telemetry/queries ./tools/telemetry/queries
USER node
# Cloud Run injects PORT; 8080 is the default the server already falls back to.
ENV PORT=8080
CMD ["node", "server/dist/index.js"]
