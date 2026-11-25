@echo off
setlocal
cd /d "%~dp0" || exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required. Install Node.js and run this file again.
  pause
  exit /b 1
)
node doctor.mjs --runtime
if errorlevel 1 (
  echo This launcher needs Node.js 24+ with --use-env-proxy support.
  pause
  exit /b 1
)
if not defined PORT set "PORT=8787"
set "PAGE_PORT="
for /f %%P in ('node --input-type=module -e "import {portNumber} from './doctor.mjs'; try { console.log(portNumber(process.env.PORT)); } catch { process.exitCode=2; }" 2^>nul') do set "PAGE_PORT=%%P"
if not defined PAGE_PORT (
  echo PORT must be a number from 1 to 65535.
  pause
  exit /b 2
)
node doctor.mjs --port-free "%PAGE_PORT%"
if errorlevel 2 (
  echo PORT must be a number from 1 to 65535.
  pause
  exit /b 2
)
if errorlevel 1 (
  echo The page port is already in use. No process will be stopped.
  node doctor.mjs --page-only --page "http://127.0.0.1:%PAGE_PORT%"
  echo If modules are missing, close the OLD page server window, then run this file again.
  echo Otherwise, open http://127.0.0.1:%PAGE_PORT% in your browser.
  pause
  exit /b 1
)
if not defined HTTP_PROXY set "HTTP_PROXY=http://127.0.0.1:7890"
if not defined HTTPS_PROXY set "HTTPS_PROXY=http://127.0.0.1:7890"
if not defined NO_PROXY set "NO_PROXY=localhost,127.0.0.1,::1"
echo Starting the companion page. Keep this window open.
echo The browser opens after all required page modules are reachable.
echo For a safe local diagnostic, run: node doctor.mjs
start "" /b node doctor.mjs --wait-page --open --page "http://127.0.0.1:%PAGE_PORT%"
set "ERRORLEVEL="
node --use-env-proxy server.mjs
set "SERVER_EXIT=%ERRORLEVEL%"
if not "%SERVER_EXIT%"=="0" (
  echo Page service stopped or failed. Run node doctor.mjs for safe diagnostics.
  pause
)
exit /b %SERVER_EXIT%
