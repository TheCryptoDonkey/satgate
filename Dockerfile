# Stage 1: Build
FROM node:22-slim AS build
WORKDIR /build
COPY package.json package-lock.json ./
# Remove file: dev dependency that won't resolve in Docker context
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); delete p.devDependencies['l402-mcp']; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN npm install
COPY tsconfig.json ./
COPY src/ ./src/
COPY bin/ ./bin/
RUN npm run build

# Stage 2: Production
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN node -e "const p=JSON.parse(require('fs').readFileSync('package.json','utf8')); delete p.devDependencies; require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"
RUN npm install --omit=dev
COPY --from=build /build/dist/ ./dist/
COPY --from=build /build/src/page/ ./dist/page/
EXPOSE 3002
CMD ["node", "dist/bin/satgate.js"]
