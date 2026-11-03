# The mock bank services (no dependencies): docker compose --profile mock up --build (from the project folder)
FROM node:22-alpine
WORKDIR /app
ENV PORT=4400
COPY package.json server.mjs ./
COPY src ./src
COPY data ./data
USER node
EXPOSE 4400
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:4400/health >/dev/null || exit 1
CMD ["node", "server.mjs"]
