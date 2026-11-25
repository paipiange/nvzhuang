@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required for safe startup diagnostics.
  pause
  exit /b 1
)
node doctor.mjs --runtime
if errorlevel 1 (
  echo Install Node.js 24+ before running this launcher.
  pause
  exit /b 1
)
node doctor.mjs --port-free 8000
if errorlevel 1 (
  echo Port 8000 is already occupied. No process will be stopped.
  node doctor.mjs --backend-only
  echo To load updated backend code, close the OLD voice backend window, then run this file again.
  pause
  exit /b 1
)
where go >nul 2>nul
if errorlevel 1 (
  echo Go is required to start the voice backend from this source checkout.
  echo Install Go, then run this launcher again.
  pause
  exit /b 1
)
cd /d "%~dp0..\backend" || exit /b 1
if not defined GF_GCFG_FILE set "GF_GCFG_FILE=%~dp0voice-backend.example.yaml"
echo Starting the voice backend at http://127.0.0.1:8000 with the selected configuration.
echo Keep this window open. Qwen, FunASR and CosyVoice must be started separately.
echo For Doubao, enter your speech API key in the companion page settings or the backend environment.
echo After startup, open another terminal in girlfriend and run: node doctor.mjs --backend-only
set "ERRORLEVEL="
go run .
set "BACKEND_EXIT=%ERRORLEVEL%"
if not "%BACKEND_EXIT%"=="0" (
  echo Backend stopped or failed. Run the diagnostic above; do not paste configuration or keys into chat.
  pause
)
exit /b %BACKEND_EXIT%
