@echo off
title Iqueño SAC - Frontend React (puerto 5173)
cd /d "%~dp0"

if not exist "node_modules" (
    echo Instalando dependencias del frontend...
    call npm install
)

echo Iniciando frontend en http://localhost:5173 ...
echo Ctrl+C para detener
call npm run dev
pause