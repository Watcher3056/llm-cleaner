@echo off
title LLM Cleaner
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0scripts\Run-Cleaner.ps1"
echo.
pause
