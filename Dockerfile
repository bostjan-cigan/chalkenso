# syntax=docker/dockerfile:1
# Chalkenso as one container (Next.js standalone server). `docker compose up` runs it with
# PostgreSQL; the database is migrated every time the container starts.

FROM node:20-alpine AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# Dependencies (postinstall generates the Prisma client, so it needs the schema)
FROM base AS deps
COPY package.json yarn.lock .yarnrc ./
COPY prisma ./prisma
RUN yarn install --frozen-lockfile

# The production build. The address is built into the pages, so it is a build argument.
FROM base AS build
ARG NEXT_PUBLIC_APP_URL=http://localhost:3000
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN yarn build

FROM base AS run
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 STORAGE_DIR=/app/.data/media
RUN addgroup -S app && adduser -S app -G app && mkdir -p /app/.data/media && chown -R app:app /app/.data
COPY --from=build /app/public ./public
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
# For `prisma migrate deploy` on start: the CLI, its engines and the migrations
COPY --from=build /app/prisma ./prisma
COPY --from=deps /app/node_modules/prisma ./node_modules/prisma
COPY --from=deps /app/node_modules/@prisma ./node_modules/@prisma
COPY docker/entrypoint.sh ./entrypoint.sh
USER app
EXPOSE 3000
VOLUME ["/app/.data"]
ENTRYPOINT ["./entrypoint.sh"]
