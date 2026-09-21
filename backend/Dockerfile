# --- base ---
FROM node:20-alpine AS base
# node:20-alpine non include OpenSSL: senza, gli engine binari di Prisma
# (generate/db push, e il client a runtime) falliscono in modo criptico
# ("Could not parse schema engine response").
RUN apk add --no-cache openssl
WORKDIR /app
COPY package*.json ./
COPY prisma ./prisma

# --- dev (usato da docker-compose per hot reload) ---
FROM base AS dev
RUN npm install
RUN npx prisma generate
COPY . .
EXPOSE 3000
CMD ["npm", "run", "start:dev"]

# --- build (produzione) ---
FROM base AS build
RUN npm ci
COPY . .
RUN npx prisma generate
RUN npm run build

# --- production ---
FROM node:20-alpine AS production
RUN apk add --no-cache openssl
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "dist/main"]
