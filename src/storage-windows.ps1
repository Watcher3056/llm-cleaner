param([Parameter(Mandatory=$true)][string]$Manifest)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.ComponentModel;
public static class ChatStorageNative {
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern uint GetCompressedFileSizeW(string p, out uint high);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetVolumePathNameW(string p, StringBuilder root, uint len);
 [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool GetVolumeInformationW(string root, StringBuilder name, uint nameLen, out uint serial, out uint maxLen, out uint flags, StringBuilder fs, uint fsLen);
 public static long Bytes(string p) {uint high;uint low=GetCompressedFileSizeW(p,out high);if(low==0xffffffff && Marshal.GetLastWin32Error()!=0)throw new Win32Exception();return ((long)high<<32)|low;}
 public static string FileSystem(string p) {var root=new StringBuilder(1024);if(!GetVolumePathNameW(p,root,1024))throw new Win32Exception();uint a,b,c;var fs=new StringBuilder(64);if(!GetVolumeInformationW(root.ToString(),null,0,out a,out b,out c,fs,64))throw new Win32Exception();return fs.ToString();}
}
'@
$taskFiles = Get-Content -LiteralPath $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
$taskResults = foreach($taskFile in $taskFiles) {
    try {
        $taskItem=Get-Item -LiteralPath $taskFile -Force
        if($taskItem.PSIsContainer -or ($taskItem.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Not a regular file' }
        [pscustomobject]@{file=$taskFile;bytes=[ChatStorageNative]::Bytes($taskItem.FullName);fileSystem=[ChatStorageNative]::FileSystem($taskItem.FullName);compressed=[bool]($taskItem.Attributes -band [IO.FileAttributes]::Compressed)}
    } catch { [pscustomobject]@{file=$taskFile;error=$_.Exception.Message} }
}
ConvertTo-Json -InputObject @($taskResults) -Compress -Depth 3
