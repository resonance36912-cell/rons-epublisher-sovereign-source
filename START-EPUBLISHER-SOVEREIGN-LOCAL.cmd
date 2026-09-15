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
call npm.cmd run dev:sovereign
echo.
echo ePublisher local server stopped.
pause
