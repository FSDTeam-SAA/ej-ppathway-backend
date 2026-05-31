FROM node:22-alpine

WORKDIR /app

# Install production dependencies first for better layer caching.
COPY package*.json ./
RUN npm ci --omit=dev

# App source.
COPY . .

ENV NODE_ENV=production
# Container listens on 5001 (overridable via PORT). Published to a host port in compose.
EXPOSE 5001

CMD ["node", "server.js"]
