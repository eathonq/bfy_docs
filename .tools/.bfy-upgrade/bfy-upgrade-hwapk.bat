@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

title BFY Upgrade Tool v2.0 - hwApk

node --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is required. Download: https://nodejs.org/
    pause
    exit /b 1
)

set "SCRIPT=%~dp0bfy-upgrade.mjs"
set "CONFIG=%~dp0config-hwapk.json"

if not exist "%SCRIPT%" (
    echo [ERROR] bfy-upgrade.mjs not found
    pause
    exit /b 1
)
if not exist "%CONFIG%" (
    echo [ERROR] config-hwapk.json not found
    pause
    exit /b 1
)

:: display config info
for /f "delims=" %%a in ('node -e "try{var c=require('%~dp0config-hwapk.json');console.log(c.source||'');console.log(c.target||'');console.log(c.name||'');}catch(e){}"') do (
    if "!src!"=="" (set "src=%%a") else if "!tgt!"=="" (set "tgt=%%a") else if "!name!"=="" (set "name=%%a")
)

echo.
echo ================================================================
echo   BFY Upgrade Tool v2.0  (Huawei APK)
echo ================================================================
echo.
echo   Config : %CONFIG%
echo   Source : !src!
echo   Target : !tgt!
echo   Name   : !name!
echo.
echo ================================================================
echo.

echo   Press any key to preview (DRY RUN)...
pause >nul
echo.
echo --- DRY RUN ---
echo.

call node "%SCRIPT%" --config "%CONFIG%" --dry-run

if errorlevel 1 (
    echo.
    echo ================================================================
    echo   [ERROR] Dry-run failed. Check paths in config-hwapk.json.
    echo ================================================================
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   [WARNING] This will overwrite target files!
echo ================================================================
echo.
set /p DO_EXEC="  Press Enter to execute, N to cancel: "

if /i "!DO_EXEC!"=="n" (
    echo.
    echo   Cancelled. No files modified.
    pause
    exit /b 0
)

echo.
echo --- Executing ---
echo.

call node "%SCRIPT%" --config "%CONFIG%" -y

if errorlevel 1 (
    echo.
    echo ================================================================
    echo   [ERROR] Sync failed. Check error messages above.
    echo ================================================================
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   Sync completed!
echo ================================================================

pause
endlocal
