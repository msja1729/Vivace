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
  if ($LASTEXITCODE -ne 0) {
    # Next.js sometimes stops once to show a security notice; the same build then goes through.
    Write-Host "Build stopped; trying once more..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Frontend build failed" }
  }
}

Write-Host "Starting frontend on port 3000..." -ForegroundColor Cyan
Start-Process powershell -WorkingDirectory "$root\frontend" -ArgumentList "-NoExit", "-Command", "npm start"

# After a restart Tailscale can stay stuck on "starting" until its app is open: open it and wait.
$ready = $false
for ($i = 0; $i -lt 40; $i++) {
  $status = (& $tailscale status 2>&1 | Select-Object -First 3) -join " "
  if ($status -notmatch "starting|NoState|Logged out|stopped") { $ready = $true; break }
  if ($i -eq 0) {
    Write-Host "Waiting for Tailscale to connect..." -ForegroundColor Cyan
    Start-Process "C:\Program Files\Tailscale\tailscale-ipn.exe"
  }
  Start-Sleep 3
}
if (-not $ready) { throw "Tailscale didn't connect. Open the Tailscale app, sign in if asked, then run this script again." }

# Funnel routes: /api (HTTP + WebSockets) -> backend, everything else -> frontend
& $tailscale funnel --bg 3000 | Out-Null
& $tailscale funnel --bg --set-path /api http://127.0.0.1:8000/api | Out-Null

Write-Host ""
Write-Host "Live at: https://msi.tail28cb1f.ts.net" -ForegroundColor Green
Write-Host "To stop: close the two server windows, then run .\stop-server.ps1"
