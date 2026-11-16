# Functions-Image für Azure Container Apps. Build-Kontext: Repo-Wurzel.
#   docker build -f apps/functions/Dockerfile -t kw-functions .
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile --filter @kw/functions... && pnpm --filter @kw/functions build

FROM mcr.microsoft.com/azure-functions/node:4-node22
ENV AzureWebJobsScriptRoot=/home/site/wwwroot \
    AzureFunctionsJobHost__Logging__Console__IsEnabled=true \
    FUNCTIONS_WORKER_RUNTIME=node
COPY --from=build /repo/apps/functions/dist /home/site/wwwroot
