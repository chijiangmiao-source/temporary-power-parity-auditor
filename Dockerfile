# ---- 依赖与构建 ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- 页面服务：纯静态，nginx 托管 ----
FROM nginx:1.27-alpine AS web
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s CMD wget -qO- http://127.0.0.1:80/ >/dev/null || exit 1

# ---- 一次性验收服务：Vitest + 构建 + Playwright（对 web 容器跑 e2e）----
FROM node:20-bookworm-slim AS verify
WORKDIR /app
# Playwright 运行 Chromium 所需的系统依赖
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci \
  && npx --yes playwright install --with-deps chromium
COPY . .
# 验收内容：单元/差分测试 -> 类型检查+构建 -> 对 web 服务的端到端测试
CMD ["sh", "-c", "npm run test:unit && npm run build && npx playwright test"]
