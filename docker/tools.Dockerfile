# Werkzeug-Image für Init-Jobs (Schema, Seed, Prüfskripte). Build-Kontext: Repo-Wurzel.
FROM node:22-bookworm-slim
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kw/db...
ENTRYPOINT ["pnpm", "-s", "--filter", "@kw/db"]
