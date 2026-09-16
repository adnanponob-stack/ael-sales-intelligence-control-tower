@echo off
REM AEL Control Tower - RTM sync + auto-push (updates GitHub Pages)
set "PATH=C:\Program Files\Git\cmd;%PATH%"
cd /d "%~dp0"
python sync_rtm.py --push >> sync_log.txt 2>&1
