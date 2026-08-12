@echo off
title Iqueño SAC - Backend API (puerto 8000)
cd /d "%~dp0backend"

if not exist ".venv" (
    echo Creando entorno virtual e instalando dependencias...
    python -m venv .venv
    .venv\Scripts\python -m pip install -r requirements.txt
)

echo Iniciando backend en http://localhost:8000 ...
echo Ctrl+C para detener
.venv\Scripts\python -m uvicorn main:app --reload --port 8000
pause