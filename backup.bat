@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist backups mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set TS=%%i
docker compose exec -T db sh -c "mysqldump -uroot -p\"$MYSQL_ROOT_PASSWORD\" --single-transaction fdfood" > "backups\fdfood-%TS%.sql"
echo สำรองแล้ว: backups\fdfood-%TS%.sql
pause
