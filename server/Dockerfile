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
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
RUN npm ci --omit=dev --workspace server --include-workspace-root
COPY --from=build /app/server/dist ./server/dist
USER node
# Cloud Run injects PORT; 8080 is the default the server already falls back to.
ENV PORT=8080
CMD ["node", "server/dist/index.js"]
