#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [branch]"
  echo "Without a branch, update the current branch from its configured upstream."
  echo "With a branch, update or create that local branch from origin/<branch>."
}

die() { echo "$*" >&2; exit 1; }
compose() { "$project_root/scripts/production.sh" "$@"; }

step() {
  printf '\n\n'
  if [ -t 1 ] && [ "${TERM:-dumb}" != dumb ] && [ -z "${NO_COLOR+x}" ]; then
    printf '\033[1;36m==> %s\033[0m\n\n' "$1"
  else
    printf '==> %s\n\n' "$1"
  fi
}

cleanup() {
  result=$?
  trap - EXIT
  if [ "$db_lock_held" = true ]; then
    rmdir -- "$db_lock_dir"
  fi
  rmdir -- "$lock_dir"
  if [ "$result" -ne 0 ]; then
    echo "Update stopped. Previous revision: $previous_revision" >&2
    echo "Inspect scripts/production.sh ps and scripts/production.sh logs --tail=100 app before retrying." >&2
    echo "No automatic code or database rollback was performed." >&2
  fi
  exit "$result"
}

# Parse the complete function before checkout: Git may replace this script itself.
main() {
  if [ "$#" -eq 1 ] && { [ "$1" = --help ] || [ "$1" = -h ]; }; then
    usage
    exit 0
  fi
  if [ "$#" -gt 1 ]; then usage >&2; exit 2; fi

  project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)
  cd "$project_root"
  step "[1/8] Check checkout and prerequisites"
  for command in git docker curl; do
    command -v "$command" >/dev/null || die "Required command not found: $command"
  done
  [ "$(git rev-parse --show-toplevel)" = "$project_root" ] || die "Run from a SillyStories Git checkout."
  [ -z "$(git status --porcelain --untracked-files=normal)" ] || die "Checkout has local changes. Commit, stash, or remove them before updating."

  if [ "$#" -eq 1 ]; then
    branch=$1
    remote=origin
    merge_ref="refs/heads/$branch"
  else
    branch=$(git symbolic-ref --quiet --short HEAD) || die "Detached HEAD: supply a branch to deploy."
    remote=$(git config --get "branch.$branch.remote") || die "No upstream for $branch: supply a branch to deploy from origin."
    merge_ref=$(git config --get "branch.$branch.merge") || die "No upstream branch configured for $branch."
  fi
  case "$branch" in ''|-*) die "Invalid branch name." ;; esac
  git check-ref-format "refs/heads/$branch" >/dev/null || die "Invalid branch name."
  [ "$remote" != . ] || die "The upstream must be a remote repository."
  case "$merge_ref" in refs/heads/*) ;; *) die "The upstream must be a branch." ;; esac
  tracking_ref="refs/remotes/$remote/${merge_ref#refs/heads/}"
  previous_revision=$(git rev-parse HEAD)
  lock_dir=$(git rev-parse --git-path silly-stories-deploy.lock)
  mkdir "$lock_dir" 2>/dev/null || die "Another update is running ($lock_dir)."
  db_lock_dir="$project_root/.db-operation.lock"
  db_lock_held=false
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM

  # Fetch and reject missing/divergent branches before interrupting the live app.
  step "[2/8] Fetch and validate target branch"
  git fetch --no-tags -- "$remote" "+$merge_ref:$tracking_ref"
  target_revision=$(git rev-parse --verify "$tracking_ref^{commit}")
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git merge-base --is-ancestor "refs/heads/$branch" "$target_revision" ||
      die "Local branch $branch has commits absent from the remote. Refusing to discard them."
  fi
  compose config --quiet
  for service in mongodb app caddy; do
    [ -n "$(compose ps --status running --quiet "$service")" ] ||
      die "$service is not running. Follow deploy/README.md for first deployment or recovery."
  done

  echo "Updating $branch to $target_revision (previous revision: $previous_revision)."
  step "[3/8] Back up the database"
  "$project_root/scripts/backup-db.sh"

  # The backup releases its lock on exit. Reacquire it before deployment can
  # restart the app, and keep backups/restores out until verification finishes.
  mkdir "$db_lock_dir" 2>/dev/null || die "Another database operation is running ($db_lock_dir). Retry after it finishes."
  db_lock_held=true

  step "[4/8] Save the previous app image for rollback"
  previous_image=$(compose images --quiet app)
  [ -n "$previous_image" ] || die "Cannot identify the running app image."
  docker image tag "$previous_image" silly-stories:rollback
  echo "Previous app image saved as silly-stories:rollback."

  step "[5/8] Update checkout and validate configuration"
  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git switch -- "$branch"
    git merge --ff-only "$target_revision"
  else
    git switch --create "$branch" --track "$remote/${merge_ref#refs/heads/}"
  fi
  compose config --quiet

  step "[6/8] Build the app image"
  compose build --pull app

  step "[7/8] Replace the app container"
  compose up -d --no-deps --no-build --wait app

  step "[8/8] Verify container health and public HTTPS"
  compose ps
  public_origin=$(compose exec -T app node -p 'process.env.PUBLIC_ORIGIN')
  case "$public_origin" in https://*) ;; *) die "App has no valid HTTPS public origin." ;; esac
  curl --fail --silent --show-error --output /dev/null \
    --connect-timeout 5 --max-time 15 --retry 5 --retry-delay 2 --retry-connrefused \
    "$public_origin/healthz"
  step "Deployment complete"
  echo "Deployment verified: $target_revision at $public_origin"
}

main "$@"
