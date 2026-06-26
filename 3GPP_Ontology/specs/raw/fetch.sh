#!/bin/zsh
# Self-pacing 3GPP spec downloader (avoids Cloudflare rate-limiting)
cd "$(dirname "$0")" || exit 1
base="https://www.3gpp.org/ftp/Specs/archive"
files=(
  23_series/23.501/23501-j80.zip
  23_series/23.503/23503-j80.zip
  38_series/38.300/38300-j20.zip
  38_series/38.401/38401-j30.zip
  38_series/38.410/38410-j20.zip
  38_series/38.420/38420-j10.zip
  38_series/38.460/38460-j00.zip
  38_series/38.470/38470-j20.zip
  28_series/28.552/28552-j70.zip
  28_series/28.554/28554-j70.zip
)
: > fetch.log
for f in $files; do
  fn=$(basename "$f")
  if [ -s "$fn" ] && unzip -tqq "$fn" >/dev/null 2>&1; then
    echo "SKIP $fn (already valid)" >> fetch.log
    continue
  fi
  code=$(curl -sL -f --http1.1 -o "$fn" -w "%{http_code}" --max-time 240 "$base/$f" 2>/dev/null)
  if [ -s "$fn" ] && unzip -tqq "$fn" >/dev/null 2>&1; then
    echo "OK   $fn http=$code $(du -h "$fn"|cut -f1)" >> fetch.log
  else
    echo "FAIL $fn http=$code" >> fetch.log
    rm -f "$fn"
  fi
  sleep 8
done
echo "===ALL DONE===" >> fetch.log
