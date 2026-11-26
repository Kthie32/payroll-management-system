@echo off
REM Starts the Magezi Payroll system: database + web app. Double-click to run.
REM Two windows open; keep both open while using the system. Close them to stop it.
cd /d "%~dp0"
echo Starting database...
start "Payroll database (keep open)" cmd /k call "%~dp0scripts\start-local-db.bat"
timeout /t 8 /nobreak >nul
echo Starting web app...
start "Payroll app (keep open)" cmd /k "set NODE_OPTIONS=--max-old-space-size=512 && node node_modules\next\dist\bin\next start --port 3000"
timeout /t 10 /nobreak >nul
start "" http://localhost:3000
