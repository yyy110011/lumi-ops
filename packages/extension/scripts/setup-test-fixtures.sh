#!/bin/bash
# Initialize test fixture git repo if not already initialized.
# The fixture workspace needs to be a valid git repo for the Extension Host.
FIXTURE_DIR="$(dirname "$0")/../test-fixtures/sample-workspace"

if [ ! -d "$FIXTURE_DIR/.git" ]; then
  cd "$FIXTURE_DIR" || exit 1
  git init
  git config user.email "ci@lumi-ops.dev"
  git config user.name "Lumi CI"
  git add .
  git commit -m "Initial commit" --no-verify
fi
