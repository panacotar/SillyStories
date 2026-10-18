# Hetzner VPS deployment

Use Docker Compose for this app. It runs three containers on one VPS:

```text
Internet -> Caddy :80/:443 -> Node.js :3000 -> MongoDB :27017
            automatic HTTPS   private        private + authenticated
                                              persistent Docker volume
```

The app and MongoDB have **no published host ports**. Only Caddy joins a network
with internet access; the frontend and database networks are internal. The app
runs as a non-root user with a read-only filesystem and no Linux capabilities.
It has request limits, form CSRF protection, input validation, a strict Content
Security Policy, and security headers. Logs rotate to limit disk usage.

The domain is runtime configuration, not baked into the image. Database files
live in `silly-stories_mongodb_data` on the VPS, outside all container images.
Rebuilding or replacing a container preserves that volume. Never run production
`down --volumes` or prune its volumes.

## 1. Prepare the VPS

Suggested starting point: Ubuntu 24.04 LTS, 2 vCPUs and 4 GB RAM, with enough disk
for the database, images, and backups. This is a starting estimate, not a capacity
guarantee. Both x86-64 and ARM64 are supported; MongoDB on x86-64 requires AVX.
Build on the VPS to match its architecture. No host Node.js installation is needed.

Examples below use **placeholder** IP `203.0.113.10`, user `deploy`, and checkout
`/opt/silly-stories`. Substitute your values when the VPS exists.

1. Create the server with your SSH public key. Create a `deploy` user with sudo
   privileges and install its authorized key. Verify key login in a second SSH
   session before changing SSH settings.
2. Attach a **Hetzner Cloud Firewall** with these inbound rules, leaving other
   inbound traffic blocked:

   | Port / protocol | Allowed source |
   | --- | --- |
   | 22 / TCP | Your administrator IPv4 `/32` and IPv6 `/128`, or VPN ranges |
   | 80 / TCP | `0.0.0.0/0` and `::/0` |
   | 443 / TCP | `0.0.0.0/0` and `::/0` |
   | ICMP | Allow as needed for network diagnostics and IPv6 |

   Keep outbound traffic allowed for package updates, image pulls, DNS and ACME.
   Do not open 3000, 27017, or the Docker API. This setup does not publish HTTP/3
   UDP, so no UDP 443 rule is required.
