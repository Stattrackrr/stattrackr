# Git Workflow

Use this workflow to keep `master` clean and avoid getting both ahead and behind remote.

## Daily flow

1. Sync `master`
   - `git checkout master`
   - `git pull --rebase origin master`
2. Start a new branch for each task
   - `git checkout -b fix/short-description`
3. Commit only the files for that task
4. Push the branch
   - `git push -u origin HEAD`
5. Open a PR into `master`
6. After merge, return to `master` and sync again before starting the next task

## Rules

- Do not do day-to-day work directly on `master`
- Do not commit generated files like `.next/`, `__pycache__/`, or local-only AFL scratch outputs
- Keep unrelated work in separate branches
- If a branch gets stale, rebase that branch instead of stacking more commits on `master`

## GitHub settings to enable

Turn on branch protection for `master` and enable:

- Require a pull request before merging
- Require status checks to pass before merging
- Include the `Repo Hygiene` workflow as a required check
- Restrict who can push to matching branches
- Optionally require branches to be up to date before merging

## AFL model notes

- Keep committed outputs limited to the files the workflows intentionally publish
- Treat local scratch files as disposable and leave them untracked
- If Git reports LFS pointer issues for model files, fix that separately rather than committing around it
