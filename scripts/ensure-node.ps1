$ErrorActionPreference = 'Stop'

function Test-CleanerNode([string]$Executable) {
    if (!$Executable) { return $false }
    try {
        $taskVersion = & $Executable -p 'parseInt(process.versions.node)' 2>$null
        return $LASTEXITCODE -eq 0 -and [int]$taskVersion -ge 24
    } catch { return $false }
}

function Confirm-CleanerNodeInstall {
    if ([Console]::IsInputRedirected) { throw 'Open Start-Windows.cmd interactively to approve Node.js installation, or install Node.js 24+ yourself.' }
    $taskConsent = Read-Host 'Download and install Node.js now? [y/N]'
    return $taskConsent.Trim().ToLowerInvariant() -in @('y','yes')
}

function Get-CleanerNode {
    $ProgressPreference = 'SilentlyContinue'
    $taskExisting = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($taskExisting -and (Test-CleanerNode $taskExisting.Source)) { return $taskExisting.Source }

    $taskVersion = 'v24.20.0'
    $taskArch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    $taskArch = switch ($taskArch) { 'AMD64' { 'x64' } 'ARM64' { 'arm64' } default { throw 'Automatic Node.js setup supports Windows x64 and ARM64. Install Node.js 24+ from https://nodejs.org.' } }
    $taskBase = Join-Path $env:LOCALAPPDATA 'LLMCleaner/runtime'
    $taskName = "node-$taskVersion-win-$taskArch"
    $taskNode = Join-Path $taskBase "$taskName/node.exe"
    if (Test-CleanerNode $taskNode) { return $taskNode }

    Write-Host "Node.js 24+ is missing or too old. LLM Cleaner can download Node.js $taskVersion from nodejs.org." -ForegroundColor Yellow
    Write-Host "It will be installed only for this cleaner in $taskBase. No administrator access or system Node.js changes."
    if (!(Confirm-CleanerNodeInstall)) { throw 'Node.js installation cancelled. No download was started.' }

    New-Item -ItemType Directory -Force -Path $taskBase | Out-Null
    $taskStage = Join-Path $taskBase ('setup-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $taskStage | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        $taskUrl = "https://nodejs.org/dist/$taskVersion"
        $taskZip = Join-Path $taskStage "$taskName.zip"
        Write-Host 'Downloading Node.js and verifying its checksum...'
        Invoke-WebRequest "$taskUrl/$taskName.zip" -OutFile $taskZip -UseBasicParsing
        $taskSums = (Invoke-WebRequest "$taskUrl/SHASUMS256.txt" -UseBasicParsing).Content
        $taskMatch = [regex]::Match($taskSums, '(?m)^([a-fA-F0-9]{64})\s+' + [regex]::Escape("$taskName.zip") + '\r?$')
        if (!$taskMatch.Success -or (Get-FileHash $taskZip -Algorithm SHA256).Hash -ne $taskMatch.Groups[1].Value) { throw 'Node.js checksum verification failed. Download was not installed.' }
        Expand-Archive -LiteralPath $taskZip -DestinationPath $taskStage
        $taskExtracted = Join-Path $taskStage $taskName
        if (!(Test-CleanerNode (Join-Path $taskExtracted 'node.exe'))) { throw 'Downloaded Node.js cannot run on this machine.' }
        if (Test-Path -LiteralPath (Join-Path $taskBase $taskName)) { throw 'An unusable runtime already exists. Remove only that runtime folder and retry.' }
        Move-Item -LiteralPath $taskExtracted -Destination $taskBase
        Write-Host 'Node.js is ready. Starting LLM Cleaner...' -ForegroundColor Green
        return $taskNode
    } finally {
        $taskResolvedBase = [IO.Path]::GetFullPath($taskBase).TrimEnd('\') + '\'
        $taskResolvedStage = [IO.Path]::GetFullPath($taskStage)
        if ($taskResolvedStage.StartsWith($taskResolvedBase, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $taskResolvedStage -Leaf) -match '^setup-[a-f0-9]{32}$') {
            Remove-Item -LiteralPath $taskResolvedStage -Recurse -Force
        }
    }
}
