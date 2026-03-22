@echo off
echo ==========================================
echo   Настройка сетевого доступа
echo ==========================================
echo.

echo 1. Определение локального IP адреса:
echo.
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set ip=%%a
    set ip=!ip:~1!
    echo   Ваш локальный IP: !ip!
    echo.
    echo   Сайт будет доступен по адресу:
    echo   http://!ip!
    echo   http://!ip!:3000
    echo.
)
echo.

echo 2. Проверка статуса контейнеров:
echo.
docker compose ps
echo.

echo 3. Проверка открытых портов:
echo.
netstat -ano | findstr ":80 " | findstr "LISTENING"
netstat -ano | findstr ":3000 " | findstr "LISTENING"
echo.

echo ==========================================
echo   Инструкции для доступа с других ПК
echo ==========================================
echo.
echo Для доступа с других компьютеров в вашей локальной сети:
echo.
echo   1. Убедитесь, что компьютеры в одной сети (Wi-Fi/LAN)
echo   2. Откройте в браузере на другом компьютере:
echo      http://[ваш-локальный-ip]
echo      или
echo      http://[ваш-локальный-ip]:3000
echo.
echo   3. Если не работает, проверьте:
echo      - Брандмауэр Windows (разрешить порты 80 и 3000)
echo      - Что контейнер запущен: docker compose ps
echo.
echo Для доступа из интернета:
echo   - Настройте проброс портов в роутере
echo   - Или используйте ngrok: ngrok http 80
echo.
pause

