foreach ($v in 14, 16, 18, 20, 22, 24, 26) {
  Write-Host "=== Testando no Node.js v$v ==="
  docker build --build-arg NODE_VERSION=$v -t balloc-test:$v .
  if ($LASTEXITCODE -eq 0) {
    docker run --rm balloc-test:$v
  }
}