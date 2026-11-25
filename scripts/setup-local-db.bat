@echo off
REM One-time local setup. Right-click this file and choose "Run as administrator".
echo Starting MySQL service...
net start MYSQL80
sc config MYSQL80 start= auto >nul
echo.
echo Creating payroll databases and users. Enter your MySQL ROOT password when asked.
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysql.exe" -u root -p < "%~dp0mysql-setup.sql"
if errorlevel 1 (
  echo.
  echo Setup FAILED - check the root password and try again.
) else (
  echo.
  echo Setup complete. Go back to Claude and say "done".
)
pause
