# =============================================================================
# Opus Atlas API — imagem multi-stage com DOIS alvos de runtime
# =============================================================================
#
#   docker build                 -t opus-atlas-api .      (alvo padrão: api)
#   docker build --target worker -t opus-atlas-worker .
#
# **Por que o alvo `api` é o último do arquivo.** `docker build` sem `--target`
# constrói o último estágio. Enquanto o `worker` ocupava essa posição, quem
# construísse sem dizer o alvo — e há plataformas de deploy que simplesmente
# não oferecem onde dizê-lo, o Render entre elas — recebia a imagem do worker
# achando que era a da API: 400MB de Chromium a mais e, pior, `QUEUE_ROLE=worker`,
# um processo que só consome fila e nunca enfileira. O sintoma seria tudo que
# depende de job (e-mail, scraping, backup) parar sem erro nenhum no log.
#
# Quem precisa do worker continua pedindo `--target worker`, como sempre.
#
# Por que dois alvos: os scrapers usam Puppeteer, que precisa do Chromium
# (~400MB, mais fontes e libs de sistema). Antes o Chromium ia junto no runtime
# da API, com duas consequências ruins:
#
#   1. Toda réplica da API carregava um navegador que ela nunca abre, deixando
#      pull e cold start muito mais lentos — justamente o que dói ao escalar
#      horizontalmente.
#   2. O scraping rodava dentro do processo HTTP, disputando CPU com o tráfego
#      de usuário. Uma varredura pesada degradava a API inteira.
#
# O alvo `api` fica enxuto; só o `worker` carrega o navegador. É também o passo
# de infraestrutura que prepara a fila (BullMQ) da fase de scrapers.
# =============================================================================

# ==================== STAGE 1: dependências ====================
FROM node:20-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --legacy-peer-deps

# ==================== STAGE 2: build ====================
FROM node:20-alpine AS builder
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# O Puppeteer não baixa o Chromium durante o build: quem precisa dele é o
# runtime do worker, que instala o pacote do sistema.
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN npx prisma generate
RUN npm run build

# Dependências de produção, já sem devDependencies.
RUN npm prune --omit=dev --legacy-peer-deps

# ==================== STAGE 3: base comum de runtime ====================
FROM node:20-alpine AS runtime-base
WORKDIR /app

# `dumb-init` como PID 1: repassa SIGTERM ao Node, que é o que permite o
# graceful shutdown do Nest drenar as conexões antes de encerrar.
RUN apk add --no-cache dumb-init

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nestjs

COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./

ENV NODE_ENV=production
USER nestjs

# ==================== STAGE 4a: worker de scraping (com Chromium) ====================
FROM runtime-base AS worker

USER root
RUN apk add --no-cache \
      chromium \
      nss \
      freetype \
      harfbuzz \
      ca-certificates \
      ttf-freefont \
      font-noto-emoji
USER nestjs

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser

# Só consome fila (Etapa 1.6). Até aqui os dois alvos rodavam exatamente o
# mesmo processo e o `worker` existia só para carregar o Chromium; é esta
# variável que finalmente os separa.
ENV QUEUE_ROLE=worker

# O processo HTTP continua de pé, e de propósito: não é para receber tráfego de
# usuário — o alvo não expõe porta — mas é o que dá ao orquestrador uma
# readiness real do worker. Sem isso, um worker que perdeu o banco fica de pé
# consumindo job e falhando, sem nada que o derrube.
ENV PORT=4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/api/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]
# ==================== STAGE 4b: API (sem Chromium) — ALVO PADRÃO, deve ser o último ====================
FROM runtime-base AS api

# Só enfileira. Nenhum worker BullMQ é aberto neste processo, então uma
# varredura de scraping ou um envio de dez mil e-mails nunca disputa CPU com o
# tráfego de usuário.
ENV QUEUE_ROLE=api
ENV PORT=4000
EXPOSE 4000

# Aponta para a readiness, não para a liveness: o que interessa ao balanceador
# é se esta instância consegue de fato atender (banco e cache acessíveis).
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||4000)+'/api/health/ready',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main"]

