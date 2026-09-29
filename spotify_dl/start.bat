@echo off
REM start.bat — Start the MusicGrab local download daemon

echo ==========================================
echo   MusicGrab Download Daemon
echo ==========================================
echo.

where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo Error: Python not found
    echo Please install Python 3.8+ from https://python.org
    pause
    exit /b 1
)

echo Checking dependencies...
where spotdl >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   spotdl not found - installing...
    pip install -q spotdl 2>nul
)
where yt-dlp >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo   yt-dlp not found - installing...
    pip install -q yt-dlp 2>nul
)

where ffmpeg >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Note: ffmpeg not found.
    echo   Without it, non-MP3 audio is kept in its original format.
    echo   Install: choco install ffmpeg
    echo.
)

echo Starting daemon...
echo.
python -u "%~dp0\daemon.py" %*
pause
