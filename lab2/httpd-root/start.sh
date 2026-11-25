#!/bin/sh
# Запуск лабораторной №2 на Helios: Java FastCGI-сервер + Apache httpd.
# Порты ниже должны совпадать с теми, что стоят в httpd.conf (Listen и -host).
FCGI_PORT=24001

ROOT="$HOME/httpd-root"
LOGIN="$(id -un)"
cd "$ROOT" || exit 1

mkdir -p mutex-dir

# httpd.conf получается из шаблона подстановкой вашего логина вместо sXXXXXX
sed "s/sXXXXXX/$LOGIN/g" httpd.conf.template > httpd.conf

# 1) Java FastCGI-сервер (в фоне)
if [ -f fcgi.pid ] && kill -0 "$(cat fcgi.pid)" 2>/dev/null; then
  echo "FastCGI-сервер уже запущен (pid $(cat fcgi.pid))"
else
  nohup java -DFCGI_PORT=$FCGI_PORT -jar "$ROOT/fcgi-bin/area.jar" > "$ROOT/fcgi.log" 2>&1 &
  echo $! > fcgi.pid
  echo "FastCGI-сервер запущен (pid $(cat fcgi.pid)), лог: $ROOT/fcgi.log"
fi

# 2) Apache httpd от вашего пользователя
httpd -f "$ROOT/httpd.conf" && echo "Apache запущен, лог ошибок: $ROOT/error.log"
