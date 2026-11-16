# Build-Kontext: Repo-Wurzel.   docker build -f apps/shop/Dockerfile -t kw-shop .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kw/shop... && pnpm --filter @kw/shop build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=build /repo/apps/shop/.next/standalone ./
COPY --from=build /repo/apps/shop/.next/static ./apps/shop/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/shop/server.js"]
