#!/bin/sh
set -eu

APP_USER="${APP_USER:-finfinity}"
APP_GROUP="${APP_GROUP:-nodejs}"

fix_path_permissions() {
  target="$1"
  mode="$2"

  if [ -e "$target" ]; then
    chmod "$mode" "$target" 2>/dev/null || true
    chown "$APP_USER":"$APP_GROUP" "$target" 2>/dev/null || true
  fi
}

mkdir -p /app/logs /app/data 2>/dev/null || true
touch /app/leads.csv 2>/dev/null || true

# Requested runtime permissions for mounted paths.
fix_path_permissions /app/logs 775
fix_path_permissions /app/data 775
fix_path_permissions /app/leads.csv 775

# Run app as non-root after startup fixes.
exec su-exec "$APP_USER":"$APP_GROUP" node server.js
