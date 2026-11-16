# Build-Kontext: Repo-Wurzel.   docker build -f apps/legacy/Dockerfile -t kw-legacy .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kw/legacy... && pnpm --filter @kw/legacy build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/legacy/.next/standalone ./
COPY --from=build /repo/apps/legacy/.next/static ./apps/legacy/.next/static
RUN mkdir -p /data && chown node /data
USER node
EXPOSE 3001
CMD ["node", "apps/legacy/server.js"]
