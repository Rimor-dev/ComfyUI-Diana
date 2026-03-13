@echo off
chcp 65001 >nul
title Diana Library Packer
echo 🧝 Diana Library Packer
echo =========================

REM Проверяем, есть ли python в системе
python --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Python not found! Please install Python first.
    pause
    exit /b 1
)

REM Проверяем, есть ли наш скрипт
if not exist pack_to_lib.py (
    echo ❌ pack_to_lib.py not found in current directory!
    pause
    exit /b 1
)

REM Проверяем наличие PIL (Pillow)
python -c "from PIL import Image" >nul 2>&1
if errorlevel 1 (
    echo.
    echo ⚠️ Pillow library not found! Installing...
    pip install pillow
    if errorlevel 1 (
        echo ❌ Failed to install Pillow!
        pause
        exit /b 1
    )
)

echo.
echo 📦 Running packer...
echo.

python pack_to_lib.py

if errorlevel 1 (
    echo.
    echo ❌ Packing failed! Check errors above.
) else (
    echo.
    echo ✅ Packing completed successfully!
)

echo.
pause