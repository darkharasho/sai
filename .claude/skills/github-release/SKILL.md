---
name: github-release
description: Create a release for SAI - bumps version, generates release notes, tags, pushes, and creates a draft GitHub release. CI automatically builds artifacts and publishes.
user-invocable: true
---

# /github-release

Create a release for SAI. Bumps version, generates release notes, tags, pushes, and creates a draft GitHub release. The GitHub Actions workflow automatically builds artifacts for all platforms and publishes the release when done.

## Usage

```
/github-release patch
/github-release minor
/github-release major
```

The argument is required and must be one of `patch`, `minor`, or `major`.

## Instructions

When the user invokes `/release <bump>`, follow these steps exactly:

### Step 1: Validate

1. Run `git status --porcelain` — if output is non-empty, abort: "Working tree is dirty. Commit or stash changes first."
2. Run `git branch --show-current` — if not `main`, abort: "Must be on the main branch to release."
3. Check that the argument is one of `patch`, `minor`, or `major`. If missing or invalid, abort with usage hint.

### Step 2: Run Tests

Run the test suite before proceeding:

```bash
npm test
```

If any tests fail, STOP immediately. Show the failing test output to the user and do NOT proceed with the release. Tell them to fix the failing tests first.

#### Optional: E2E Tests

Check if the user included `e2e` as an additional argument (e.g., `/github-release patch e2e`).

If `e2e` was specified:

```bash
npm run test:e2e
```

If E2E tests fail, STOP and show the output. Do NOT proceed with the release.

If `e2e` was NOT specified, skip this step.

### Step 3: Bump version

1. Read `package.json`.
2. Parse the current `version` field (semver: `MAJOR.MINOR.PATCH`).
3. Increment the segment specified by the argument, resetting lower segments to 0.
4. Write the updated version back to `package.json` (change only the version field, preserve everything else).
5. Tell the user the old and new version.

### Step 4: Generate release notes

1. Run `git describe --tags --abbrev=0` to find the previous tag. If no tags exist, use the root commit.
2. Run `git log <prev-tag>..HEAD --pretty=format:"%h %s"` to get commits since the last release.
3. Group commits into sections by conventional commit prefix:
   - `feat:` or `feat(...):`  -> **What's New**
   - `fix:` or `fix(...):`    -> **Bug Fixes**
   - Skip internal-only changes (`chore`, `ci`, `docs`, `style`, `refactor`, `test`, `build`, `release` commits) — users don't need to see these.
4. **Rewrite each entry in plain, user-facing language.** Strip the conventional commit prefix and scope. Describe the change from the user's perspective — what they can now do or what got fixed. Keep it concise but clear. Do not include commit hashes.
5. Omit empty sections.
6. Store the formatted notes for use in Step 6.

   Example output:
   ```markdown
   ## What's New
   - Browse files with the new file explorer sidebar
   - Edit files in a full-featured code editor modal

   ## Bug Fixes
   - Fixed line numbers being cut off in narrow windows
   ```

### Step 5: Commit and tag

Run these commands sequentially:

```bash
git add package.json
git commit -m "release: v{NEW_VERSION}"
git tag v{NEW_VERSION}
```

### Step 6: Push and create draft release

Run these commands sequentially:

```bash
git push
git push --tags
```

Then create the draft release:

```bash
gh release create v{NEW_VERSION} --draft --title "v{NEW_VERSION}" --notes "{RELEASE_NOTES}"
```

Use a heredoc for the notes body to preserve formatting.

### Step 7: Done

1. Tell the user: "Draft release created. GitHub Actions is now building artifacts for Linux, Windows, and macOS."
2. Explain that the CI workflow will automatically:
   - Build artifacts for all platforms (`.dmg`, `.exe`, `.AppImage`, auto-update manifests)
   - Attach them to the draft release
   - Publish the release (mark as non-draft) once all builds succeed
3. Provide the release URL for the user to monitor:
   ```bash
   gh release view v{NEW_VERSION} --json url --jq '.url'
   ```
4. Provide the Actions run link so the user can watch build progress:
   ```bash
   gh run list --workflow=release.yml --limit=1 --json url --jq '.[0].url'
   ```

### Error recovery

- If `git push` fails, the commit and tag are local only. Tell the user they can retry with `git push && git push --tags`.
- If `gh release create` fails, the tag is already pushed. Tell the user they can create the release manually on GitHub.
- If the workflow fails, the draft release exists but has no/partial artifacts. Tell the user to check the Actions tab and re-run the failed jobs.
