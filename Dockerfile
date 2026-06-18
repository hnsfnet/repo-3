FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci || npm install

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

FROM node:20-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV JUQIAO_CONFIG_PATH=/app/config/app.yaml

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --production

COPY --from=builder /app/dist ./dist
COPY config ./config

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health/live || exit 1

CMD ["node", "dist/app.js"]
