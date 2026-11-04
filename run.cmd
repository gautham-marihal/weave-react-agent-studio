@echo off
rem Weave Studio in Docker on Windows: run.cmd start, stop, status or logs (see run.ps1). Runs run.ps1 with PowerShell.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
