@echo off
title Texas Hold'em Launcher

echo ==================================================
echo   Texas Hold'em - Start Online Game (Cloudflare Tunnel)
echo ==================================================
echo.

echo [1/2] Starting game server (port 3001)...
start "Poker Server" /D "%~dp0server" cmd /k "node src\index.js"

timeout /t 2 /nobreak >nul

echo [2/2] Starting Cloudflare Tunnel (see cloudflared-config.yml)...
start "Cloudflare Tunnel" /D "%~dp0" cmd /k "cloudflared.exe tunnel --config cloudflared-config.yml run poker"

echo.
echo ==================================================
echo   Game is LIVE at the hostname set in cloudflared-config.yml
echo   Keep both windows open. Close them to stop.
echo ==================================================
echo.
pause
