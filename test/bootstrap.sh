#!/bin/sh
# Rebuild the scratch harness the suite expects and run it.
#
#   test/bootstrap.sh [scratch-dir]        # default scratch dir: /tmp/wb2api-harness
#
# Why a scratch dir: the host half resolves @earendil-works/pi-ai and the two
# DSH seam packages relative to its *own* location, so the suite must run
# against a copy of lib/ that lives next to a node_modules holding them. Never
# install those packages into this plugin directory — a local node_modules would
# shadow the copies the real DSH host ships inside its app bundle.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
plugin=$(cd "$here/.." && pwd)
work=${1:-/tmp/wb2api-harness}

mkdir -p "$work/test"
rsync -a --delete "$plugin/lib/" "$work/plugin/lib/"
cp "$here/suite/"*.mjs "$work/test/"
mv "$work/test/live-check.mjs" "$work/live-check.mjs"

if [ ! -f "$work/package.json" ]; then
  printf '{\n  "name": "wb2api-harness",\n  "private": true,\n  "type": "module"\n}\n' > "$work/package.json"
fi

if [ ! -d "$work/node_modules/@earendil-works/pi-ai" ]; then
  echo "installing the seam packages into $work ..."
  # dsh-settings / dsh-timeout / dsh-credentials are peers of @deepseek-ai/dsh-llm;
  # --legacy-peer-deps leaves them out and the import then fails at runtime.
  ( cd "$work" && npm install --legacy-peer-deps --no-save --no-package-lock \
      '@deepseek-ai/cordis@4.0.4' \
      '@deepseek-ai/dsh-credentials@0.0.1-rc.1' \
      '@deepseek-ai/dsh-llm@0.0.1-rc.1' \
      '@deepseek-ai/dsh-llm-pi-ai@0.0.1-rc.1' \
      '@deepseek-ai/dsh-settings@0.0.1-rc.1' \
      '@deepseek-ai/dsh-timeout@0.0.1-rc.1' \
      '@earendil-works/pi-ai@1.1.0' )
fi

# dsh-llm-pi-ai peers on @deepseek-ai/dsh-environment, which is not published;
# the plugin never sets apiKeyEnv, so a stub that always answers "unknown" is
# enough to satisfy the import.
stub="$work/node_modules/@deepseek-ai/dsh-environment"
if [ ! -d "$stub" ]; then
  mkdir -p "$stub"
  printf '{\n  "name": "@deepseek-ai/dsh-environment",\n  "version": "0.0.0-stub",\n  "type": "module",\n  "exports": "./index.js"\n}\n' > "$stub/package.json"
  printf 'export function environmentOf() {\n  return { get: () => undefined, has: () => false }\n}\n' > "$stub/index.js"
fi

cd "$work"
node --test --test-timeout=25000 --test-reporter=spec \
  test/unit.test.mjs test/e2e.test.mjs test/client.test.mjs test/cli.test.mjs

echo
echo "scratch harness ready at $work"
echo "live gateway check (needs WorkBuddy2API on 127.0.0.1:7863): node $work/live-check.mjs"