3. Install Docker Engine and its Compose plugin using the
   [official Ubuntu instructions](https://docs.docker.com/engine/install/ubuntu/).
   Allow `deploy` to run Docker, then log out and back in. Membership of the Docker
   group grants root-equivalent access; reserve it for trusted administrators.
4. Apply OS updates and enable security updates:

   ```sh
   sudo apt update
   sudo apt upgrade
   sudo apt install git openssl unattended-upgrades
   sudo dpkg-reconfigure -plow unattended-upgrades
   ```

5. After testing key login, set `PasswordAuthentication no`,
   `KbdInteractiveAuthentication no`, and `PermitRootLogin no` in an early SSH
   drop-in such as `/etc/ssh/sshd_config.d/00-hardening.conf`. Validate with
   `sudo sshd -t`, inspect effective settings with `sudo sshd -T`, and run
   `sudo systemctl reload ssh`. Keep the existing session open while testing.

An optional host firewall can add protection, but **UFW alone is insufficient for
Docker-published ports**: Docker can bypass its rules. Keep the Hetzner firewall
and the restricted Compose port configuration. See
[Docker's firewall notes](https://docs.docker.com/engine/network/packet-filtering-firewalls/)
and [Hetzner Cloud Firewalls](https://docs.hetzner.com/cloud/firewalls/overview/).

## 2. Configure the checkout

Clone this repository into `/opt/silly-stories`, owned by `deploy`, then:

```sh
cd /opt/silly-stories
scripts/setup-production.sh
```

Edit `.env.production` and replace `ACME_EMAIL` with your real certificate contact.
The domain is already `silly-stories.organicdarius.com`. `DOMAIN` must be a bare
hostname, without a scheme, path, or trailing slash. Keep this deployment directly
behind Caddy; adding a CDN/proxy requires reviewing trusted proxy/IP handling.

Setup creates two independent random database passwords in `deploy/secrets/`.
Those files and `.env.production` are ignored by Git and excluded from the image.
Compose mounts only the app password into the app; MongoDB also receives its
administrator password. The app user can read/write only `sillyStories`.

The secrets directory is owner-only (`0700`); individual secret files are readable
inside containers (`0444`) so non-root processes can use them. Local Compose
secrets are **plain files on the host**, not encrypted secret storage. Protect the
VPS account, disk snapshots, and off-server copies accordingly. Setup preserves
existing passwords. Changing a file does not rotate MongoDB users: update the
database credential and the corresponding secret together during maintenance.
Mongo initialization runs only on a new, empty volume.

Use `scripts/production.sh` for every production Compose command. It explicitly
selects `compose.production.yaml` and `.env.production`, leaving the existing
local-development `compose.yaml` separate. Never run the local Compose file on
the VPS: it intentionally uses an unauthenticated development database.

## 3. Migrate existing data, or start empty

Build the app and initialize MongoDB:

```sh
scripts/production.sh build --pull app
scripts/production.sh up -d --wait mongodb
```

If migrating data, **stop writes at the old provider before exporting**. The old
app must remain in maintenance mode through the final export, restore, and DNS
cutover. DNS caches may still send visitors to the old provider after cutover.
For this small app, a maintenance window is simpler than live replication.
MongoDB warns that a dump taken during writes is not a single point-in-time
snapshot; see [mongodump](https://www.mongodb.com/docs/database-tools/mongodump/).

Use MongoDB Database Tools on a trusted computer or at the old provider. Create a
temporary, owner-readable config file using your editor, with this content:

```yaml
uri: "mongodb+srv://SOURCE_USERNAME:SOURCE_PASSWORD@SOURCE_HOST/sillyStories"
```

Use the old provider's actual URI, including required TLS/options, and percent-
encode credentials as needed. Do not commit this file or paste credentials into
shell command arguments. Export the existing database, then copy the archive:

```sh
chmod 600 /secure/path/source-mongodb.yml
mongodump --config=/secure/path/source-mongodb.yml --db=sillyStories \
  --archive=/secure/path/sillyStories.archive.gz --gzip
scp /secure/path/sillyStories.archive.gz deploy@203.0.113.10:/opt/silly-stories/backups/
```

Create the target `backups` directory with `mkdir -m 700 backups` before copying.
Ensure the source dump is compatible with MongoDB 7.0; confirm the source server
version and Database Tools compatibility before migration. This repo retains 7.0
for compatibility with its development setup. Plan version upgrades deliberately.
If the old database has another name, remap its namespaces to `sillyStories.*`
with MongoDB Database Tools before using this restore script.

On the VPS:

```sh
chmod 600 backups/sillyStories.archive.gz
scripts/restore-db.sh backups/sillyStories.archive.gz
```

Restore accepts only an empty `sillyStories` database and preserves the new VPS
database users. Restore **before first app startup**, because Mongoose creates
collections/indexes even without user data. For a new empty site, skip the import.

## 4. Point the domain and start HTTPS

Create/update the DNS records for `silly-stories.organicdarius.com`:

| Type | Name in the `organicdarius.com` zone | Value |
| --- | --- | --- |
| A | `silly-stories` | `203.0.113.10` (replace with VPS IPv4) |
| AAAA | `silly-stories` | Actual VPS IPv6, only if configured and reachable |

Remove stale A/AAAA records pointing to the old provider. For cutover, use DNS-only
mode if your DNS provider offers a proxy. If restrictive CAA records exist, allow
the certificate authority Caddy uses. Lower DNS TTL in advance if possible.

```sh
scripts/production.sh up -d --build --wait
scripts/production.sh ps
scripts/production.sh logs --tail=100 caddy app
curl -I http://silly-stories.organicdarius.com
curl --fail https://silly-stories.organicdarius.com/healthz
```

Caddy requests/renews certificates and redirects HTTP to HTTPS. Public DNS and
reachable ports 80/443 are required; its `/data` volume preserves certificates.
See [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https).
`up --wait` waits for app/database health, not public certificate issuance: verify
the final HTTPS request separately. An arbitrary VPS-IP URL does not serve the app;
the configured domain is the public address.

Check the form and archive manually, compare migrated story/sentence counts with
the source, and run a test backup/restore before retiring the old host. Keep its
database and original export intact for rollback. If new writes have occurred on
the VPS, reconcile them before rolling traffic back to the old database.

## 5. Export and restore

Export all stories and unfinished sentences:

```sh
cd /opt/silly-stories
scripts/backup-db.sh
# Or select a destination directory:
scripts/backup-db.sh /secure/backup/location
```

The script briefly stops a running app, waits for graceful shutdown, exports a
compressed MongoDB archive, then restarts the app even if the dump fails. Caddy
may return 502 during that window. A database-operation lock prevents overlapping
exports/restores. It exports only application data/indexes, not administrator
credentials. Archives are private (`0600`), and failed partial files are removed.

Copy the reported archive off the VPS using `scp`, or automate an **encrypted**
backup to storage outside this VPS. For example, from your computer:

```sh
scp deploy@203.0.113.10:/opt/silly-stories/backups/EXPORTED_FILENAME.archive.gz .
```

Named volumes and backups on the same VPS do not protect against losing the VPS.
Choose an off-server destination, retention policy, and disk-space monitoring
before relying on this deployment. Archives may contain stored email addresses.
The script does not silently delete older backups. VPS snapshots are useful as an
additional layer; application-consistent exports and restore drills remain needed.

Optional daily local exports at 03:15 UTC: edit the supplied systemd service user
and checkout path as needed, then install the units:

```sh
sudo cp deploy/silly-stories-backup.service deploy/silly-stories-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now silly-stories-backup.timer
systemctl list-timers silly-stories-backup.timer
```

For a restore drill, use a separate fresh VPS/Compose project and empty database:

```sh
scripts/production.sh up -d --wait mongodb
scripts/restore-db.sh /secure/path/sillyStories.archive.gz
scripts/production.sh up -d --wait
```

The restore script refuses to overwrite any database with collections. To replace
an existing database, first take and copy off a fresh backup, stop the app, and
deliberately clear the target database yourself during maintenance. The script
provides no automatic destructive reset. A failed import leaves the app stopped
for inspection; do not serve a partially restored database. See
[mongorestore](https://www.mongodb.com/docs/database-tools/mongorestore/).
If an operation is killed with SIGKILL or the host crashes, check containers and
database state before manually removing a stale `.db-operation.lock` directory.

## Updates and operations

```sh
scripts/backup-db.sh
git pull --ff-only
scripts/production.sh pull caddy mongodb
scripts/production.sh build --pull app
scripts/production.sh up -d --wait
```

Keep OS packages and container images patched; rebuilding the app is necessary to
pick up base-image patches. Image tags track supported major/minor families for
patch updates; for immutable releases, record tested image digests and pin them.
Review MongoDB upgrades and compatibility before changing its major version.
Dependency checks: `npm ci && npm test && npm audit --omit=dev` under Node.js 24.
Health checks report failure but Docker does not automatically restart a container
solely because it becomes unhealthy. Monitor external HTTPS availability, container
health, disk/RAM, and backup freshness; restarts handle process exits.

Keep a single app replica: its story-write serialization and rate-limit state are
in memory. Multiple replicas require database-level concurrency coordination and
a shared limiter. Anonymous submissions are rate-limited, but deliberate spam and
content moderation still need operational attention as traffic grows. There are
no admin pages or account passwords in this app. Email delivery remains unimplemented.

An optional registry workflow can build the app with `docker buildx build
--platform linux/amd64,linux/arm64 -t YOUR_REGISTRY/silly-stories:VERSION --push .`.
Set `APP_IMAGE` to that version, run `scripts/production.sh pull app`, and deploy
with `scripts/production.sh up -d --no-build --wait`. Keep credentials in registry
login storage, never the image. This is optional; building directly on the VPS is
the simpler starting workflow.

## Alternatives

Node.js under systemd + host-installed Caddy + host-installed MongoDB is viable,
but you manage Node versions, database packages, process users, filesystem access,
and upgrades separately. Compose keeps those dependencies together and makes a
fresh-server restore easier, so it is the recommended option for this repo.

A managed app platform and managed MongoDB reduce server maintenance and can add
managed backups/availability, at an additional service cost. Keeping everything on
one VPS fits this request, with the tradeoff that one server failure affects both
the app and database. Off-server backups address recovery, not high availability.
