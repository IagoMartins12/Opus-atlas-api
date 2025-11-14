# ==================== STAGE 1: Dependencies ====================
FROM node:20-alpine AS deps
WORKDIR /app

# Instalar dependências do sistema para Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Configurar Puppeteer para usar Chromium instalado
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Copiar package files
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --legacy-peer-deps

# ==================== STAGE 2: Builder ====================
FROM node:20-alpine AS builder
WORKDIR /app

# Instalar dependências do sistema (necessário para build)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont

# Copiar dependencies
COPY --from=deps /app/node_modules ./node_modules

# Copiar source
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build application
RUN npm run build

# Remover dev dependencies
RUN npm prune --production --legacy-peer-deps

# ==================== STAGE 3: Runner ====================
FROM node:20-alpine AS runner
WORKDIR /app

# ✅ INSTALAR CHROME E DEPENDÊNCIAS
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    font-noto-emoji

# ✅ CONFIGURAR PUPPETEER
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Criar usuário não-root
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

# Copiar arquivos necessários
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

# Variáveis de ambiente
ENV NODE_ENV=production
ENV PORT=4000

# Expor porta
EXPOSE 4000

# Mudar para usuário não-root
USER nestjs

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => {if(r.statusCode === 200) process.exit(0); else process.exit(1);})"

# Iniciar aplicação
CMD ["node", "dist/main"]