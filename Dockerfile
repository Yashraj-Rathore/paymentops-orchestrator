FROM node:22-alpine AS workspace

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile
RUN pnpm build:packages

EXPOSE 3000 3001 3002 3003

CMD ["pnpm", "dev"]