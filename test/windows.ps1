$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot
$cli = Join-Path $root 'bin/titlewave.mjs'
$results = @()
if ($env:HERDR_ENV -eq '1' -and (Get-Command herdr -ErrorAction SilentlyContinue)) {
  if ([string]::IsNullOrWhiteSpace($env:HERDR_WORKSPACE_ID)) { throw 'Herdr checks require HERDR_WORKSPACE_ID' }
  function Invoke-Herdr {
    $output = & herdr @args
    if ($LASTEXITCODE -ne 0) { throw "Herdr command failed: $($args -join ' ')" }
    ($output | ConvertFrom-Json).result
  }
  $created = Invoke-Herdr tab create --workspace $env:HERDR_WORKSPACE_ID --label 'Titlewave Herdr fixture' --no-focus --cwd $root
  $tab = $created.tab.tab_id
  $pane = $created.root_pane.pane_id
  if (-not $tab -or -not $pane) {
    if ($tab) { Invoke-Herdr tab close $tab | Out-Null }
    throw 'Herdr did not create a test tab'
  }
  $previous = $env:HERDR_PANE_ID
  $previousTab = $env:HERDR_TAB_ID
  $previousDaemon = $env:CODEX_DAEMON_SHUTDOWN_SOCKET
  $staleTab = $null
  try {
    $stale = Invoke-Herdr tab create --workspace $env:HERDR_WORKSPACE_ID --label 'Titlewave stale daemon fixture' --no-focus --cwd $root
    $staleTab = $stale.tab.tab_id
    $stalePane = $stale.root_pane.pane_id
    if (-not $staleTab -or -not $stalePane) { throw 'Herdr did not create the stale-context fixture' }
    Invoke-Herdr pane rename $stalePane 'Titlewave stale sentinel' | Out-Null
    $env:HERDR_PANE_ID = $stalePane
    $env:HERDR_TAB_ID = 'titlewave-stale-tab'
    $env:CODEX_DAEMON_SHUTDOWN_SOCKET = 'titlewave-test-daemon'
    $refusalCheck = @'
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const result = spawnSync(process.execPath, [process.argv[1], 'terminal', 'Must not rename'], { encoding: 'utf8' });
assert.notEqual(result.status, 0);
assert.match(result.stderr, /Codex shared-daemon/);
'@
    & node -e $refusalCheck $cli
    if ($LASTEXITCODE -ne 0) { throw 'Codex daemon did not refuse an inherited pane target' }
    if ((Invoke-Herdr pane get $stalePane).pane.label -ne 'Titlewave stale sentinel' -or (Invoke-Herdr tab get $staleTab).tab.label -ne 'Titlewave stale daemon fixture') { throw 'Daemon refusal changed the stale pane or tab' }
    $results += 'PASS Herdr daemon refuses stale inherited pane'
    & node $cli terminal 'Titlewave Herdr test' --herdr-pane $pane
    if ($LASTEXITCODE -ne 0) { throw 'Herdr rename failed' }
    $saved = (Invoke-Herdr pane get $pane).pane.label
    if ($saved -ne 'Titlewave Herdr test') { throw "Unexpected Herdr title: $saved" }
    $saved = (Invoke-Herdr tab get $tab).tab.label
    if ($saved -ne 'Titlewave Herdr test') { throw "Unexpected Herdr tab title: $saved" }
    if ((Invoke-Herdr pane get $stalePane).pane.label -ne 'Titlewave stale sentinel') { throw 'Explicit target changed the stale pane' }
    $results += 'PASS Herdr single-pane tab and pane labels'
    Remove-Item Env:CODEX_DAEMON_SHUTDOWN_SOCKET
    $env:HERDR_PANE_ID = $pane
    & node $cli terminal 'Titlewave Herdr test'
    if ($LASTEXITCODE -ne 0 -or (Invoke-Herdr pane get $pane).pane.label -ne 'Titlewave Herdr test' -or (Invoke-Herdr tab get $tab).tab.label -ne 'Titlewave Herdr test') { throw 'Non-daemon inherited Herdr pane failed' }
    $results += 'PASS Herdr inherited pane outside shared daemon'
    $env:CODEX_DAEMON_SHUTDOWN_SOCKET = 'titlewave-test-daemon'
    $env:HERDR_PANE_ID = $stalePane
    $split = (Invoke-Herdr pane split $pane --direction right --no-focus --cwd $root).pane.pane_id
    if (-not $split) { throw 'Herdr did not create a split pane' }
    Invoke-Herdr pane rename $split 'Titlewave neighbor sentinel' | Out-Null
    & node $cli terminal 'Titlewave Herdr pane only' --herdr-pane $pane
    if ($LASTEXITCODE -ne 0) { throw 'Herdr split-pane rename failed' }
    if ((Invoke-Herdr pane get $pane).pane.label -ne 'Titlewave Herdr pane only') { throw 'Herdr did not save the calling pane label' }
    if ((Invoke-Herdr tab get $tab).tab.label -ne 'Titlewave Herdr test') { throw 'Herdr changed a shared tab title' }
    if ((Invoke-Herdr pane get $split).pane.label -ne 'Titlewave neighbor sentinel') { throw 'Herdr changed the neighboring pane label' }
    $results += 'PASS Herdr split tab and neighboring pane preserved'
  } finally {
    $env:HERDR_PANE_ID = $previous
    $env:HERDR_TAB_ID = $previousTab
    $env:CODEX_DAEMON_SHUTDOWN_SOCKET = $previousDaemon
    try { if ($staleTab) { Invoke-Herdr tab close $staleTab | Out-Null } }
    finally { Invoke-Herdr tab close $tab | Out-Null }
  }
}
if (Get-Command wezterm -ErrorAction SilentlyContinue) {
  $panes = wezterm cli --no-auto-start list --format json 2>$null
  if ($LASTEXITCODE -eq 0) {
    $pane = (wezterm cli --no-auto-start spawn --new-window --cwd $root -- powershell.exe -NoLogo -NoProfile -NoExit).Trim()
    if ($LASTEXITCODE -ne 0) { throw 'WezTerm did not create a test pane' }
    $previousHerdr = $env:HERDR_PANE_ID
    $previousWezterm = $env:WEZTERM_PANE
    $previousDaemon = $env:CODEX_DAEMON_SHUTDOWN_SOCKET
    try {
      Remove-Item Env:HERDR_PANE_ID -ErrorAction SilentlyContinue
      Remove-Item Env:CODEX_DAEMON_SHUTDOWN_SOCKET -ErrorAction SilentlyContinue
      $env:WEZTERM_PANE = $pane
      & node $cli terminal 'Titlewave WezTerm test'
      if ($LASTEXITCODE -ne 0) { throw 'WezTerm rename failed' }
      $saved = (wezterm cli --no-auto-start list --format json | Out-String | ConvertFrom-Json) | Where-Object { "$($_.pane_id)" -eq $pane }
      if ($saved.tab_title -ne 'Titlewave WezTerm test') { throw 'WezTerm did not save the tab title' }
      $results += 'PASS WezTerm targeted tab'
    } finally {
      $env:HERDR_PANE_ID = $previousHerdr
      $env:WEZTERM_PANE = $previousWezterm
      $env:CODEX_DAEMON_SHUTDOWN_SOCKET = $previousDaemon
      wezterm cli --no-auto-start kill-pane --pane-id $pane | Out-Null
    }
  }
}
$evidence = Join-Path $root ('.evidence/console-' + [guid]::NewGuid())
New-Item -ItemType Directory -Force $evidence | Out-Null
$script = @'
'HERDR_PANE_ID','TMUX','TMUX_PANE','STY','WINDOW','ZELLIJ','WEZTERM_PANE','KITTY_WINDOW_ID','CODEX_DAEMON_SHUTDOWN_SOCKET' | ForEach-Object { Remove-Item "Env:$_" -ErrorAction SilentlyContinue }
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
