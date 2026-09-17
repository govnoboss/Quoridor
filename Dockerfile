FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine
WORKDIR /app
RUN apk add --no-cache tini
COPY --from=build /app/node_modules ./node_modules
COPY . .
EXPOSE 3000
ENV NODE_ENV=production
# Требуется для стабильных прав на каталог загружаемых аватарок (volume)
ENV AVATARS_DIR=/app/avatars
RUN mkdir -p /app/avatars && chown -R node:node /app/avatars
USER node
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "src/server.js"]
