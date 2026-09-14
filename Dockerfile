FROM node:22-alpine

RUN npm install -g pnpm

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY . .

RUN pnpm install --frozen-lockfile

RUN pnpm build
