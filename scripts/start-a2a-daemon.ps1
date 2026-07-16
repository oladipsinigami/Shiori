# Start OKX A2A daemon with Shiori as the AI brain (Claude CLI shim).
# Prerequisites:
#   1. npm install -g @okxweb3/a2a-node@latest
#   2. onchainos agent login / identity already configured for Shiori ASP
#   3. Node 22+
#
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\start-a2a-daemon.ps1

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$Shim = Join-Path $Root 'scripts\shiori-claude-shim.js'
$ShioriUrl = if ($env:SHIORI_URL) { $env:SHIORI_URL } else { 'https://shiori-h45s.onrender.com' }

if (-not (Get-Command okx-a2a -ErrorAction SilentlyContinue)) {
  Write-Host 'okx-a2a not found. Installing @okxweb3/a2a-node@latest globally...'
  npm install -g @okxweb3/a2a-node@latest
}

$env:SHIORI_URL = $ShioriUrl
$env:OKX_A2A_AI_CLAUDE_COMMAND = "node $Shim"

Write-Host "SHIORI_URL=$env:SHIORI_URL"
Write-Host "OKX_A2A_AI_CLAUDE_COMMAND=$env:OKX_A2A_AI_CLAUDE_COMMAND"
Write-Host 'Starting okx-a2a daemon with provider=claude (Shiori shim)...'

# Prefer no-autostart so we can control the process for demos
okx-a2a daemon start --provider claude --no-autostart
okx-a2a daemon status
