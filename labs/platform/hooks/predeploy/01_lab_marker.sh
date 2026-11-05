#!/bin/bash
# Lab 12: runs after the app is built in /var/app/staging, right before it goes live.
set -euo pipefail
mkdir -p /var/app/staging/lab-markers
echo "predeploy hook ran at $(date -u) on $(hostname)" > /var/app/staging/lab-markers/predeploy-hook.txt
