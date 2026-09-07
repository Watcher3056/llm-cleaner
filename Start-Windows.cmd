@echo off
title Chat Storage Cleaner
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0Run-Cleaner.ps1"
echo.
pause
