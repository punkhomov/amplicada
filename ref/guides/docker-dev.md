---
title: Docker Dev Setup
type: guide
tier: 3
status: superseded
date: 2026-07-13
---

# Docker Dev Setup для Turborepo + pnpm монорепо

> Этот документ описывает удалённый dev-compose. Актуальный запуск: `pnpm dev`, инфраструктура в `docker-compose.infra.yaml`, API и web на хосте. См. корневой `README.md`.

## Dockerfile.dev (в корне проекта)

```dockerfile
FROM node:20-alpine

RUN npm install -g pnpm turbo

WORKDIR /app

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

CMD ["pnpm", "turbo", "run", "dev", "--filter=$APP"]
```

## docker-compose.dev.yaml

```yaml
version: '3.9'

services:
  api:
    build:
      context: .
      dockerfile: Dockerfile.dev
      args:
        APP: api
    ports:
      - "4000:4000"
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/platform_demo
    volumes:
      - .:/app
      - /app/node_modules
      - /app/apps/api/node_modules
    develop:
      watch:
        - action: sync
          path: ./packages
          target: /app/packages
        - action: sync
          path: ./apps/api
          target: /app/apps/api
        - action: restart
          path: ./apps/api
    command: pnpm turbo run dev --filter=api
    depends_on:
      - postgres
      - redis

  web:
    build:
      context: .
      dockerfile: Dockerfile.dev
      args:
        APP: web
    ports:
      - "3000:5173"
    environment:
      - NODE_ENV=development
    volumes:
      - .:/app
      - /app/node_modules
      - /app/apps/web/node_modules
    develop:
      watch:
        - action: sync
          path: ./packages
          target: /app/packages
        - action: sync
          path: ./apps/web
          target: /app/apps/web
        - action: restart
          path: ./apps/web
    command: pnpm turbo run dev --filter=web

  postgres:
    image: postgres:16-alpine
    container_name: platform-postgres
    environment:
      POSTGRES_DB: platform_demo
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: platform-redis
    ports:
      - "6379:6379"

volumes:
  pgdata:
```

## .dockerignore (в корне)

```dockerignore
node_modules
.turbo
.git
dist
build
*.log
.env*.local
coverage
```

## Команды

```bash
# Первый раз (сборка)
docker compose -f docker-compose.dev.yaml build

# Запуск в режиме разработки
docker compose -f docker-compose.dev.yaml up --watch

# Только api
docker compose -f docker-compose.dev.yaml up --watch api

# Пересборка при изменениях в зависимостях
docker compose -f docker-compose.dev.yaml up --build api
```

## Полезные советы

- **Изменение зависимостей:** Если добавил новую зависимость — выполни `pnpm install` на хосте, потом перезапусти контейнер (`docker compose up --build`)
- **node_modules:** Анонимные volumes защищают от конфликтов между хостом и контейнером
- **Производительность:** При тормозах можно убрать часть `develop.watch` и полагаться только на Turbo
- **Логи:** `docker compose logs -f api`
