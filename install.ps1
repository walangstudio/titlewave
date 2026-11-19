$ErrorActionPreference = 'Stop'
$config = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$destination = Join-Path $config 'skills/titlewave'
if (Test-Path -LiteralPath $destination) { throw "Already exists: $destination. Remove it explicitly before reinstalling." }
New-Item -ItemType Directory -Force (Split-Path $destination) | Out-Null
New-Item -ItemType Junction -Path $destination -Target (Join-Path $PSScriptRoot 'skills/titlewave') | Out-Null
Write-Output "Linked $destination. Prefer the marketplace package for managed updates."
