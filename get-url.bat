@echo off
REM Скрипт для получения публичного URL из Cloudflare Tunnel (Windows)

echo Ожидание создания публичного URL...
timeout /t 3 /nobreak >nul

echo.
echo Поиск публичного URL в логах...
echo.

REM Получаем логи и ищем URL
docker compose logs tunnel 2>nul | findstr /R "https://.*trycloudflare.com" > temp_url.txt

if exist temp_url.txt (
    REM Извлекаем URL из строки
    for /f "tokens=*" %%a in (temp_url.txt) do (
        set "line=%%a"
        REM Ищем URL в строке (формат: |  https://xxx.trycloudflare.com  |)
        echo %%a | findstr /R "https://[a-z0-9-]*\.trycloudflare\.com" >nul
        if !errorlevel! equ 0 (
            REM Извлекаем URL используя PowerShell для более точного парсинга
            for /f "delims=" %%b in ('echo %%a ^| powershell -Command "$input = $input -replace '.*(https://[a-z0-9-]+\.trycloudflare\.com).*', '$1'; $input"') do (
                set "url=%%b"
            )
            if defined url (
                echo ==========================================
                echo   ПУБЛИЧНЫЙ URL:
                echo   !url!
                echo ==========================================
                echo.
                echo Сайт доступен по адресу выше!
                goto :found
            )
        )
    )
    del temp_url.txt
)

echo URL еще не найден в логах.
echo.
echo Попробуйте выполнить вручную:
echo docker compose logs tunnel ^| findstr trycloudflare
echo.
echo Или подождите еще несколько секунд и запустите скрипт снова.
goto :end

:found
del temp_url.txt 2>nul

:end
echo.
pause

