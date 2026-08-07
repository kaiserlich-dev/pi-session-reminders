#!/usr/bin/env bash
set -euo pipefail

PACKAGE_NAME=$(node -p "require('./package.json').name")
PACKAGE_VERSION=$(node -p "require('./package.json').version")

echo "📦 Preparing ${PACKAGE_NAME}@${PACKAGE_VERSION}"

if ! npm whoami >/dev/null 2>&1; then
  echo "❌ Not logged in to npm. Run: npm login"
  exit 1
fi

if [[ -n "$(git status --porcelain)" ]]; then
  echo "❌ Working tree is dirty. Commit changes first."
  git status --short
  exit 1
fi

npm test
npm pack --dry-run >/dev/null
npm publish

echo "✅ Published ${PACKAGE_NAME}@${PACKAGE_VERSION}"
echo "Install with: pi install npm:${PACKAGE_NAME}"
