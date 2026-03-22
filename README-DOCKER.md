# Docker Setup - Публичный доступ

## Быстрый старт

1. Запустите контейнеры:
```bash
docker compose down -v
docker compose up -d --build
```

2. Публичный URL будет создан автоматически через Cloudflare Tunnel.

3. Чтобы увидеть публичный URL, используйте один из способов:

**Способ 1: Автоматический скрипт (Linux/Mac)**
```bash
chmod +x get-url.sh
./get-url.sh
```

**Способ 2: Автоматический скрипт (Windows)**
```cmd
get-url.bat
```

**Способ 3: Вручную через логи**
```bash
docker compose logs tunnel
```

Ищите строку вида:
```
+--------------------------------------------------------------------------------------------+
|  Your quick Tunnel has been created! Visit it at (it may take some time to be reachable): |
|  https://xxxx-xxxx-xxxx.trycloudflare.com                                                 |
+--------------------------------------------------------------------------------------------+
```

**Способ 4: Быстрый поиск URL в логах**
```bash
docker compose logs tunnel | grep trycloudflare
```

## Альтернативные способы доступа

### Локальный доступ
Сайт также доступен локально на: `http://localhost:80`

### Просмотр логов в реальном времени
```bash
docker compose logs -f tunnel
```

### Остановка контейнеров
```bash
docker compose down
```

### Полная очистка (включая volumes)
```bash
docker compose down -v
```

## Примечания

- Cloudflare Tunnel создает случайный публичный URL при каждом запуске
- URL действителен пока контейнер запущен
- Для постоянного URL нужно настроить именованный tunnel через Cloudflare Dashboard

