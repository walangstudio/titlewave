#requires -Version 7.3
param(
  [Parameter(Mandatory, Position = 0)] [string] $Name,
  [Parameter(Position = 1)] [string] $SessionId
)
$PSNativeCommandArgumentPassing = 'Standard'
$arguments = @((Join-Path $PSScriptRoot 'bin/titlewave.mjs'), $Name, '--agent', 'claude')
if ($SessionId) { $arguments += @('--session', $SessionId) } else { $arguments += '--terminal' }
if ($env:LM_RENAME_DRYRUN) { $arguments += '--dry-run' }
& node @arguments
exit $LASTEXITCODE
