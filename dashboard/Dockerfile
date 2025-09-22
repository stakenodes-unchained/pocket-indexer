# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json* pnpm-lock.yaml* yarn.lock* ./
RUN if [ -f package-lock.json ]; then npm ci; elif [ -f yarn.lock ]; then yarn --frozen-lockfile; elif [ -f pnpm-lock.yaml ]; then npm i -g pnpm && pnpm i --frozen-lockfile; else npm i; fi
COPY . .
RUN npm run build

# Run stage
FROM node:20-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=builder /app/.next ./.next
# COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
RUN npm i --omit=dev --ignore-scripts && adduser -D -u 1001 nextjs && chown -R nextjs:nextjs /app
USER nextjs
EXPOSE 3010
ENV PORT=3010
CMD ["node", ".next/standalone/server.js"]

