@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist backups mkdir backups
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set TS=%%i
docker compose exec -T db sh -c "mysqldump -uroot -p\"$MYSQL_ROOT_PASSWORD\" --single-transaction fdfood" > "backups\fdfood-%TS%.sql"
if errorlevel 1 (
  del "backups\fdfood-%TS%.sql" 2>nul
  echo สำรองไม่สำเร็จ — เปิด Docker Desktop และรัน start.bat ก่อน
  if not "%1"=="auto" pause
  exit /b 1
)
rem keep 60 days of backups
forfiles /p backups /m fdfood-*.sql /d -60 /c "cmd /c del @path" 2>nul
echo สำรองแล้ว: backups\fdfood-%TS%.sql
if not "%1"=="auto" pause
