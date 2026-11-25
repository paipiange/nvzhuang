# Run in Windows PowerShell: powershell -ExecutionPolicy Bypass -File .\setup-windows.ps1
# ONLY creates the requested D: folder tree. Does not change system-wide settings.
$ErrorActionPreference = 'Stop'
$root = 'D:\ai\ai\nvzhuang'
if (-not (Test-Path 'D:\')) { throw 'D: drive not found. This package requires D:\ai\ai\nvzhuang.' }
$folders = @(
  'models\qwen', 'models\funasr', 'models\cosyvoice3',
  'cache\huggingface\hub', 'cache\huggingface\xet', 'cache\huggingface\datasets',
  'cache\modelscope', 'cache\pip', 'cache\uv', 'cache\conda\pkgs',
  'cache\torch', 'cache\torchinductor', 'cache\triton', 'cache\cuda',
  'cache\numba', 'cache\pycache', 'cache\xdg', 'cache\tmp',
  'cache\matplotlib', 'cache\git-lfs', 'cache\go-build', 'cache\go-mod',
  'cache\home-funasr', 'cache\home-qwen', 'config\xdg',
  'src', 'envs', 'voices', 'logs', 'docker\disk', 'data', 'deploy'
)
foreach ($relative in $folders) { New-Item -ItemType Directory -Path (Join-Path $root $relative) -Force | Out-Null }
Write-Host "Created folders under $root" -ForegroundColor Green
Write-Host 'Next: Docker Desktop > Settings > Resources > Advanced > Disk image location:'
Write-Host "      $root\docker\disk"
Write-Host 'Then run setup-wsl.sh from WSL Ubuntu.'
Write-Host 'NOTE: Changing Docker disk image location is a manual Docker Desktop action.'
