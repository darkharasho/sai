---
name: release
description: Bump version, generate release notes from commits, tag, and create a draft GitHub release. Usage: /release <patch|minor|major>
user_invocable: true
---

# Release

Create a new release by bumping the version, generating release notes from commit history, tagging, and creating a draft GitHub release. A GitHub Actions workflow will then build and attach platform artifacts.

## Instructions

1. **Parse the argument.** The user must provide exactly one of: `patch`, `minor`, or `major`. If missing or invalid, respond with: "Usage: `/release <patch|minor|major>`" and stop.

2. **Validate the working tree.** Run `git status --porcelain`. If there is any output, respond with: "Working tree is not clean. Please commit or stash changes first." and stop.

3. **Validate the branch.** Run `git branch --show-current`. If not `main`, respond with: "You must be on the `main` branch to release." and stop.

4. **Pull latest.** Run `git pull --ff-only`. If it fails, warn the user and stop.

5. **Read current version.** Read `package.json` and extract the `version` field.

6. **Bump the version.** Parse the current version as `major.minor.patch`. Increment the segment specified by the argument (reset lower segments to 0). Write the new version back to `package.json`.

7. **Generate release notes.** Run:
   ```
   git log $(git describe --tags --abbrev=0 2>/dev/null || git rev-list --max-parents=0 HEAD)..HEAD --pretty=format:"%s (%h)" --no-merges
   ```
   If there is no previous tag, use all commits. Group the commits:
   - Lines starting with `feat` → **Features** section
   - Lines starting with `fix` → **Bug Fixes** section
   - All other lines → **Other Changes** section

   Format as markdown. Omit empty sections. Example:
   ```markdown
   ## Features
   - feat: add file explorer sidebar (abc1234)
   - feat: add Monaco editor modal (def5678)

   ## Bug Fixes
   - fix: widen line number columns (bbb2222)

   ## Other Changes
   - style: brighten muted text color (ccc3333)
   - docs: add design spec (ddd4444)
   ```

8. **Commit the version bump.**
   ```bash
   git add package.json
   git commit -m "release: v{version}"
   ```

9. **Create the tag.**
   ```bash
   git tag v{version}
   ```

10. **Push.**
    ```bash
    git push && git push --tags
    ```

11. **Create draft GitHub release.** Use `gh release create` with the generated notes:
    ```bash
    gh release create v{version} --draft --title "v{version}" --notes "{notes}"
    ```

12. **Report success.** Tell the user:
    - The new version number
    - That the draft release was created
    - That GitHub Actions will build and attach Linux AppImage + Windows installer artifacts
    - Link to the release page
