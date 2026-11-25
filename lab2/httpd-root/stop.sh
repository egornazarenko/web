#!/bin/sh
# Остановка Apache и Java FastCGI-сервера.
ROOT="$HOME/httpd-root"
cd "$ROOT" || exit 1

if [ -f httpd.pid ]; then
  kill "$(cat httpd.pid)" 2>/dev/null && echo "Apache остановлен"
fi
if [ -f fcgi.pid ]; then
  kill "$(cat fcgi.pid)" 2>/dev/null && echo "FastCGI-сервер остановлен"
  rm -f fcgi.pid
fi
