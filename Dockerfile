# syntax=docker/dockerfile:1

# ─────────────────────────────────────────────────────────────
# ฐานร่วมของทุกขั้น — Node 22 พร้อม pnpm
# ─────────────────────────────────────────────────────────────
FROM node:22-alpine AS base
# git จำเป็นทั้งตอนโคลน repo ของผู้ใช้และตอนรันชุดทดสอบไปป์ไลน์
RUN corepack enable && apk add --no-cache git
WORKDIR /app
ENV PNPM_HOME="/root/.local/share/pnpm" \
    PATH="/root/.local/share/pnpm:$PATH" \
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# ─────────────────────────────────────────────────────────────
# ติดตั้ง dependency — คัดลอกเฉพาะไฟล์ manifest ก่อน เพื่อให้ layer นี้ถูก cache
# ─────────────────────────────────────────────────────────────
FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/analyzer/package.json packages/analyzer/
COPY packages/db/package.json packages/db/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/worker/package.json apps/worker/
COPY tests/e2e/package.json tests/e2e/
# เก็บ store ไว้ใน cache ของ BuildKit — การลองใหม่หลังเน็ตหลุดจะไม่ต้องโหลดซ้ำทั้งหมด
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir /pnpm/store

# ─────────────────────────────────────────────────────────────
# ซอร์สทั้งหมด + แพ็กเกจร่วมที่คอมไพล์แล้ว (แอปทุกตัวพึ่งของสองชิ้นนี้)
# ─────────────────────────────────────────────────────────────
FROM deps AS source
COPY . .
RUN pnpm --filter @repolens/shared build \
    && pnpm --filter @repolens/analyzer build \
    && pnpm --filter @repolens/db build

# ─────────────────────────────────────────────────────────────
# ชุดทดสอบ — คำสั่งเดียวกับที่ CI รัน
# ─────────────────────────────────────────────────────────────
FROM source AS test
CMD ["sh", "-c", "pnpm format:check && pnpm typecheck && pnpm -r test && node scripts/check-changelog.mjs"]

# ─────────────────────────────────────────────────────────────
# ทดสอบปลายทางด้วยเบราว์เซอร์จริง (เบราว์เซอร์มากับอิมเมจของ Playwright)
# ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS e2e
WORKDIR /app
COPY --from=source /app /app
WORKDIR /app/tests/e2e
CMD ["npx", "playwright", "test"]

# ─────────────────────────────────────────────────────────────
# build ของจริง
# ─────────────────────────────────────────────────────────────
FROM source AS build
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=dev
ARG BUILT_AT=
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILT_AT=$BUILT_AT
RUN pnpm --filter @repolens/api build \
    && pnpm --filter @repolens/worker build \
    && pnpm --filter @repolens/web build

# ─────────────────────────────────────────────────────────────
# อิมเมจ API
# ─────────────────────────────────────────────────────────────
FROM base AS api
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=dev
ARG BUILT_AT=
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILT_AT=$BUILT_AT \
    CHANGELOG_DIR=/app/docs/changelog \
    PORT=3001
COPY --from=build /app /app
USER node
EXPOSE 3001
CMD ["node", "apps/api/dist/server.js"]

# ─────────────────────────────────────────────────────────────
# อิมเมจ worker — ต้องมี git เพราะเป็นตัวที่โคลน repo จริง
# ─────────────────────────────────────────────────────────────
FROM base AS worker
ARG APP_VERSION=0.0.0-dev
ARG GIT_SHA=dev
ARG BUILT_AT=
ENV NODE_ENV=production \
    APP_VERSION=$APP_VERSION \
    GIT_SHA=$GIT_SHA \
    BUILT_AT=$BUILT_AT
COPY --from=build /app /app
USER node
CMD ["node", "apps/worker/dist/worker.js"]

# ─────────────────────────────────────────────────────────────
# อิมเมจเว็บ (Next standalone)
# ─────────────────────────────────────────────────────────────
FROM base AS web
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME=0.0.0.0
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
