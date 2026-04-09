#!/bin/bash
set -e

echo "[entrypoint] Starting cron daemon..."
cron

echo "[entrypoint] Pre-warming data cache..."
python main.py --refresh-cache

echo "[entrypoint] Cache ready. Starting dashboard server..."
exec python main.py --serve --cached
