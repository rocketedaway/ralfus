FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# git is needed for repo operations; gh CLI for cloning via GitHub token auth
# curl + bash are needed to install the Cursor Agent CLI
RUN apk add --no-cache git github-cli curl bash

# Install Cursor Agent CLI
RUN curl -fsSL https://cursor.com/install | bash
ENV PATH="/root/.local/bin:${PATH}"

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Directory for the local libSQL database file.
# Mount a persistent volume here when running in production (e.g. fly.io volumes).
RUN mkdir -p data

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "dist/index.js"]
