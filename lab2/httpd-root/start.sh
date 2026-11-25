#!/bin/sh
# Запуск лабораторной №2 на Helios
FCGI_PORT=24001

ROOT="$HOME/httpd-root"
LOGIN="$(id -un)"
cd "$ROOT" || exit 1

mkdir -p mutex-dir

sed "s/sXXXXXX/$LOGIN/g" httpd.conf.template > httpd.conf


if [ -f fcgi.pid ] && kill -0 "$(cat fcgi.pid)" 2>/dev/null; then
  echo "FastCGI-сервер уже запущен (pid $(cat fcgi.pid))"
else
  nohup java -DFCGI_PORT=$FCGI_PORT -jar "$ROOT/fcgi-bin/area.jar" > "$ROOT/fcgi.log" 2>&1 &
  echo $! > fcgi.pid
  echo "FastCGI-сервер запущен (pid $(cat fcgi.pid)), лог: $ROOT/fcgi.log"
fi

httpd -f "$ROOT/httpd.conf" && echo "Apache запущен, лог ошибок: $ROOT/error.log"
