# Stage 1: Build
FROM node:22-slim AS build
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/
RUN npm run build
RUN npm prune --omit=dev

# Stage 2: Production
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=build /build/node_modules/ ./node_modules/
COPY --from=build /build/dist/ ./dist/
COPY --from=build /build/src/page/ ./dist/page/

# Run as non-root user for defence-in-depth
RUN groupadd -r satgate && useradd -r -g satgate satgate && chown -R satgate:satgate /app
USER satgate

EXPOSE 3002
CMD ["node", "dist/bin/satgate.js"]
