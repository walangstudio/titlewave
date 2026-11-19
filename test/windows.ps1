$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$cli = Join-Path $root 'bin/titlewave.mjs'
$results = @()
if ($env:HERDR_ENV -eq '1' -and (Get-Command herdr -ErrorAction SilentlyContinue)) {
  $pane = (herdr pane split --current --direction right --no-focus --cwd $root | ConvertFrom-Json).result.pane.pane_id
  if (-not $pane) { throw 'Herdr did not create a test pane' }
  $previous = $env:HERDR_PANE_ID
  try {
    $env:HERDR_PANE_ID = $pane
    & node $cli terminal 'Titlewave Herdr test'
    if ($LASTEXITCODE -ne 0) { throw 'Herdr rename failed' }
    $saved = (herdr pane get $pane | ConvertFrom-Json).result.pane.label
    if ($saved -ne 'Titlewave Herdr test') { throw "Unexpected Herdr title: $saved" }
    $results += 'PASS Herdr targeted pane'
  } finally { $env:HERDR_PANE_ID = $previous; herdr pane close $pane | Out-Null }
}
if (Get-Command wezterm -ErrorAction SilentlyContinue) {
  $panes = wezterm cli --no-auto-start list --format json 2>$null
  if ($LASTEXITCODE -eq 0) {
    $pane = (wezterm cli --no-auto-start spawn --new-window --cwd $root -- powershell.exe -NoLogo -NoProfile -NoExit).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'WezTerm did not create a test pane' }
    $previousHerdr = $env:HERDR_PANE_ID
    $previousWezterm = $env:WEZTERM_PANE
    try {
      Remove-Item Env:HERDR_PANE_ID -ErrorAction SilentlyContinue
      $env:WEZTERM_PANE = $pane
      & node $cli terminal 'Titlewave WezTerm test'
      if ($LASTEXITCODE -ne 0) { throw 'WezTerm rename failed' }
      $saved = (wezterm cli --no-auto-start list --format json | Out-String | ConvertFrom-Json) | Where-Object { "$($_.pane_id)" -eq $pane }
      if ($saved.tab_title -ne 'Titlewave WezTerm test') { throw 'WezTerm did not save the tab title' }
      $results += 'PASS WezTerm targeted tab'
    } finally {
      $env:HERDR_PANE_ID = $previousHerdr
      $env:WEZTERM_PANE = $previousWezterm
      wezterm cli --no-auto-start kill-pane --pane-id $pane | Out-Null
    }
  }
}
$evidence = Join-Path $root ('.evidence/console-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $evidence | Out-Null
$script = @'
'HERDR_PANE_ID','TMUX','TMUX_PANE','STY','WINDOW','ZELLIJ','WEZTERM_PANE','KITTY_WINDOW_ID' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
& node '__CLI__' terminal 'Titlewave console test' 2>&1 | Out-File '__LOG__'
[Console]::Title | Out-File '__TITLE__'
'@
$script = $script.Replace('__CLI__', $cli.Replace("'", "''")).Replace('__LOG__', (Join-Path $evidence 'output.txt').Replace("'", "''")).Replace('__TITLE__', (Join-Path $evidence 'title.txt').Replace("'", "''"))
$scriptPath = Join-Path $evidence 'console.ps1'
$script | Set-Content -LiteralPath $scriptPath -Encoding utf8
$console = Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoLogo','-NoProfile','-File',('"' + $scriptPath + '"') -PassThru
try {
  if (-not $console.WaitForExit(10000)) { throw 'Console check timed out' }
  $saved = Get-Content -Raw (Join-Path $evidence 'title.txt') -ErrorAction SilentlyContinue
  if (-not $saved -or $saved.Trim() -ne 'Titlewave console test') { throw ('Console did not save the title: ' + (Get-Content -Raw (Join-Path $evidence 'output.txt') -ErrorAction SilentlyContinue)) }
} finally {
  if (-not $console.HasExited) { & "$env:SystemRoot/System32/taskkill.exe" /PID $console.Id /T /F | Out-Null }
}
$results += 'PASS Windows console read-back'
$results
