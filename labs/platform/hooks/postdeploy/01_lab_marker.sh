#!/bin/bash
# Lab 12: runs after the new version is live in /var/app/current.
set -euo pipefail
mkdir -p /var/app/current/lab-markers
echo "postdeploy hook ran at $(date -u) on $(hostname)" > /var/app/current/lab-markers/postdeploy-hook.txt
