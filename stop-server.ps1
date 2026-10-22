# Takes the public link offline (the site stops being reachable from the internet).
& "C:\Program Files\Tailscale\tailscale.exe" funnel reset
Write-Host "Public link is offline. Close the backend and frontend windows to stop the servers."
