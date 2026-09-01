---
name: omni-studio-git-publish
description: Omni Studio GitHub publish workflow for safe commits, sensitive-data scans, and PR-based pushes to the shared GitHub repo.
---

# Omni Studio GitHub Publish Workflow

Use this workflow when working in this repository and the user asks to publish work to the Omni Studio GitHub repository, prepare a GitHub-ready branch, or follow the Omni Studio GitHub PR flow.

## Core Rules

- **Never push directly to `main`.** `main` is the shared stable branch for the whole team. All development happens on a feature, fix, or docs branch, and lands in `main` only through a reviewed, CI-green pull request.
- Push to the `github` remote only. Ignore `origin` for publishing.
- Run sensitive-data checks before any push.
- Commit messages must follow Conventional Commits.
- Use the locally configured git author (already set up in this repo; do NOT modify git config).
- Open GitHub PRs with the `zhxqc` GitHub account (already authenticated via `gh`).

Repository-specific constraints:

- GitHub remote: `github`
- GitHub repository: `https://github.com/Dylan-Nihilo/OmniStudio.git`
- Allowed branch prefixes: `feature/`, `fix/`, `docs/`

## Step 1: Create a Working Branch

Check the current branch:

```bash
git branch --show-current
```

If the branch is `main` (or it is stale), create a fresh branch from the latest `main` first:

```bash
git fetch github
git checkout -b feature/<your-feature-name> github/main
```

Never commit directly on `main`. If you already made commits on `main`, move them to a branch before pushing:

```bash
git switch -c feature/<your-feature-name>
```

## Step 2: Sensitive-Data Checks

Run all of the following checks. Any hit must be reviewed and resolved before continuing.

Search for suspicious hardcoded secrets:

```bash
git grep -E "['\"][a-zA-Z0-9_-]{40,}['\"]" -- ':(exclude)*.lock' ':(exclude)node_modules'
```

Search for internal company domains:

```bash
git grep -i "alibaba-inc.com"
```

Search for credential-like patterns:

```bash
git grep -iE "(sk-|AKID|access_key|password|pwd|token|bearer)" -- ':(exclude)*.lock' ':(exclude)*.example' ':(exclude)node_modules'
```

Search tracked sensitive files:

```bash
git ls-files | grep -E "\.env$|secret|credential|\.key$|\.pem$" | grep -v "\.example"
```

## Step 3: Check .gitignore Coverage

Verify that `.gitignore` contains the expected sensitive and local paths:

```bash
grep -E "^\.env|^\.agent|^CLAUDE\.md|^output/" .gitignore
```

Expected coverage includes:

- `.env`
- `.agent/`
- `CLAUDE.md`
- `output/`

## Step 4: Workflow Mirror Parity Check (when workflow mirrors changed)

If the change touches `.claude/commands/` or `.codex/workflows/`, run:

```bash
python3 scripts/check_workflow_parity.py
```

On failure: sync the mirrored files on both sides, or record an intentional divergence with its reason in the script's `WAIVERS`.

## Step 5: Optional Quality Checks

Run relevant checks when the changed files warrant them.

Backend formatting and lint:

```bash
black --check src/
flake8 src/
```

Frontend lint:

```bash
cd frontend && npm run lint
```

## Step 6: Stage Carefully

Stage only the intended files. Do not use `git add .`.

```bash
git add <specific-files>
```

## Step 7: Commit

Create an English Conventional Commit message:

```bash
git commit -m "feat: your descriptive commit message"
```

Before committing, confirm the author identity matches the project convention:

```bash
git log -1 --format='%an <%ae>'
```

Author for GitHub-bound commits in this repo is the locally configured one (do NOT modify git config). Never add `Co-Authored-By` lines.

Common prefixes:

- `feat:`
- `fix:`
- `docs:`
- `style:`
- `refactor:`
- `test:`
- `chore:`

## Step 8: Push the Branch

Push the current branch to the `github` remote:

```bash
git push -u github <branch-name>
```

Never push to `main` directly.

## Step 9: Create a Pull Request

Use GitHub CLI (authenticated as `zhxqc`) to open the PR against `Dylan-Nihilo/OmniStudio`:

```bash
gh pr create --repo Dylan-Nihilo/OmniStudio --title "feat: your PR title" --body "$(cat <<'EOF'
## Summary
- <change description>

## Test plan
- [ ] <test checklist>

## Evidence
- <test output / verification links>
EOF
)"
```

If a PR already exists for this branch, update it instead:

```bash
gh pr view --repo Dylan-Nihilo/OmniStudio
```

## Step 10: Wait for CI and Merge

PRs targeting `main` run `backend-tests` (GitHub Actions). Wait for it to pass before merging:

```bash
gh pr checks --watch
```

Merge only when CI is green and the change has been reviewed:

```bash
gh pr merge --squash --delete-branch
```

Always squash-merge so `main` history stays one-commit-per-feature. After merging, the remote branch is deleted; delete the local branch too:

```bash
git switch main
git branch -D <branch-name>
git fetch github
```

## Step 11: Post-Push Verification

- Confirm the PR and merged commit are visible on GitHub.
- Check README rendering if docs changed.
- Confirm no sensitive information leaked in the diff.

## Emergency Rollback

If the commit has not been pushed yet:

```bash
git reset --soft HEAD~1
```

If sensitive data was already pushed, the history must be cleaned with BFG Repo-Cleaner and force pushed. Contact the team for assistance.
