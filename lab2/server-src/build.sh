#!/bin/sh
# Сборка area.jar
set -e
cd "$(dirname "$0")"
rm -rf build
mkdir -p build/classes
javac -encoding UTF-8 -cp lib/fastcgi-lib.jar -d build/classes src/AreaServer.java
(cd build/classes && jar xf ../../lib/fastcgi-lib.jar && rm -rf META-INF)
printf 'Main-Class: AreaServer\n' > build/manifest.txt
jar cfm build/area.jar build/manifest.txt -C build/classes .
echo "Готово: $(pwd)/build/area.jar"
