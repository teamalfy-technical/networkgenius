@echo off
REM MikroTik APIs - Test Script for Windows
REM This script tests all major API endpoints

setlocal enabledelayedexpansion
set BASE_URL=http://localhost:3000

echo.
echo === Health Check ===
echo.
curl -s -X GET "%BASE_URL%/health" -H "Content-Type: application/json" | findstr /r "ok" >nul
if %errorlevel% equ 0 (
    echo [OK] Server is running
) else (
    echo [ERROR] Server is not responding
    exit /b 1
)

echo.
echo === Register User ===
echo.
for /f "delims=" %%A in ('curl -s -X POST "%BASE_URL%/api/auth/register" -H "Content-Type: application/json" -d "{\"username\":\"testuser\",\"email\":\"test@example.com\",\"password\":\"TestPassword123\",\"maxDevices\":2}"') do (
    set REGISTER=%%A
)
echo %REGISTER% | findstr /r "created" >nul
if %errorlevel% equ 0 (
    echo [OK] User registered
) else (
    echo [ERROR] User registration failed
    echo %REGISTER%
    exit /b 1
)

echo.
echo === Login ===
echo.
for /f "delims=" %%A in ('curl -s -X POST "%BASE_URL%/api/auth/login" -H "Content-Type: application/json" -d "{\"username\":\"testuser\",\"password\":\"TestPassword123\"}"') do (
    set LOGIN=%%A
)
echo %LOGIN% | findstr /r "token" >nul
if %errorlevel% equ 0 (
    echo [OK] Login successful
) else (
    echo [ERROR] Login failed
    echo %LOGIN%
    exit /b 1
)

REM Extract token (this is simplified - in real use, parse JSON properly)
for /f "tokens=*" %%A in ('echo %LOGIN% ^| findstr /o "token"') do (
    set TOKEN_LINE=%%A
)

echo.
echo === Register Device ===
echo.
for /f "delims=" %%A in ('curl -s -X POST "%BASE_URL%/api/devices" -H "Content-Type: application/json" -H "Authorization: Bearer !TOKEN_LINE!" -d "{\"deviceName\":\"Test Laptop\",\"macAddress\":\"AA:BB:CC:DD:EE:FF\"}"') do (
    set DEVICE=%%A
)
echo %DEVICE% | findstr /r "Device registered" >nul
if %errorlevel% equ 0 (
    echo [OK] Device registered
) else (
    echo [ERROR] Device registration failed
    echo %DEVICE%
)

echo.
echo === Get User Devices ===
echo.
curl -s -X GET "%BASE_URL%/api/devices" -H "Authorization: Bearer !TOKEN_LINE!" | findstr /r "success" >nul
if %errorlevel% equ 0 (
    echo [OK] Devices retrieved
) else (
    echo [ERROR] Failed to get devices
)

echo.
echo === Connect Device ===
echo.
curl -s -X POST "%BASE_URL%/api/devices/connect" -H "Content-Type: application/json" -H "Authorization: Bearer !TOKEN_LINE!" -d "{\"macAddress\":\"AA:BB:CC:DD:EE:FF\",\"ipAddress\":\"192.168.1.100\"}" | findstr /r "connected" >nul
if %errorlevel% equ 0 (
    echo [OK] Device connected
) else (
    echo [ERROR] Failed to connect device
)

echo.
echo === Test Summary ===
echo.
echo [OK] All tests completed
echo.
