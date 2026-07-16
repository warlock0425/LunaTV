#!/bin/bash
# 本地构建并启动 Docker 镜像 + Redis
# 用法: ./scripts/dev-docker.sh [up|down|rebuild|logs]

set -e

COMPOSE_FILE="docker-compose.dev.yml"

case "${1:-up}" in
  up)
    echo "🚀 构建并启动服务..."
    docker compose -f "$COMPOSE_FILE" up -d --build
    echo ""
    echo "✅ 服务已启动"
    echo "   应用: http://localhost:3000"
    echo "   Redis: localhost:6379"
    echo ""
    echo "   默认账号: admin / change-this-password"
    echo "   查看日志: ./scripts/dev-docker.sh logs"
    echo "   停止服务: ./scripts/dev-docker.sh down"
    ;;
  down)
    echo "🛑 停止并移除服务..."
    docker compose -f "$COMPOSE_FILE" down
    echo "✅ 已停止"
    ;;
  rebuild)
    echo "🔄 重新构建并启动..."
    docker compose -f "$COMPOSE_FILE" down
    docker compose -f "$COMPOSE_FILE" up -d --build --force-recreate
    echo "✅ 已重新构建并启动"
    ;;
  logs)
    docker compose -f "$COMPOSE_FILE" logs -f
    ;;
  *)
    echo "用法: $0 [up|down|rebuild|logs]"
    exit 1
    ;;
esac
