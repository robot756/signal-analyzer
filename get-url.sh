#!/bin/bash
# Скрипт для получения публичного URL из Cloudflare Tunnel

echo "Ожидание создания публичного URL..."
sleep 5

# Пытаемся найти URL в логах
URL=$(docker compose logs tunnel 2>/dev/null | grep -oP 'https://[a-z0-9-]+\.trycloudflare\.com' | head -1)

if [ -z "$URL" ]; then
    echo "URL еще не создан. Попробуйте через несколько секунд:"
    echo "docker compose logs tunnel | grep trycloudflare"
else
    echo ""
    echo "=========================================="
    echo "  Публичный URL: $URL"
    echo "=========================================="
    echo ""
    echo "Сайт доступен по адресу выше!"
fi

