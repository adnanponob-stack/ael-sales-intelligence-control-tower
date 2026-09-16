@echo off
REM AEL Control Tower - RTM sync + auto-push (updates GitHub Pages)
cd /d "%~dp0"
python sync_rtm.py --push >> sync_log.txt 2>&1
