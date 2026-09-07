# ทางเข้าเดียวของทุกคำสั่งในโปรเจกต์นี้ — ทุกอย่างลงเอยที่ Docker เสมอ
# ไม่มีขั้นตอนไหนที่ต้องติดตั้ง Node หรือ pnpm บนเครื่องตัวเอง

COMPOSE      := docker compose
DEV          := $(COMPOSE) -f compose.yaml
TEST         := $(COMPOSE) -f compose.test.yaml
PROD         := $(COMPOSE) -f compose.prod.yaml
NODE_IMAGE   := node:22-alpine
HOST_UID     := $(shell id -u)
HOST_GID     := $(shell id -g)

# รันคำสั่ง Node ในคอนเทนเนอร์ แล้วคืนสิทธิ์ไฟล์ที่สร้างใหม่ให้เจ้าของเครื่อง
define run_node
	docker run --rm -e HOST_UID=$(HOST_UID) -e HOST_GID=$(HOST_GID) \
		-v "$(PWD)":/app -w /app $(NODE_IMAGE) \
		sh -c 'corepack enable && export npm_config_store_dir=/tmp/pnpm-store && $(1); status=$$?; chown -R $$HOST_UID:$$HOST_GID /app >/dev/null 2>&1 || true; exit $$status'
endef

export GIT_SHA   := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
export BUILT_AT  := $(shell date -u +%Y-%m-%dT%H:%M:%SZ)
export APP_VERSION := $(shell node -p "require('./package.json').version" 2>/dev/null || echo 0.0.0-dev)

.PHONY: help install dev format test test-e2e test-all build changelog release deploy logs down clean

help: ## แสดงคำสั่งทั้งหมด
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

install: ## สร้างหรืออัปเดต pnpm-lock.yaml ในคอนเทนเนอร์
	$(call run_node,pnpm install --lockfile-only)

dev: ## ยกสภาพแวดล้อมพัฒนาที่ http://localhost:3000
	$(DEV) up --build

format: ## จัดรูปแบบไฟล์ทั้งหมดด้วย prettier
	$(call run_node,pnpm install --frozen-lockfile --prefer-offline && pnpm format)

test: ## prettier + typecheck + unit + integration + ตรวจบันทึกรุ่น
	$(TEST) build test
	$(TEST) run --rm test

test-e2e: ## ทดสอบด้วยเบราว์เซอร์จริงบนอิมเมจ production
	$(TEST) up --build --abort-on-container-exit --exit-code-from e2e e2e
	$(TEST) down -v

test-all: test test-e2e ## ชุดเดียวกับที่ CI รันทั้งหมด

build: ## build อิมเมจ production ทั้งหมด
	$(TEST) build api web

changelog: ## ประกอบ CHANGELOG.md ใหม่จาก docs/changelog
	$(call run_node,pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @repolens/shared build && node scripts/build-changelog.mjs)

release: ## เลื่อนเวอร์ชันทุกแพ็กเกจ เช่น make release V=0.2.0
	@test -n "$(V)" || (echo "ต้องระบุเวอร์ชัน เช่น: make release V=0.2.0"; exit 1)
	$(call run_node,pnpm install --frozen-lockfile --prefer-offline && pnpm --filter @repolens/shared build && node scripts/release.mjs $(V) && node scripts/build-changelog.mjs)

deploy: ## ดึงอิมเมจรุ่นล่าสุดขึ้นรันบนเซิร์ฟเวอร์ (รันบนเครื่องปลายทาง)
	git pull --ff-only
	$(PROD) pull
	$(PROD) up -d --wait
	@echo "ตรวจสุขภาพ:" && curl -fsS http://localhost/api/health && echo

logs: ## ดู log ของสภาพแวดล้อมพัฒนา
	$(DEV) logs -f --tail=100

down: ## ปิดทุกอย่าง
	-$(DEV) down
	-$(TEST) down -v

clean: down ## ปิดและล้าง volume ทั้งหมด
	-docker volume prune -f
