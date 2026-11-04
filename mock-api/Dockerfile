# The mock bank services (no dependencies): docker compose --profile mock up --build (from the project folder)
# The runtime is plain Alpine with only Node's program and its two libraries, the same first steps as the studio's
# image (Dockerfile), so Docker stores them once.
FROM node:22-alpine3.24 AS node
FROM alpine:3.24
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/lib/libstdc++.so.6 /usr/lib/libgcc_s.so.1 /usr/lib/
RUN addgroup -g 1000 node && adduser -D -u 1000 -G node node

WORKDIR /app
ENV PORT=4400
COPY package.json server.mjs ./
COPY src ./src
COPY data ./data
USER node
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4400/health >/dev/null || exit 1
CMD ["node", "server.mjs"]
