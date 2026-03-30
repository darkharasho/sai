# /mac-release

Create a release for SAI. Bumps version, generates release notes, tags, pushes, creates a draft GitHub release, monitors the CI build, and publishes once artifacts are attached.

## Usage

```
/mac-release patch
/mac-release minor
/mac-release major
```

The argument is required and must be one of `patch`, `minor`, or `major`.

## Instructions

When the user invokes `/release <bump>`, follow these steps exactly:

### Step 1: Validate

1. Run `git status --porcelain` — if output is non-empty, abort: "Working tree is dirty. Commit or stash changes first."
2. Run `git branch --show-current` — if not `main`, abort: "Must be on the main branch to release."
3. Check that the argument is one of `patch`, `minor`, or `major`. If missing or invalid, abort with usage hint.

### Step 2: Bump version

1. Read `package.json`.
2. Parse the current `version` field (semver: `MAJOR.MINOR.PATCH`).
3. Increment the segment specified by the argument, resetting lower segments to 0.
4. Write the updated version back to `package.json` (change only the version field, preserve everything else).
5. Tell the user the old and new version.

### Step 3: Generate release notes

1. Run `git describe --tags --abbrev=0` to find the previous tag. If no tags exist, use the root commit.
2. Run `git log <prev-tag>..HEAD --pretty=format:"%h %s"` to get commits since the last release.
3. Group commits into sections by conventional commit prefix:
   - `feat:` or `feat(...):`  -> **Features**
   - `fix:` or `fix(...):`    -> **Bug Fixes**
   - Everything else           -> **Other Changes**
4. Format each entry as `- {message} ({short hash})`.
5. Omit empty sections.
6. Store the formatted notes for use in Step 5.

### Step 4: Commit and tag

Run these commands sequentially:

```bash
git add package.json
git commit -m "release: v{NEW_VERSION}"
git tag v{NEW_VERSION}
```

### Step 5: Push and create draft release

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

### Step 6: Monitor the GitHub Actions build

1. Tell the user: "Draft release created. GitHub Actions is now building artifacts for Linux, Windows, and macOS."
2. Wait ~30 seconds, then poll the workflow run:
   ```bash
   gh run list --workflow=release.yml --limit=1 --json status,conclusion,databaseId
   ```
3. If status is `in_progress` or `queued`, report progress and poll again every 60 seconds.
4. If conclusion is `success`, proceed to Step 7.
5. If conclusion is `failure`, report the failure and provide the command to view logs:
   ```bash
   gh run view {RUN_ID} --log-failed
   ```
   Then abort.

### Step 7: Verify and publish

1. Verify artifacts are attached:
   ```bash
   gh release view v{NEW_VERSION} --json assets --jq '.assets[].name'
   ```
   Confirm that `.dmg`, `.exe`, `.AppImage`, `latest.yml`, `latest-linux.yml`, and `latest-mac.yml` are all present.
2. If all artifacts are present, the `publish` job in the workflow will automatically mark the release as non-draft. Confirm:
   ```bash
   gh release view v{NEW_VERSION} --json isDraft --jq '.isDraft'
   ```
3. If `isDraft` is still `true` after the workflow completes, manually publish:
   ```bash
   gh release edit v{NEW_VERSION} --draft=false
   ```
4. Report the final release URL to the user:
   ```bash
   gh release view v{NEW_VERSION} --json url --jq '.url'
   ```

### Error recovery

- If `git push` fails, the commit and tag are local only. Tell the user they can retry with `git push && git push --tags`.
- If `gh release create` fails, the tag is already pushed. Tell the user they can create the release manually on GitHub.
- If the workflow fails, the draft release exists but has no/partial artifacts. Tell the user to check the Actions tab and re-run the failed jobs.
