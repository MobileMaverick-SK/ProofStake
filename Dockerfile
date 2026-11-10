# ProofStake: one Node process (Next.js) plus a data directory for SQLite and proof photos.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# Mount a persistent volume here, or data is lost on every deploy.
ENV DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/package.json /app/next.config.mjs ./
RUN mkdir -p /data
EXPOSE 3000
# The host provides PORT; Next.js reads it. Listen on all interfaces.
CMD ["npx", "next", "start", "-H", "0.0.0.0"]
