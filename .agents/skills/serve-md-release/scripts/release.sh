#!/usr/bin/env bash
#
# release.sh — Quality gate + release script for serve-md
#
# Runs pre-release checks, assesses the next semver version from commits,
# creates a git tag, and pushes it to trigger the JSR publish workflow.
#
# Usage:
#   ./scripts/release.sh           # interactive (asks for confirmation)
#   ./scripts/release.sh --yes     # skip confirmation, auto-release
#   ./scripts/release.sh --bump major|minor|patch  # override semver assessment
#

set -euo pipefail

# ── Colors ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info()    { echo -e "${CYAN}  $*${NC}"; }
ok()      { echo -e "${GREEN}  ✓ $*${NC}"; }
warn()    { echo -e "${YELLOW}  ⚠ $*${NC}"; }
fail()    { echo -e "${RED}  ✗ $*${NC}" >&2; }
step()    { echo -e "\n${BOLD}${CYAN}▶ $*${NC}"; }

die() { fail "$1"; exit 1; }

# ── Args ────────────────────────────────────────────────────────────────────
SKIP_CONFIRM=false
OVERRIDE_BUMP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) SKIP_CONFIRM=true; shift ;;
    --bump)   OVERRIDE_BUMP="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: ./scripts/release.sh [--yes] [--bump major|minor|patch]"
      exit 0
      ;;
    *) die "Unknown argument: $1" ;;
  esac
done

if [[ -n "$OVERRIDE_BUMP" && ! "$OVERRIDE_BUMP" =~ ^(major|minor|patch)$ ]]; then
  die "--bump must be one of: major, minor, patch"
fi

# ── Root ────────────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
cd "$REPO_ROOT"

# ── 1. Branch check ─────────────────────────────────────────────────────────
step "Checking branch"

CURRENT_BRANCH="$(git branch --show-current)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  die "Not on main branch (currently on '$CURRENT_BRANCH'). Switch to main before releasing."
fi
ok "On main branch"

# ── 2. Commits ahead of latest tag ──────────────────────────────────────────
step "Checking commits ahead of latest tag"

LATEST_TAG="$(git describe --tags --abbrev=0 2>/dev/null || true)"

if [[ -z "$LATEST_TAG" ]]; then
  info "No existing tags found — all commits are release candidates."
  COMMITS_SINCE_TAG="$(git rev-list --count HEAD)"
else
  COMMITS_SINCE_TAG="$(git rev-list --count "${LATEST_TAG}..HEAD")"
  info "Latest tag: $LATEST_TAG ($COMMITS_SINCE_TAG commits ahead)"
fi

if [[ "$COMMITS_SINCE_TAG" -eq 0 ]]; then
  die "No new commits since the last tag ($LATEST_TAG). Nothing to release."
fi
ok "$COMMITS_SINCE_TAG commit(s) ahead of latest tag"

# ── 3. Quality gate: deno task check ────────────────────────────────────────
step "Running quality gate: deno task check"

if deno task check; then
  ok "deno task check passed"
else
  die "deno task check failed — fix issues before releasing."
fi

# ── 4. Quality gate: deno task release:check ────────────────────────────────
step "Running quality gate: deno task release:check"

if deno task release:check; then
  ok "deno task release:check passed (JSR dry-run OK)"
else
  die "deno task release:check failed — the package is not ready for JSR."
fi

# ── 5. Semver assessment ────────────────────────────────────────────────────
step "Assessing next version"

if [[ -z "$LATEST_TAG" ]]; then
  # No prior tag — parse current version from deno.json or start at 1.0.0
  CURRENT_VERSION="$(node -p "require('./deno.json').version" 2>/dev/null || echo "1.0.0")"
  # Use the version in deno.json as the baseline for the new tag
  BASE_MAJOR="$(echo "$CURRENT_VERSION" | cut -d. -f1)"
  BASE_MINOR="$(echo "$CURRENT_VERSION" | cut -d. -f2)"
  BASE_PATCH="$(echo "$CURRENT_VERSION" | cut -d. -f3)"
else
  # Strip leading 'v'
  CURRENT_VERSION="${LATEST_TAG#v}"
  BASE_MAJOR="$(echo "$CURRENT_VERSION" | cut -d. -f1)"
  BASE_MINOR="$(echo "$CURRENT_VERSION" | cut -d. -f2)"
  BASE_PATCH="$(echo "$CURRENT_VERSION" | cut -d. -f3)"
