@echo off
setlocal
title Resonance ePublisher Sovereign Local v0.1 - KEEP OPEN
cd /d "C:\Users\Ashley\Resonance\OpenNova\apps\epublisher-sovereign-local-v0.1"
echo ============================================================
echo  RESONANCE ePUBLISHER SOVEREIGN LOCAL v0.1
echo  URL: http://localhost:3101/app
echo  External AI: denied by default
echo  Lovable: not required
echo ============================================================
netstat -ano | findstr /R /C:":7864 .*LISTENING" >nul
if errorlevel 1 (
  echo Starting governed local STT service on port 7864...
  start "RONS ePublisher STT" /min cmd /c "C:\Users\Ashley\Resonance\OpenNova\runtime\start-epublisher-stt.cmd"
)
call npm.cmd run dev:sovereign
echo.
echo ePublisher local server stopped.
pause
