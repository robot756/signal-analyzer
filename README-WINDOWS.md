# Получение публичного URL на Windows

## Самый простой способ

Просто выполните в CMD:

```cmd
docker compose logs tunnel | findstr trycloudflare
```

Вы увидите строку с URL, например:
```
https://newton-please-corporations-readings.trycloudflare.com
```

## Альтернативные способы

### Способ 1: Простой скрипт
```cmd
get-url-simple.bat
```

### Способ 2: Улучшенный скрипт
```cmd
get-url.bat
```

### Способ 3: Последние 20 строк логов
```cmd
docker compose logs --tail=20 tunnel
```

### Способ 4: Логи в реальном времени (нажмите Ctrl+C для остановки)
```cmd
docker compose logs -f tunnel
```

## Ваш текущий URL

Судя по вашим логам, ваш публичный URL:
**https://newton-please-corporations-readings.trycloudflare.com**

Этот URL будет работать, пока контейнеры запущены.

