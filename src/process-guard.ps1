param([int]$TargetPid=0,[string]$ExpectedStart,[ValidateSet('Close','Force')][string]$Action='Close',[switch]$Watch)
$ErrorActionPreference='Stop'
function Classify($p) {
 if($p.Name -match '^(codex|codex-code-mode-host|ChatGPT)\.exe$'){return 'codex'}
 if($p.Name -match '^claude\.exe$'){return 'claude'}
 if($p.Name -match '^(Cursor|cursor-agent)\.exe$'){return 'cursor'}
 if($p.Name -match '^antigravity\.exe$' -or ($p.Name -match '^language_server' -and $p.CommandLine -match '[\\/]antigravity[\\/]')){return 'antigravity'}
 if($p.Name -match '^gemini\.exe$'){return 'gemini'}
 if($p.Name -match '^(node|bun)\.exe$'){
  if($p.CommandLine -match '[\\/]@openai[\\/]codex[\\/]'){return 'codex'}
  if($p.CommandLine -match '[\\/]@anthropic-ai[\\/]claude-code[\\/]'){return 'claude'}
  if($p.CommandLine -match '[\\/]@google[\\/]gemini-cli[\\/]'){return 'gemini'}
  if($p.CommandLine -match '[\\/]cursor[\\/].*cli\.js'){return 'cursor'}
 }
 return $null
}
function Get-Rows {
 $rows=@(Get-CimInstance Win32_Process | ForEach-Object {
  @{pid=[int]$_.ProcessId;ppid=[int]$_.ParentProcessId;start=$_.CreationDate.ToUniversalTime().ToString('o');name=$_.Name;app=(Classify $_)}
 })
 ConvertTo-Json -InputObject $rows -Compress
}
if($Watch){while($null -ne [Console]::ReadLine()){Get-Rows};exit 0}
if($TargetPid){
 $p=Get-CimInstance Win32_Process -Filter "ProcessId=$TargetPid"
 if(!$p){exit 0}
 if($p.CreationDate.ToUniversalTime().ToString('o') -ne $ExpectedStart -or !(Classify $p)){throw 'Process identity changed'}
 $live=Get-Process -Id $TargetPid -ErrorAction Stop
 if($Action -eq 'Force'){Stop-Process -InputObject $live -ErrorAction Stop}else{[void]$live.CloseMainWindow()}
}else{Get-Rows}
