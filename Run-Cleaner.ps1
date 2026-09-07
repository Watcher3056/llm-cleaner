param([switch]$ScanOnly, [string]$BackupDir)
$ErrorActionPreference = 'Stop'

function Select-CleanerOption([string]$Title, [string[]]$Options) {
    Write-Host "`n$Title" -ForegroundColor Cyan
    if ([Console]::IsInputRedirected) { throw 'Open this launcher in an interactive terminal.' }
    Write-Host 'Up/Down: move | Enter: select | Esc: exit' -ForegroundColor DarkGray
    $taskSelected = 0
    $taskTop = [Console]::CursorTop
    for ($taskRow = 0; $taskRow -lt $Options.Count; $taskRow++) { Write-Host '' }
    $taskTop = [Console]::CursorTop - $Options.Count
    $taskCursorVisible = [Console]::CursorVisible
    try {
        [Console]::CursorVisible = $false
        while ($true) {
            for ($taskRow = 0; $taskRow -lt $Options.Count; $taskRow++) {
                [Console]::SetCursorPosition(0, $taskTop + $taskRow)
                $taskLine = $(if ($taskRow -eq $taskSelected) { '> ' } else { '  ' }) + $Options[$taskRow]
                $taskWidth = [Math]::Max(1, [Console]::WindowWidth - 1)
                if ($taskLine.Length -gt $taskWidth) { $taskLine = $taskLine.Substring(0, $taskWidth) }
                Write-Host -NoNewline $taskLine.PadRight($taskWidth) -ForegroundColor $(if ($taskRow -eq $taskSelected) { 'Cyan' } else { 'Gray' })
            }
            $taskKey = [Console]::ReadKey($true)
            switch ($taskKey.Key) {
                'UpArrow' { $taskSelected = ($taskSelected + $Options.Count - 1) % $Options.Count }
                'DownArrow' { $taskSelected = ($taskSelected + 1) % $Options.Count }
                'Enter' { return $taskSelected }
                'Escape' { return -1 }
            }
        }
    } finally {
        [Console]::CursorVisible = $taskCursorVisible
        [Console]::SetCursorPosition(0, $taskTop + $Options.Count)
        Write-Host ''
    }
}

try {
    if (!(Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host 'Node.js 24 or newer is required. Install it from https://nodejs.org and reopen Start-Windows.cmd.' -ForegroundColor Yellow
        exit 1
    }
    $taskMajor = & node -p 'parseInt(process.versions.node)'
    if ($LASTEXITCODE -ne 0 -or [int]$taskMajor -lt 24) {
        Write-Host 'Node.js 24 or newer is required: https://nodejs.org. Restart this launcher after installation.' -ForegroundColor Yellow
        exit 1
    }
    if (!$ScanOnly -and !$BackupDir) {
        Write-Host "`nCHAT STORAGE CLEANER" -ForegroundColor Cyan
        $taskMode = Select-CleanerOption 'Choose a mode' @('Analyze and choose cleanup options', 'Analyze only (no changes)', 'Exit')
        if ($taskMode -in @(-1, 2)) { exit 0 }
        $ScanOnly = $taskMode -eq 1
        if (!$ScanOnly) {
            Write-Host "`nVerified backups are created before changes. Choose a drive with plenty of free space."
            $taskDrives = @(Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Free -gt 0 -and $_.Root -match '^[A-Za-z]:\\$' } | Sort-Object Free -Descending)
            $taskDriveOptions = @($taskDrives | ForEach-Object { 'Drive {0}: {1:N1} GiB free' -f $_.Name,($_.Free/1GB) }) + @('Browse for another folder', 'Exit')
            while (!$BackupDir) {
                $taskPicked = Select-CleanerOption 'Choose a backup location' $taskDriveOptions
                if ($taskPicked -eq -1 -or $taskPicked -eq ($taskDrives.Count + 1)) { exit 0 }
                $taskChoice = if ($taskPicked -eq $taskDrives.Count) { 'B' } else { [string]($taskPicked + 1) }
                $taskNumber = 0
                if ([int]::TryParse($taskChoice,[ref]$taskNumber) -and $taskNumber -ge 1 -and $taskNumber -le $taskDrives.Count) {
                    $BackupDir = Join-Path $taskDrives[$taskNumber-1].Root 'Chat-storage-backups'
                } elseif ($taskChoice -in @('b','B')) {
                    Add-Type -AssemblyName System.Windows.Forms
                    $taskDialog = New-Object System.Windows.Forms.FolderBrowserDialog
                    $taskDialog.Description = 'Choose a folder for chat backups'
                    $taskDialog.ShowNewFolderButton = $true
                    try { if ($taskDialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $BackupDir = $taskDialog.SelectedPath } } finally { $taskDialog.Dispose() }
                }
            }
            Write-Host "Backups: $BackupDir"
        }
    }
    $taskScript = Join-Path $PSScriptRoot 'chat-storage.cjs'
    $taskArgs = @()
    if ($ScanOnly) { $taskArgs += '--scan-only' }
    if ($BackupDir) { $taskArgs += @('--backup-dir', $BackupDir) }
    & node $taskScript @taskArgs
    if ($LASTEXITCODE -ne 0) { throw "Cleaner stopped (exit $LASTEXITCODE). See the message above." }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
