@echo off
cd /d "%~dp0"
set JOB_AUTOMATION_HEADLESS=true
set JOB_AUTO_APPLY_ENABLED=false
node cold-dm-outreach\jobApplicationAutomation.js
