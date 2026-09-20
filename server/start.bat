@echo off
REM ===================================================================
REM  Suguo AI Assortment - Backend one-click launcher (Windows)
REM  Step 1: create venv if missing
REM  Step 2: install requirements
REM  Step 3: bind port is occupied check
REM  Step 4: start uvicorn
REM  NOTE: keep this file ASCII-only. cmd.exe reads .bat in the OEM
REM  codepage (936 on zh-CN), so UTF-8 Chinese text would be garbled.
REM ===================================================================
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1
cd /d "%~dp0"

set "PYEXE=.venv\Scripts\python.exe"

if not exist "%PYEXE%" (
  echo [1/4] Creating virtual environment .venv ...
  where python >nul 2>&1
  if errorlevel 1 (
    echo ERROR: python not found in PATH. Install Python 3.11+ first.
    goto :err
  )
  python -m venv .venv
  if errorlevel 1 goto :err
) else (
  echo [1/4] Virtual environment already exists.
)

echo [2/4] Installing dependencies ...
"%PYEXE%" -m pip install --quiet --upgrade pip
"%PYEXE%" -m pip install --quiet -r requirements.txt
if errorlevel 1 goto :err

echo [3/4] Checking port 8000 ...
netstat -ano | findstr ":8000 " | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo WARNING: port 8000 seems occupied. Close the other process or edit this script.
)

echo [4/4] Starting service ...
echo.
echo   API  : http://127.0.0.1:8000/api/v1
echo   Docs : http://127.0.0.1:8000/docs
echo   Demo accounts: admin / purchase / category / manager / viewer
echo   Password for all demo accounts: 123456
echo.
echo   First start will auto-seed the database (takes a few seconds).
echo   Press Ctrl+C to stop.
echo.
"%PYEXE%" -m uvicorn app.main:app --host 127.0.0.1 --port 8000
goto :eof

:err
echo.
echo FAILED. See messages above.
pause
exit /b 1
