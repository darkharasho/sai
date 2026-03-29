# Release Workflow

## Summary

A `/release <patch|minor|major>` Claude Code skill that bumps the version, generates release notes from commits, creates a git tag and draft GitHub release, then a GitHub Actions workflow builds Linux AppImage + Windows NSIS installer and attaches them to the release.

## Part 1: `/release` Skill

**Location:** `.claude/skills/release.md`

**Invocation:** `/release patch`, `/release minor`, `/release major`

**Steps:**

1. **Validate** — clean working tree, on `main` branch, argument is `patch`, `minor`, or `major`
2. **Bump version** — read `package.json`, increment the specified semver segment, write back
3. **Generate release notes** — `git log` from last `v*` tag to HEAD, parse conventional commit prefixes, group into sections:
   - `feat:` → "Features"
   - `fix:` → "Bug Fixes"
   - Everything else (`style:`, `docs:`, `chore:`, `refactor:`, no prefix) → "Other Changes"
   - Each entry formatted as: `- {message} ({short hash})`
   - Empty sections omitted
4. **Commit** — `git add package.json && git commit -m "release: v{version}"`
5. **Tag** — `git tag v{version}`
6. **Push** — `git push && git push --tags`
7. **Create draft release** — `gh release create v{version} --draft --title "v{version}" --notes "{notes}"`

**Error handling:**
- Dirty working tree → abort with message
- Not on main → abort with message
- Missing/invalid argument → abort with usage hint
- No previous tag → use all commits from repo history
- `gh` or `git push` failure → abort, user can retry manually

## Part 2: GitHub Actions Workflow

**Location:** `.github/workflows/release.yml`

**Trigger:** Push of tags matching `v*`

### Job 1: `build`

**Strategy:** Matrix on `os: [ubuntu-latest, windows-latest]`

**Steps:**
1. `actions/checkout@v4`
2. `actions/setup-node@v4` with `node-version: 20`
3. `npm ci`
4. `npm run build` (tsc + vite build)
5. Run `npx electron-builder` with platform-specific flags:
   - Linux: `--linux AppImage`
   - Windows: `--win nsis`
6. Upload artifacts from `release/` to the draft GitHub release via `gh release upload`

**Permissions:** `contents: write`

### Job 2: `publish`

**Needs:** `build` (waits for both matrix jobs)

**Steps:**
1. `gh release edit v{tag} --draft=false` — marks the release as published

## Part 3: package.json Changes

Add Windows target to the existing `build` config:

```json
"win": {
  "target": "nsis",
  "icon": "public/img/sai.png"
}
```

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `.claude/skills/release.md` | Claude Code skill for `/release` |
| Create | `.github/workflows/release.yml` | GitHub Actions workflow for building + publishing |
| Modify | `package.json` | Add `win` build target |
