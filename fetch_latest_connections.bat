@echo off
title Fetch Latest LinkedIn Connections
echo ============================================
echo  FETCH LATEST LINKEDIN CONNECTIONS -^> NOTION
echo ============================================
cd /d "%~dp0"
node cold-dm-outreach/fetchConnections.js
echo.
pause