fi

# Determine bump level from commits since last tag (or all commits if no tag)
if [[ -z "$LATEST_TAG" ]]; then
  COMMIT_RANGE="HEAD~${COMMITS_SINCE_TAG}..HEAD"
  # If COMMITS_SINCE_TAG equals total commits, we can't use HEAD~N..HEAD for N = all
  # Use a safe range
  if [[ "$COMMITS_SINCE_TAG" -ge "$(git rev-list --count HEAD)" ]]; then
    COMMIT_RANGE="$(git rev-list --max-parents=0 HEAD)..HEAD"
  fi
else
  COMMIT_RANGE="${LATEST_TAG}..HEAD"
fi

BUMP_LEVEL="${OVERRIDE_BUMP:-patch}"

# Check for breaking changes first (highest priority)
if git log --oneline "$COMMIT_RANGE" | grep -qiE '(BREAKING CHANGE|^[a-z0-9]+! )'; then
  BUMP_LEVEL="major"
elif git log --oneline "$COMMIT_RANGE" | grep -qE '^feat(\(.+\))?:'; then
  if [[ "$BUMP_LEVEL" != "major" ]]; then
    BUMP_LEVEL="minor"
  fi
fi

case "$BUMP_LEVEL" in
  major)
    NEW_MAJOR=$((BASE_MAJOR + 1))
    NEW_VERSION="${NEW_MAJOR}.0.0"
    ;;
  minor)
    NEW_MINOR=$((BASE_MINOR + 1))
    NEW_VERSION="${BASE_MAJOR}.${NEW_MINOR}.0"
    ;;
  patch)
    NEW_PATCH=$((BASE_PATCH + 1))
    NEW_VERSION="${BASE_MAJOR}.${BASE_MINOR}.${NEW_PATCH}"
    ;;
esac

NEW_TAG="v${NEW_VERSION}"

info "Current version:  $CURRENT_VERSION"
info "Bump level:        $BUMP_LEVEL"
info "New version:       $NEW_VERSION"
info "New tag:           $NEW_TAG"

# ── 6. Confirmation ─────────────────────────────────────────────────────────
if [[ "$SKIP_CONFIRM" != true ]]; then
  echo ""
  echo -e "${BOLD}Summary${NC}"
  echo "  Branch:   $CURRENT_BRANCH"
  echo "  Commits:  $COMMITS_SINCE_TAG since $LATEST_TAG"
  echo "  Bump:     $BUMP_LEVEL"
  echo "  Tag:      $NEW_TAG"
  echo ""
  read -r -p "Create and push tag $NEW_TAG? [y/N] " -n 1
  echo
  if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
    info "Aborted."
    exit 0
  fi
fi

# ── 7. Update deno.json version ─────────────────────────────────────────────
step "Updating version in deno.json"

# Use a portable sed-free approach via python
python3 -c "
import json, sys
with open('deno.json') as f:
    data = json.load(f)
if data.get('version') != '$NEW_VERSION':
    data['version'] = '$NEW_VERSION'
    with open('deno.json', 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('Updated deno.json version → $NEW_VERSION')
else:
    print('Version already $NEW_VERSION, no change needed')
"

# ── 8. Commit version bump ──────────────────────────────────────────────────
step "Committing version bump"

git add deno.json
if ! git diff --cached --quiet; then
  git commit -m "chore: bump version to $NEW_VERSION"
  ok "Committed version bump"
else
  info "No version change to commit (already at $NEW_VERSION)"
fi

# ── 9. Create & push tag ────────────────────────────────────────────────────
step "Creating and pushing tag"

if git tag | grep -q "^${NEW_TAG}$"; then
  die "Tag $NEW_TAG already exists locally."
fi

git tag "$NEW_TAG"
ok "Tag $NEW_TAG created"

info "Pushing tag to remote..."
if git push origin "$NEW_TAG"; then
  ok "Tag $NEW_TAG pushed to origin"
else
  die "Failed to push tag $NEW_TAG."
fi

# ── Done ────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}✓ Released $NEW_TAG${NC}"
echo ""
echo "  The GitHub Actions workflow will now publish to JSR."
echo "  Watch: https://github.com/${GITHUB_REPOSITORY:-ball6847/serve-md}/actions"
echo ""
