@echo off
echo ==========================================
echo   Диагностика Docker контейнеров
echo ==========================================
echo.

echo 1. Проверка статуса контейнеров:
echo.
docker compose ps
echo.

echo 2. Проверка логов React приложения:
echo.
docker compose logs --tail=20 react
echo.

echo 3. Проверка доступности локально:
echo.
echo Проверка http://localhost:
curl -I http://localhost 2>nul || echo   - Недоступен
echo.
echo Проверка http://localhost:3000:
curl -I http://localhost:3000 2>nul || echo   - Недоступен
echo.

echo 4. Проверка портов:
echo.
netstat -ano | findstr ":80 " | findstr "LISTENING"
echo.

echo 5. Локальный IP адрес:
echo.
ipconfig | findstr "IPv4"
echo.

echo ==========================================
echo   Диагностика завершена
echo ==========================================
echo.
echo Сайт должен быть доступен по адресам:
echo   - http://localhost
echo   - http://localhost:3000
echo.
pause

