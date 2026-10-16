#!/bin/sh

for v in 14 16 18 20 22 24 26; do
  echo "=== Testando no Node.js v$v ==="
  docker build --build-arg NODE_VERSION="$v" -t balloc-test:"$v" .
  if [ $? -eq 0 ]; then
    docker run --rm balloc-test:"$v"
  fi
done