---
name: silly-stories-deploy
description: Deploy, migrate, update, troubleshoot, or back up this SillyStories repository on a VPS using the existing Docker Compose stack. Use for this project's production hosting operations, not ordinary app development or unrelated deployments.
---

# Silly Stories deployment

Deploy the Node.js app, authenticated MongoDB, and Caddy on the same VPS at
`https://silly-stories.organicdarius.com`. Reuse the repository's implementation;
keep detailed operator instructions in its existing runbook.

## Establish the target

- Resolve the repository root from this skill's location, independent of the
  current working directory. Commands below run from that root, or from the
  confirmed checkout on the target VPS when operating remotely.
- Read [the deployment runbook](../../../deploy/README.md), loading the sections
  relevant to the requested operation. Inspect `compose.production.yaml` and the
  relevant `scripts/` helpers before using them; current files win over this skill.
- Identify the requested operation, VPS SSH target, checkout path, desired source
  revision, and whether production data already exists. Use facts from the current
  task and existing configuration. The runbook's IP, user, and checkout path are
  examples, not proof of a configured server. Never SSH to a placeholder address.
- If VPS details are missing, finish useful local preparation and request the
  missing target details before remote work. Use existing task authorization;
  creating or reading this skill does not itself request a live deployment.
  Do not purchase infrastructure or perform a destructive database reset without
  authorization for that action.

## Operational invariants

- Use `scripts/production.sh` for production Compose operations. Plain
  `docker compose` selects the separate, unauthenticated development database.
  Check `COMPOSE_PROJECT_NAME`, `SILLY_ENV_FILE`, and `SILLY_COMPOSE_FILE` overrides
  before acting: they can select another stack or volume set.
- Keep the existing project name and database/certificate volumes when updating.
  Never delete or prune production volumes. Keep MongoDB and app ports private;
  only Caddy publishes web ports, as defined in `compose.production.yaml`.
  Retain database authentication, least-privilege app credentials, internal
  networks, and the non-root, read-only app container.
- Run one app replica. Story serialization and rate limits are process-local.
  Adding a CDN/proxy requires revisiting client-IP trust and CSRF origin handling.
- Keep `.env.production`, `deploy/secrets/`, exports, and credentials out of Git,
  images, logs, and replies. Do not print secrets to inspect configuration.
  Setup generates passwords only when missing; replacing secret files on an
  initialized database does not rotate its users and can break authentication.

## First deployment or migration

Follow runbook sections 1–4 for provisioning, firewall/SSH hardening, configuration,
data migration, and DNS. Confirm the real certificate contact replaces the example
in `.env.production`. Configure `DOMAIN` as the bare hostname; the app derives
`PUBLIC_ORIGIN` from it at runtime.

For migration, establish a maintenance window and stop source writes before the
final dump. Check source MongoDB/tool compatibility with the target version and
the `sillyStories` database namespace. Initialize **only MongoDB**, restore into
the empty database, then start the app. First app startup creates collections,
which makes the safe restore script refuse the target even without user data.
Preserve the source database and export until validation and rollback readiness
are established. Account for stale DNS caches; do not allow two writable sites.

DNS must resolve to the real VPS, including any AAAA record. Verify the VPS
provider's firewall allows HTTPS/HTTP and limits SSH to administrator ranges;
UFW alone does not control Docker-published ports. Follow the runbook's cutover sequence before
starting Caddy against a public hostname.

## Update an existing deployment

For routine app releases, use `scripts/update-production.sh [branch]` from the
existing VPS checkout (an absolute path works from any directory). With no
argument it uses the current branch's configured upstream; an explicit branch
selects `origin/<branch>`. Read the helper and runbook before invoking it. It
requires a clean checkout and running stack, refuses divergent local commits,
backs up the database, saves the app image as `silly-stories:rollback`, rebuilds
and replaces only the app, then checks public HTTPS. It stops on failure without
automatic rollback. Treat Compose/Caddy/database changes as separate operations.

Identify the current revision/image and check for remote checkout changes before
replacing code. Preserve a known-good release and obtain a successful database
export with `scripts/backup-db.sh` before rollout. The export briefly stops a
running app and restarts it afterward; account for that service interruption.

Validate relevant changes under the Node.js version in `package.json` using
`npm test` and `npm audit --omit=dev`; use `npm ci` when installing dependencies.
Validate Compose with `scripts/production.sh config --quiet`. Deploy the selected
revision using the runbook's local-build or versioned-registry workflow. Match the
image architecture to the VPS. Do not automatically pull unrelated service
updates or upgrade MongoDB's major version as part of an app-only deployment.

If rollout fails, inspect status and bounded logs, fix a diagnosed cause, or
restore the known-good app release while preserving data. Do not loop through
blind redeployments, reset the database, or roll DNS back to an old database after
new writes without reconciling those writes.

## Backups and restore

Use `scripts/backup-db.sh [destination-directory]` and
`scripts/restore-db.sh /path/to/archive.gz`. Follow runbook section 5 for retention,
off-server copies, the optional timer, and recovery. A local archive is not an
off-server backup; report whether a separate destination is actually configured.

Restore requires a database with no collections. If it refuses an existing
database, stop and explain the conflict instead of bypassing the safeguard.
An import failure leaves the app stopped for inspection. Diagnose it before
resuming traffic. Test restores in an isolated project with different volumes
and no public port collisions. Never clear an operation lock until confirming
that no database operation is still running.

## Verify and report

Check `scripts/production.sh ps` and bounded Caddy/app logs. `up --wait` confirms
container readiness, not public certificate issuance. Verify the public HTTPS
`/healthz`, HTTP-to-HTTPS redirect, and relevant page/form behavior. Avoid adding
test sentences to the real collaborative story unless that write is authorized;
use an isolated stack for submission/concurrency and destructive restore tests.
For migration, compare story and unfinished-sentence counts with the source.

Report the target and deployed revision/image, checks performed, database/backup
state, and any remaining operator action. Distinguish local validation from an
actual remote deployment. Keep this skill and the runbook aligned when deployment
behavior changes; keep credentials and private server access details untracked.
