# Starts the backend + frontend and publishes them at https://msi.tail28cb1f.ts.net
# Run from the project folder:  powershell -ExecutionPolicy Bypass -File .\start-server.ps1
# Add -SkipBuild to reuse the last frontend build (faster when only the backend changed).
param([switch]$SkipBuild)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$tailscale = "C:\Program Files\Tailscale\tailscale.exe"

Write-Host "Starting backend on port 8000..." -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory "$root\backend" -ArgumentList "-NoExit", "-Command",
  "uv run alembic upgrade head; uv run uvicorn app.main:app --host 127.0.0.1 --port 8000"

Set-Location "$root\frontend"
if (-not $SkipBuild) {
  Write-Host "Building frontend (takes a minute)..." -ForegroundColor Cyan
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
}

Write-Host "Starting frontend on port 3000..." -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory "$root\frontend" -ArgumentList "-NoExit", "-Command", "npm start"

# Funnel routes: /api (HTTP + WebSockets) -> backend, everything else -> frontend
& $tailscale funnel --bg 3000 | Out-Null
& $tailscale funnel --bg --set-path /api http://127.0.0.1:8000/api | Out-Null

Write-Host ""
Write-Host "Live at: https://msi.tail28cb1f.ts.net" -ForegroundColor Green
Write-Host "To stop: close the two server windows, then run .\stop-server.ps1"
