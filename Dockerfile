# Reading Room as a container image. See "Running with Docker" in the
# README; docker-compose.yml runs it together with Postgres + pgvector.
#
# Debian (not Alpine): the native modules (onnxruntime for embeddings,
# @napi-rs/canvas for OCR, sharp) ship prebuilt glibc binaries.

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

# Download the default embedding model now, so the first upload doesn't
# wait for it (and works offline). Another EMBEDDING_MODEL is downloaded
# on first use into the same cache, which docker-compose.yml keeps in a
# volume.
RUN node -e "import('@xenova/transformers').then(t => t.pipeline('feature-extraction', 'Xenova/multilingual-e5-small')).then(() => console.log('Embedding model cached.'))"


FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3880

COPY --from=build /app/package.json /app/next.config.mjs ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --from=build /app/db/migrations ./db/migrations
COPY --from=build /app/scripts/migrate.mjs ./scripts/migrate.mjs
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Writable by the app: the embedding model cache (transformers.js keeps it
# inside its own package directory).
RUN chown -R node:node node_modules/@xenova/transformers/.cache

USER node
EXPOSE 3880

# Healthy once the server answers (the login page, or its redirect when
# sign-in is off).
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3880) + '/login', { redirect: 'manual' }).then(r => process.exit(r.status < 500 ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
