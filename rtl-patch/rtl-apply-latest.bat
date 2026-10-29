@echo off
title Apply the RTL patch to the latest pi source
cd /d "%~dp0"

set PATCH=%~dp0pi-rtl-bidi.patch
set TREE=%~dp0..\..\pi-rtl-src
set TAG=

echo Working folder: %TREE%

where git >nul 2>&1
if errorlevel 1 (
	echo git is not on PATH. Install it first: winget install --id Git.Git -e
	goto :fail
)

echo Looking up the newest pi tag...
for /f "tokens=2" %%a in ('git ls-remote --tags https://github.com/earendil-works/pi ^| findstr "refs/tags/"') do set TAG=%%a
if "%TAG%"=="" (
	echo Could not read the tag list from github. Check your network.
	goto :fail
)
echo Newest tag: %TAG%

if exist "%TREE%\.git" (
	echo Using the clone already there - refreshing it.
	cd /d "%TREE%"
	git fetch --tags
) else (
	git clone https://github.com/earendil-works/pi "%TREE%"
	if errorlevel 1 (
		echo Clone failed.
		goto :fail
	)
	cd /d "%TREE%"
)

git checkout %TAG% 2>nul
if errorlevel 1 (
	echo Could not check out %TAG%.
	goto :fail
)

if "%1"=="--revert" (
	git reset --hard
	git clean -fd packages
	echo Source is back to plain %TAG%.
	goto :done
)

rem Clean anything the patch created on a previous run so apply starts clean.
git clean -fd packages
git reset --hard

git apply --check "%PATCH%"
if errorlevel 1 (
	echo.
	echo The patch does not fit %TAG%. Upstream changed after v1.4.0, so the patch
	echo needs rebuilding from the fork. See README.md for the diff command.
	goto :fail
)
git apply "%PATCH%"
if errorlevel 1 (
	echo git apply failed.
	goto :fail
)

echo.
echo Patch applied. Installing dependencies...
bun install --ignore-scripts
if errorlevel 1 (
	echo bun install failed.
	goto :fail
)

echo.
echo Running the bidi tests...
cd packages\tui
node --test test/bidi.test.ts test/bidi-markdown.test.ts test/bidi-editor.test.ts test/bidi-text.test.ts
set TESTRESULT=%errorlevel%

echo.
if "%TESTRESULT%"=="0" (
	echo Tests passed. Run pi from here:
	echo   cd %TREE%
	echo   bun run dev
) else (
	echo Tests did not pass. Exit code %TESTRESULT%.
)

:done
echo.
echo To undo: rtl-apply-latest.bat --revert
goto :end

:fail
echo.
echo Stopped with an error.
echo To undo: rtl-apply-latest.bat --revert

:end
if "%RTL_NO_PAUSE%"=="" pause
