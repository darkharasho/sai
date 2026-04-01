#!/bin/bash
# Creates a temporary git repo with known state for E2E tests
set -e

DIR="$1"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"

git init
git config user.email "test@test.com"
git config user.name "Test User"

# Create initial commit
echo "initial content" > file1.txt
echo "# Project" > README.md
mkdir src
echo "console.log('hello')" > src/index.js
git add .
git commit -m "initial commit"

# Create unstaged changes
echo "modified content" > file1.txt

# Create a new untracked file
echo "new file" > file2.txt

# Create staged change
echo "staged content" > src/staged.js
git add src/staged.js
