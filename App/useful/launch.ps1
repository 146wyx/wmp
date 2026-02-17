# 音乐播放器启动脚本
# 使用系统默认浏览器打开网页版本

$indexPath = Join-Path $PSScriptRoot "dist\index.html"

if (Test-Path $indexPath) {
    # 使用默认浏览器打开
    Start-Process $indexPath
    Write-Host "音乐播放器已启动！" -ForegroundColor Green
} else {
    Write-Host "错误：找不到 index.html 文件" -ForegroundColor Red
    Write-Host "请确保 dist 目录存在且包含网页文件" -ForegroundColor Yellow
}
