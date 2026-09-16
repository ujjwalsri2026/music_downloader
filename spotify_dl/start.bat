@echo off
REM start.bat — Start Spotify Download Daemon

echo ==========================================
echo   Spotify Download Daemon
echo ==========================================
echo.

REM Check Python
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Python not found
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

REM Check/install dependencies
echo Checking dependencies...
pip install -q pycryptodome requests 2>nul

REM Start daemon
echo Starting daemon.
echo.
python "%~dp0\daemon.py" %*
pause
