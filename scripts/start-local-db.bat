@echo off
REM Starts the project's private MySQL instance (port 3307, no admin rights needed).
REM Data lives in %USERPROFILE%\.payroll-mysql\data. Keep this window open while you use the app.
"C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe" --no-defaults --datadir="%USERPROFILE%\.payroll-mysql\data" --port=3307 --bind-address=127.0.0.1 --mysqlx=OFF --log-bin-trust-function-creators=1 --performance-schema=OFF --innodb-buffer-pool-size=64M --innodb-log-buffer-size=8M --key-buffer-size=8M --max-connections=30 --table-open-cache=200 --console
