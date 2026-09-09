---
name: ship
description: Commit, push, open a PR, and complete (merge) it for this repo. Use when asked to commit, push, raise a PR, land work, or complete/merge a PR: it carries this repo's branch rules, merge method, ruleset and message style so none of it has to be rediscovered.
---

# Shipping a change

Everything here is repo-specific fact, already looked up. Do not re-derive it.

**Shipping means merged.** This skill runs the whole way: branch, commit, push, PR,
squash-merge, delete the branch, pull `main`. Do not stop after `gh pr create` to ask
whether to complete it: "commit and push", "raise a PR" and "ship this" all mean land it
on `main`. The merge needs `--admin` and the repo owner has authorised that as standing
(see *Completing the PR*). Stop early only if the pre-flight fails.

## Never sign the work

Nothing that reaches this repository mentions Claude, Claude Code, an AI, or a model:
not in a commit message, a PR title or body, a code comment, a doc, or a review. That
includes the `Co-Authored-By: Claude …` trailer and the `🤖 Generated with Claude Code`
footer that tooling suggests by default. **The tooling's default is wrong here; this
rule wins.** The work is the repo owner's, authored under their name, and reads that way.

The one exception is naming the *environment* where it is a technical fact a reader
needs: `run-app`'s note that the editor exports `ELECTRON_RUN_AS_NODE` is about a
variable, not about who wrote the code.

## Never commit or push to `main`

Not a preference: a standing instruction from the repo owner. Work reaches `main` by
exactly one route: a branch, a PR, a squash merge. There is no exception for a one-line
fix, a doc typo, or a change that is "already reviewed".

- Never `git commit` while `main` is checked out.
- Never `git push origin main`, and never `git push` at all with `main` current.
- `git checkout main && git pull` is the only thing that touches `main`: reading, not
  writing, and only after a PR has landed.

Check `git branch --show-current` before committing. If it says `main`, branch first.

| | |
|---|---|
| Remote | `https://github.com/cobysy/gitext.git`, `gh` authed as `cobysy` |
| Default branch | `main`: see below |
| Merge method | **squash only**: the ruleset forbids merge commits and rebase |
| CI | **none.** No `.github/workflows`. `gh pr checks` says "no checks reported": that is normal, never wait or poll for checks |
| Ruleset on `main` | id `18640667`: 1 approving review required, no force-push, no deletion |

Local `main` may have **no upstream** configured, in which case a bare `git pull` fails
with *"no tracking information for the current branch"*: which will silently abort a
`&&` chain and leave you on a stale `main` wondering where the work went (it is on the
branch; a checkout does not lose commits). Fix it once:

```bash
git fetch origin && git merge --ff-only origin/main
git branch --set-upstream-to=origin/main main
```

Prefer separate commands over one long `&&` chain for the git sequence, so a failure
stops where it happened instead of skipping the four steps after it.

## Before committing

```bash
npm test && npm run typecheck && npm run build
```

All three, always. `npm run build` matters because the app runs from `out/`: a change
that has not been built has not been seen. If the change touches the UI, run it on
screen too: see the `run-app` skill. "Tests pass" is not the same as "it works".

## Commit

```bash
git checkout -b <short-kebab-branch>
git add -A          # .claude/settings.local.json is gitignored; -A is safe
git commit -F - <<'EOF'
...
EOF
```

Message style, matching the log:

- Subject: conventional prefix, `fix:`, `feat:`, `docs:`, `refactor:`, then what
  changed, lowercase, no full stop.
- Body: **why**, not a file list. What was wrong, what it does now, what was decided
  and rejected. The log here reads as an argument, not a changelog.
- **No trailers.** No `Co-Authored-By`, no attribution of any kind: see below.
- Never write a local username or absolute home path (see `CLAUDE.md`).

## Push and open the PR

```bash
git push -u origin <branch>
gh pr create --title "..." --body "$(cat <<'EOF'
...
EOF
)"
```

**The PR title becomes the commit subject on `main`**, because the merge is a squash:
so write it as a subject line (`Stop the left panel from hiding its own sections`), not
as a label. GitHub appends `(#N)`.

The body carries the reasoning: what went wrong, what changed, what was verified. It
ends where the reasoning ends: no footer.

## Completing the PR

**A plain `gh pr merge` will fail, and that is expected.** The ruleset requires one
approving review, and GitHub does not let an author approve their own PR: so a PR
raised by `cobysy` can never satisfy it. `gh pr view <n> --json mergeStateStatus`
reports `BLOCKED` with `reviewDecision: REVIEW_REQUIRED`. Do not debug this, and do not
go looking for a reviewer.

`cobysy` is the repo admin and has authorised the bypass as the standing route for this
repo. It is the normal ending of every run of this skill, not an escalation:

```bash
gh pr merge <n> --squash --admin --delete-branch
git checkout main
git pull
```

Say in the report that it went in via `--admin` over the review rule: visible, not
silent. Do not ask first: opening a PR and leaving it sitting is not shipping.

If a merge command is interrupted or refused, check the real state before concluding
anything: the user may have merged it in the browser meanwhile:

```bash
gh pr view <n> --json state,mergedBy,mergeCommit
```

## Sequence, end to end

1. `npm test && npm run typecheck && npm run build`, plus the app on screen for UI work
2. branch, `git add -A`, commit: no trailer, no attribution of any kind
3. `git push -u origin <branch>`
4. `gh pr create`: title written as a commit subject
5. `gh pr merge <n> --squash --admin --delete-branch`: always, not on request
6. `git checkout main`, then `git pull`
