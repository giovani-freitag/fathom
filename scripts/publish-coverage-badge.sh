#!/usr/bin/env bash
# Publishes the coverage endpoint document to an orphan branch, which shields.io
# reads. An orphan branch keeps the churn of a number that changes every push
# out of the history anyone reads.
set -euo pipefail

BRANCH=badges
DOCUMENT=coverage/badge.json
REMOTE="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
WORKTREE=$(mktemp -d)

if git clone --depth 1 --branch "${BRANCH}" "${REMOTE}" "${WORKTREE}" 2>/dev/null; then
    :
else
    git clone --depth 1 "${REMOTE}" "${WORKTREE}"
    git -C "${WORKTREE}" checkout --orphan "${BRANCH}"
    git -C "${WORKTREE}" rm -rf --quiet . >/dev/null 2>&1 || true
fi

cp "${DOCUMENT}" "${WORKTREE}/coverage.json"
git -C "${WORKTREE}" add coverage.json

# Nothing to say when the number did not move, and a commit per push that
# repeats itself is the noise this branch exists to avoid.
if git -C "${WORKTREE}" diff --cached --quiet; then
    echo "Coverage unchanged; nothing published."
    exit 0
fi

git -C "${WORKTREE}" \
    -c user.name='github-actions[bot]' \
    -c user.email='41898282+github-actions[bot]@users.noreply.github.com' \
    commit --quiet --message 'chore: update the coverage badge'
git -C "${WORKTREE}" push --quiet origin "${BRANCH}"
echo "Published $(cat "${DOCUMENT}" | tr -d '\n')"
