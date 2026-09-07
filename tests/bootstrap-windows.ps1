$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '../scripts/ensure-node.ps1')
$testBase = Join-Path ([IO.Path]::GetTempPath()) ('llm-node-test-'+[guid]::NewGuid().ToString('N'))
$env:LOCALAPPDATA=$testBase
function Get-Command { return $null }
function Confirm-CleanerNodeInstall { return $false }
try { Get-CleanerNode; throw 'Expected refusal' } catch { if ($_.Exception.Message -notlike '*cancelled*') { throw } }
if (Test-Path $testBase) { throw 'Declining created files' }
function Confirm-CleanerNodeInstall { return $true }
$testNode = Get-CleanerNode
if (!(Test-CleanerNode $testNode)) { throw 'Installed Node failed' }
function Confirm-CleanerNodeInstall { throw 'Cached runtime must not prompt' }
if ((Get-CleanerNode) -ne $testNode) { throw 'Cache not reused' }
& $testNode (Join-Path $PSScriptRoot '../src/chat-storage.cjs') --help
if ($LASTEXITCODE) { throw 'Cleaner launch failed' }
Write-Host "PASS: decline, official download/checksum, cleaner launch, cached reuse; $testBase"
