#!/usr/bin/env bash
# Commit generated data files from CI without stash/pop merge conflicts.
# Backs up paths, hard-resets to origin, restores fresh outputs, then commits with push retry.
#
# Usage:
#   GH_TOKEN=... GITHUB_REPOSITORY=owner/repo \
#     ./scripts/ci-commit-data-files.sh "commit message" path-or-glob [...]
#
# Optional env:
#   CI_COMMIT_BRANCH=master
#   CI_COMMIT_MAX_ATTEMPTS=5
#   CI_COMMIT_EXCLUDE_PATHS="path1 path2"   # unstaged after git add
#   CI_COMMIT_GIT_LFS=1                    # run git lfs install

set -euo pipefail

COMMIT_MSG="${1:?commit message required}"
shift

if [ -z "${GH_TOKEN:-}" ]; then
  echo "[ci-commit] Missing GH_TOKEN"
  exit 1
fi

REPO="${GITHUB_REPOSITORY:-}"
if [ -z "$REPO" ]; then
  origin_url="$(git remote get-url origin 2>/dev/null || true)"
  REPO="$(printf '%s' "$origin_url" | sed -E 's#.*github\.com[:/](.+)\.git#\1#; s#.*github\.com[:/](.+)$#\1#')"
fi
if [ -z "$REPO" ]; then
  echo "[ci-commit] Could not resolve GITHUB_REPOSITORY"
  exit 1
fi

BRANCH="${CI_COMMIT_BRANCH:-master}"
MAX_ATTEMPTS="${CI_COMMIT_MAX_ATTEMPTS:-5}"

shopt -s nullglob
PATHS=()
for pattern in "$@"; do
  matches=( $pattern )
  if [ ${#matches[@]} -eq 0 ]; then
    if [ -e "$pattern" ]; then
      PATHS+=( "$pattern" )
    fi
  else
    PATHS+=( "${matches[@]}" )
  fi
done

if [ ${#PATHS[@]} -eq 0 ]; then
  echo "[ci-commit] No existing paths to commit"
  exit 0
fi

# De-dupe paths.
UNIQUE_PATHS=()
declare -A SEEN=()
for p in "${PATHS[@]}"; do
  if [ -z "${SEEN[$p]+x}" ]; then
    SEEN[$p]=1
    UNIQUE_PATHS+=( "$p" )
  fi
done

BACKUP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$BACKUP_DIR"; }
trap cleanup EXIT

echo "[ci-commit] Backing up ${#UNIQUE_PATHS[@]} path(s)"
for p in "${UNIQUE_PATHS[@]}"; do
  if [ ! -e "$p" ]; then
    echo "[ci-commit] Skip missing path: $p"
    continue
  fi
  mkdir -p "$BACKUP_DIR/$(dirname "$p")"
  cp -a "$p" "$BACKUP_DIR/$p"
done

git config user.name "github-actions[bot]"
git config user.email "github-actions[bot]@users.noreply.github.com"
if [ "${CI_COMMIT_GIT_LFS:-}" = "1" ]; then
  git lfs install
fi
git remote set-url origin "https://x-access-token:${GH_TOKEN}@github.com/${REPO}.git"

restore_backup() {
  for p in "${UNIQUE_PATHS[@]}"; do
    if [ -e "$BACKUP_DIR/$p" ]; then
      mkdir -p "$(dirname "$p")"
      # `cp -a src dest/` nests when dest is an existing directory (e.g. data/afl-model
      # becomes data/afl-model/afl-model). Replace directories instead of copying into them.
      if [ -d "$BACKUP_DIR/$p" ]; then
        rm -rf "$p"
        cp -a "$BACKUP_DIR/$p" "$p"
      else
        cp -a "$BACKUP_DIR/$p" "$p"
      fi
    fi
  done
}

stage_paths() {
  git add "${UNIQUE_PATHS[@]}"
  if [ -n "${CI_COMMIT_EXCLUDE_PATHS:-}" ]; then
    for ex in ${CI_COMMIT_EXCLUDE_PATHS}; do
      git reset HEAD "$ex" 2>/dev/null || true
    done
  fi
}

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  echo "[ci-commit] Sync attempt ${attempt}/${MAX_ATTEMPTS} on ${BRANCH}"
  git fetch origin "$BRANCH"
  git checkout -B "$BRANCH" "origin/${BRANCH}"
  git reset --hard "origin/${BRANCH}"

  restore_backup

  for p in "${UNIQUE_PATHS[@]}"; do
    if [ -f "$p" ] && grep -q '<<<<<<< ' "$p" 2>/dev/null; then
      echo "[ci-commit] Resolving merge conflict markers in $p"
      node scripts/resolve-data-merge-conflicts.js "$p"
    fi
  done

  stage_paths

  if git diff --staged --quiet; then
    echo "[ci-commit] No changes to commit"
    exit 0
  fi

  git commit -m "$COMMIT_MSG"
  if git push origin "HEAD:${BRANCH}"; then
    echo "[ci-commit] Push succeeded"
    exit 0
  fi

  echo "[ci-commit] Push rejected; retrying after short delay"
  git reset --soft HEAD~1
  sleep $((attempt * 2))
done

echo "[ci-commit] Failed to push after ${MAX_ATTEMPTS} attempts"
exit 1
