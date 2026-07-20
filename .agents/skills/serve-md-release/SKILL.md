---
name: serve-md-release
description: Release a new version of the serve-md package to JSR. Use this skill whenever the user wants to release, publish, tag, bump the version, or cut a new version of serve-md. Triggers on phrases like "release serve-md", "publish to JSR", "bump version", "cut a new tag", "release a new version", or any request to prepare or perform a serve-md release.
---

# serve-md Release

Runs the pre-release quality gates, assesses the next semver version from commits, creates a git tag, and pushes it to trigger the JSR publish workflow.

## What it does

The release is fully scripted in `scripts/release.sh`. The script:

1. **Branch check** — refuses to run unless you are on `main`.
2. **Commits ahead of tag** — verifies there are new commits since the last git tag.
3. **`deno task check`** — runs fmt, lint, and tests. Fails the release if any check fails.
4. **`deno task release:check`** — runs `jsr publish --dry-run` to confirm the package is valid for JSR.
5. **Semver assessment** — inspects commits since the last tag and determines the bump level:
   - `BREAKING CHANGE` or `feat!` → major
   - `feat:` → minor
   - `fix:` or anything else → patch
6. **Confirmation** — shows the proposed version and asks for approval (skip with `--yes`).
7. **Version bump** — updates `version` in `deno.json` and commits it.
8. **Tag & push** — creates the git tag locally and pushes it to `origin`, which triggers the GitHub Actions JSR publish workflow.

## Usage

The agent runs the script directly. Users do not need to invoke it themselves.

```bash
# The agent invokes:
.agents/skills/serve-md-release/scripts/release.sh --yes

# Optional: override the semver assessment
.agents/skills/serve-md-release/scripts/release.sh --yes --bump minor
```

## What you should do

1. Run `.agents/skills/serve-md-release/scripts/release.sh --yes` from the repository root.
2. Report the output back to the user — especially the new tag name and whether all checks passed.
3. If any check fails, report the failure and stop. Do not attempt to bypass or fix the failure automatically.

## Important notes

- The script resolves the repository root from its own location, so it can be invoked from anywhere.
- The `--yes` flag is required when the agent invokes it so it does not block on interactive input.
- The script updates `deno.json` and creates a commit for the version bump before tagging.
- Pushing the tag triggers the GitHub Actions workflow (`.github/workflows/publish.yml`) which publishes to JSR.
