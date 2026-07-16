@echo off
REM Fake Claude CLI for okx-a2a — routes all calls to Shiori via the Node shim.
setlocal
set "SHIM=%~dp0..\shiori-claude-shim.js"
if not defined SHIORI_URL set "SHIORI_URL=https://shiori-h45s.onrender.com"
node "%SHIM%" %*
exit /b %ERRORLEVEL%
