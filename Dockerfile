# HS Recuperação de Crédito — imagem de produção
FROM node:22-bookworm-slim AS web
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data WEB_DIR=/app/web/dist
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY scripts ./scripts
COPY --from=web /app/web/dist ./web/dist
RUN mkdir -p /data && chown -R node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/api/saude').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "src/server/index.js"]
