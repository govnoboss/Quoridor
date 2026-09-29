#!/bin/bash
cd /opt/quoridor/frontend
for f in *.html; do
  sed -i '/<meta charset/a\  <link rel="icon" type="image\/x-icon" href="\/favicon.ico" />\n  <link rel="icon" type="image\/png" sizes="32x32" href="\/favicon-32x32.png" />\n  <link rel="icon" type="image\/png" sizes="16x16" href="\/favicon-16x16.png" />\n  <link rel="apple-touch-icon" sizes="192x192" href="\/favicon-192x192.png" />' "$f"
  echo "$f updated"
done
