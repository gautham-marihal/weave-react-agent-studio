# Weave Studio: the built app and its server (server/prod.mjs), in one small image.
#   docker compose up --build            (see docker-compose.yml and .env.docker.example)
# Settings and secrets are read when the container starts (.env.docker), never baked into the image.
# VITE_DEMO_MODE=true at build time makes the self-contained demo (an imitation API in the browser, no key needed).

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG VITE_DEMO_MODE=false
ENV VITE_DEMO_MODE=${VITE_DEMO_MODE}
RUN npx vite build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 HOST=0.0.0.0
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/apiPass.js /app/llmRoute.js /app/authRoute.js /app/credentials.txt ./
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -qO- http://127.0.0.1:8080/healthz >/dev/null || exit 1
CMD ["node", "server/prod.mjs"]
