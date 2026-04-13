@echo off
title Send LinkedIn Outreach DMs
echo ============================================
echo  SEND OUTREACH DMs (reads from Notion)
echo ============================================
cd /d "%~dp0"
node cold-dm-outreach/sendOutreach.js
echo.
pause
