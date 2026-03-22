@echo off
REM Простой скрипт для получения публичного URL

echo.
echo ==========================================
echo   Публичный URL Cloudflare Tunnel:
echo ==========================================
echo.

docker compose logs tunnel 2>nul | findstr /R "https://.*trycloudflare.com"

echo.
echo Если URL не найден, подождите несколько секунд и запустите скрипт снова.
echo.
pause

