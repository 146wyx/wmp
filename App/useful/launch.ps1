# Music Player Launcher
# Opens the web version in default browser

$indexPath = Join-Path $PSScriptRoot "dist\index.html"

if (Test-Path $indexPath) {
    Start-Process $indexPath
    Write-Host "Music Player started!" -ForegroundColor Green
} else {
    Write-Host "Error: index.html not found" -ForegroundColor Red
    Write-Host "Please ensure dist folder exists with web files" -ForegroundColor Yellow
}
