@echo off
title Apply the RTL patch to the pi you already have
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
	echo node is not on PATH. Install it first: winget install --id OpenJS.NodeJS -e
	goto :fail
)

echo Applying to the installed pi release...
node "%~dp0apply-to-installed.mjs" %*
if errorlevel 1 (
	echo.
	echo Nothing was changed. Run with --check to see why.
	goto :fail
)

echo.
echo Done. Start pi again and Arabic, Hebrew and Persian render right.
echo Turn it off any time: settings, then RTL. Or undo with: rtl-apply-installed.bat --revert
goto :end

:fail
echo.
echo Stopped with an error.

:end
if "%RTL_NO_PAUSE%"=="" pause
