@echo off
echo Исправление проблем с Tunnel...
echo.

echo 1. Останавливаем контейнеры...
docker compose stop tunnel

echo.
echo 2. Удаляем tunnel контейнер...
docker compose rm -f tunnel

echo.
echo 3. Перезапускаем tunnel...
docker compose up -d tunnel

echo.
echo 4. Ждем 10 секунд для создания нового URL...
timeout /t 10 /nobreak >nul

echo.
echo 5. Проверяем новый публичный URL:
echo.
docker compose logs tunnel | findstr trycloudflare

echo.
echo Готово! Проверьте новый URL выше.
pause

