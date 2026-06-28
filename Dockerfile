FROM node:22-alpine AS workspace

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build

ENV NODE_ENV=production

EXPOSE 3000 3001 3002 3003

CMD ["node", "apps/api/dist/main.js"]