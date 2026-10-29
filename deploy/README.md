# Deploy to a VPS

Run the app, MongoDB, and Caddy as **three containers on the same VPS**:

```text
Internet → Caddy (HTTPS) → Node.js → MongoDB
```

Only Caddy is public. The app runs as a non-root user with a read-only filesystem;
MongoDB is private and authenticated. Its data lives in the persistent
`silly-stories_mongodb_data` Docker volume, outside the app image. Rebuilding the
app preserves the database.

Commands below run **on the VPS**, unless marked otherwise. Examples use
`~/SillyStories`: any checkout location works. `/opt` is only a convention, not a
requirement. Docker manages the database volume separately from the checkout.

## 1. Prepare the VPS

You need working SSH access, Git, OpenSSL, curl, and
[Docker Engine with Compose](https://docs.docker.com/engine/install/ubuntu/).
Your deployment user must be able to run Docker. Build on the VPS to match its
architecture; ARM64 (`aarch64`) is supported. Host Node.js is unnecessary.

Before making the site public:

- Use SSH keys, disable password/root login after testing access, and keep OS
  security updates enabled. Docker access grants root-equivalent privileges.
- Keep the VPS provider's firewall even if using UFW: Docker-published ports can
  bypass UFW. See [Docker's firewall notes](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

Example inbound rules for your VPS provider's firewall:

| Service | Example TCP port | Allowed source |
| --- | --- | --- |
| SSH | `22` | Your administrator IP/VPN |
| HTTP | `80` | Public |
| HTTPS | `443` | Public |

Use your configured SSH port and the web ports in `compose.production.yaml`
(currently the HTTP/HTTPS defaults above). Custom ports must also match server
settings and certificate validation. Keep app/database ports and the Docker API
private.

## 2. Configure the checkout

Clone the repository and select the branch you want to deploy, then:

```sh
cd ~/SillyStories
scripts/setup-production.sh
```

Edit `.env.production`:

- Set `ACME_EMAIL` to your real certificate contact email.
- Keep `DOMAIN=silly-stories.organicdarius.com`, without `https://` or a path.

The domain is runtime configuration; changing it does not require a new image.
Setup creates database passwords in `deploy/secrets/`. These host files and
`.env.production` are private, Git-ignored, and excluded from the image. Preserve
existing passwords: changing a file alone does **not** rotate MongoDB credentials.

Always use `scripts/production.sh` for production Compose commands. Plain
`docker compose` selects the separate, unauthenticated development stack.

## 3. Initialize MongoDB and optionally import data

```sh
scripts/production.sh build --pull app
scripts/production.sh up -d --wait mongodb
```

**Import after MongoDB starts, before the app's first startup.** Starting the app
creates collections even without stories, and the safe restore script then
refuses the database. To start with an empty site, skip the import.

For migration, stop writes at the old provider before the final export and keep
that site in maintenance through DNS cutover. Prepare a gzip `mongodump` archive
of `sillyStories`, compatible with MongoDB 7.0. If the source database has another
name, remap its namespaces first. Keep credentials out of command arguments and
Git; see [MongoDB export tools](https://www.mongodb.com/docs/database-tools/mongodump/).

Transfer the archive privately to the VPS, then restore it:

```sh
chmod 600 /path/to/sillyStories.archive.gz
scripts/restore-db.sh /path/to/sillyStories.archive.gz
```

Keep the source database and export until the migration is verified. Avoid two
writable sites while DNS caches expire.

## 4. Point the domain and start the site

In the `organicdarius.com` DNS zone:

| Type | Name | Value |
| --- | --- | --- |
| A | `silly-stories` | `YOUR_VPS_IPV4` |
| AAAA | `silly-stories` | `YOUR_VPS_IPV6`, only if configured and reachable |

Replace these placeholders with the public IPs assigned by your VPS provider.

Remove stale records pointing to the old host. Use DNS-only mode if your DNS
provider offers proxying; adding a proxy requires reviewing app trust settings.
If you have restrictive CAA records, allow Caddy's certificate authority.

```sh
scripts/production.sh up -d --no-build --wait
scripts/production.sh ps
curl -I http://silly-stories.organicdarius.com
curl --fail https://silly-stories.organicdarius.com/healthz
```

Caddy handles HTTPS certificates and HTTP-to-HTTPS redirects once DNS resolves to
this VPS and its public HTTP/HTTPS ports are reachable. The default certificate
setup expects the standard HTTP/HTTPS ports shown above. `up --wait` checks
container readiness; the HTTPS request verifies public access. Use the domain to visit the site—the
bare IP is not configured to serve it.

Check the pages and compare migrated stories/sentences with the source before
retiring the old host. If the VPS has accepted new writes, reconcile them before
switching back to the old database.

## 5. Back up and restore

Export the current database from any directory:

```sh
~/SillyStories/scripts/backup-db.sh
# Optional destination:
~/SillyStories/scripts/backup-db.sh /secure/backup/location
```

The script briefly stops the app, writes a private compressed archive to
`backups/` by default, and restarts the app even if export fails. Copy archives
**off the VPS**; a volume or backup on the same server cannot survive losing that
server. Backups may contain email addresses, and old archives are not auto-deleted.

For optional daily exports around 03:15 UTC, edit the user and absolute checkout
paths in [the backup service](silly-stories-backup.service), then install its timer:

```sh
cd ~/SillyStories
sudo cp deploy/silly-stories-backup.service deploy/silly-stories-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now silly-stories-backup.timer
```

Restore with `scripts/restore-db.sh /path/to/archive.gz` only into a database with
**no collections**. Test recovery in an isolated stack with separate volumes.
Replacing an existing database requires an off-server backup and a deliberate
maintenance/reset procedure; the helper never clears it automatically. A failed
import leaves the app stopped for inspection. Never delete production volumes
with `down --volumes` or volume pruning.

## Update the app

On your computer, test under Node.js 24 (`npm ci`, `npm test`,
`npm audit --omit=dev`), then commit and push. On the VPS, run from any directory:

```sh
~/SillyStories/scripts/update-production.sh master
```

`master` is the primary branch. Replace it to deploy another branch from `origin`,
or omit the argument to update the current branch from its configured upstream.

The helper requires a running stack and clean checkout. It creates a tracking
branch if needed, refuses updates that would discard local commits, and:

1. Backs up the database and saves the current app image as `silly-stories:rollback`.
2. Updates Git, builds the image, and replaces only the app container.
3. Checks container health and the public HTTPS endpoint.

After its backup, the helper holds the database-operation lock through deployment
and verification. Concurrent backups/restores refuse to run; if another operation
acquires the lock first, retry the update after it finishes.

The helper replaces only the app. After changing `deploy/Caddyfile`, run
`scripts/production.sh restart caddy` separately so the proxy settings take effect.

**No database reimport is needed.** Secrets and database volumes persist. Backup
and replacement each cause a brief interruption. An older checkout needs one
manual `git pull --ff-only` to receive this helper before first use.

## Troubleshooting and maintenance

```sh
cd ~/SillyStories
scripts/production.sh ps
scripts/production.sh logs --tail=100 caddy app
```

A failed build leaves the running app in place. If replacement fails, inspect the
logs; the helper stops without automatic rollback. To recover the saved app image:

```sh
APP_IMAGE=silly-stories:rollback scripts/production.sh up -d --no-deps --no-build --wait app
```

This restores app code only. Verify HTTPS afterward and reconcile the checkout
with the intended release before the next update. Database recovery is separate.

- Keep one app replica; concurrency control and rate limits are process-local.
- Review Compose, Caddy, and MongoDB changes separately from app releases. Patch
  OS/container images and monitor HTTPS, container health, disk space, and backup
  freshness. An unhealthy container does not restart solely due to its health status.
- After a crash, remove stale `.db-operation.lock` or Git's
  `silly-stories-deploy.lock` directory only after confirming no operation is running.
- For prebuilt images, set `APP_IMAGE` in `.env.production`, then use
  `scripts/production.sh pull app` and `scripts/production.sh up -d --no-build --wait`.
  Images must support the VPS architecture; the update helper builds locally.

Compose is the maintained workflow here. Running Node.js, Caddy, and MongoDB under
systemd is also possible but requires managing their installations separately.
