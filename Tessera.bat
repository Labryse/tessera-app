@echo off
title Tessera
cd /d "%~dp0"

if not exist node_modules (
  echo Ilk calistirma: paketler kuruluyor...
  call npm install
)

echo Tessera masaustu uygulamasi aciliyor...
echo (Ilk acilis derleme yuzunden bir iki dakika surebilir.)
echo Kapatmak icin Tessera penceresini kapat.
call npx tauri dev
