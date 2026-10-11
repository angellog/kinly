# Project Kinly — API + scheduler for Railway. The Paperclip plugin is built and installed separately.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
RUN npm ci --workspace packages/engine --workspace packages/server --no-audit --no-fund
COPY packages/engine packages/engine
COPY packages/server packages/server
RUN npm run build --workspace packages/engine && npm run build --workspace packages/server \
 && npm prune --omit=dev --workspace packages/engine --workspace packages/server --no-audit --no-fund

FROM node:24-alpine
ENV NODE_ENV=production \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning \
    PORT=8787 \
    KINLY_DB=/data/kinly.db \
    KINLY_DATA_ROOT=/data/repo \
    KINLY_DATA_REPO=angellog/kinly-data \
    KINLY_NO_GH_FALLBACK=1
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/engine/package.json packages/engine/
COPY --from=build /app/packages/engine/dist packages/engine/dist
COPY --from=build /app/packages/server/package.json packages/server/
COPY --from=build /app/packages/server/dist packages/server/dist
EXPOSE 8787
CMD ["node", "packages/server/dist/src/main.js"]
