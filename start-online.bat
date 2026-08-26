@echo off
title Texas Hold'em Launcher
echo ==================================================
echo   Texas Hold'em - Start Online Game
echo ==================================================
echo.

cd /d "%~dp0"

echo Freeing port 3001 if occupied...
powershell -Command "Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess | ForEach-Object { Stop-Process -Id $_ -Force }" >nul 2>&1

echo [1/2] Starting game server (port 3001)...
start "Poker Server" cmd /k "cd /d %~dp0server && node src\index.js"

timeout /t 2 /nobreak >nul

echo Freeing ngrok if already running...
taskkill /f /im ngrok.exe >nul 2>&1

echo [2/2] Starting public tunnel (ngrok)...
start "Poker Tunnel" cmd /k "ngrok http 3001"

echo.
echo Two windows have opened:
echo.
echo   [Poker Server]  - the game server. Keep it open.
echo   [Poker Tunnel]  - after ~5 seconds it prints a line like:
echo       Forwarding  https://xxxx.ngrok-free.dev -^> http://localhost:3001
echo       ^-> THAT is your game link! Copy and send it to friends.
echo.
echo Notes:
echo   - The URL changes every restart - always copy the fresh one.
echo   - To stop the game, close both windows.
echo   - Your PC must stay on while friends are playing.
echo.
pause
