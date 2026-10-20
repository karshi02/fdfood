@echo off
chcp 65001 >nul
cd /d "%~dp0"
docker compose up -d --build || (echo เปิด Docker Desktop ก่อน แล้วลองใหม่ & pause & exit /b 1)
echo ================================================
echo  โคขุน POS
echo  เครื่องนี้:        http://localhost:8080
echo  แท็บเล็ต/มือถือ:  http://IP-เครื่องนี้:8080  (WiFi เดียวกัน)
ipconfig | findstr /i "IPv4"
echo  ดูฐานข้อมูล:      http://localhost:8081  (phpMyAdmin)
echo ================================================
start "" http://localhost:8080
pause
