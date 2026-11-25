# Multi-stage production build for StudRide (D-012, D-021):
# 1. Build the React + Vite SPA (`frontend/dist`)
# 2. Install production-only backend dependencies and serve both `/api/*` and the SPA fallback
#    from a single non-root Node.js 20 container.

FROM node:20-alpine AS frontend-build
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:20-alpine AS backend-deps
WORKDIR /build/backend
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev

FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=3001
ENV FRONTEND_DIST_DIR=/app/frontend/dist

WORKDIR /app/backend
COPY --from=backend-deps /build/backend/node_modules ./node_modules
COPY backend/package.json ./package.json
COPY backend/src ./src
COPY backend/database ./database
COPY --from=frontend-build /build/frontend/dist /app/frontend/dist

USER node

EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:${PORT:-3001}/api/health || exit 1

CMD ["node", "src/server.js"]
