# Build the web app, then run the server with the built files beside it.
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY shared shared
COPY web web
RUN npm run build -w web

FROM node:22-slim
ENV NODE_ENV=production
ENV PORT=5050
ENV WEB_DIST=/app/web/dist
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev -w server
COPY shared shared
COPY server server
COPY --from=build /app/web/dist web/dist
EXPOSE 5050
CMD ["node", "--import", "tsx", "server/src/index.ts"]
