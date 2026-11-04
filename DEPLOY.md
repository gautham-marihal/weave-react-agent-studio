# Deploying Weave Studio with Docker

For whoever puts the studio on a server (an AWS EC2 instance, say). Everything runs from this folder with Docker
Compose; nothing is installed on the server but Docker.

## What it needs

- A Linux server with **Docker** and the **Docker Compose plugin** (`docker compose version` answers). 2 GB of memory
  and 10 GB of disk are plenty.
- The server can reach the **Agent Builder API** (`http://16.79.174.151:8100`) and, for Integrations › Test, the bank
  database (`:3322`) and `https://weave-mock-api.vercel.app`.
- The Agent Builder **API key**.

## 1. Copy the folder and fill in the settings

Copy this folder to the server (git clone, scp or rsync; `node_modules` is not needed). Then:

```sh
cp .env.docker.example .env.docker
nano .env.docker          # the Agent Builder address and key, and the rest as the file says
```

`.env.docker` holds the secrets: it stays on the server, is read when the container starts, and is never built into
the image or sent to the browser.

**Who may sign in** is in `credentials.txt`: one person per line, the email, a space, then the password (lines
starting with `#` are ignored). It starts with `demo_weave@tetherfi.com`. The studio's sign-in page checks what is
typed against this file on the server; the browser never gets the file. Edit it on the server and the next sign-in
uses it, no restart needed (docker-compose.yml mounts it into the container).

## 2. Start it

**The quick way: the run scripts.** They check the settings and `credentials.txt` first (and say what is missing),
build, start, wait until the studio answers, and print its address. The same commands on both systems:

| On Linux or a Mac        | On Windows (Docker Desktop) | Does                                                                    |
| ------------------------ | --------------------------- | ----------------------------------------------------------------------- |
| `./run.sh start`         | `.\run.cmd start`           | build and start (private, option A below)                               |
| `./run.sh start --https` | `.\run.cmd start -Https`    | the same with HTTPS and a password (option B below)                     |
| `./run.sh stop`          | `.\run.cmd stop`            | stop everything this folder started                                     |
| `./run.sh status`        | `.\run.cmd status`          | what is running, and whether the studio is healthy                      |
| `./run.sh logs`          | `.\run.cmd logs`            | follow the logs                                                         |
| `./run.sh export`        | `.\run.cmd export`          | build, then save every image to `docker-images/weave-studio-images.tar` |
| `./run.sh import`        | `.\run.cmd import`          | on another computer: load that file and start, building nothing         |

`--demo` / `-Demo` and `--mock` / `-Mock` add the extras below. If `./run.sh` says permission denied (a copy from
Windows loses the executable bit), run `bash run.sh start`. The images are Linux images; on Windows, Docker Desktop runs them in its Linux VM.

**Moving it without building.** `export` saves every image the folder uses (Caddy too, so it also works offline) into one file, `docker-images/weave-studio-images.tar`. Copy the folder with that file to the other computer (the source code is not needed: `docker-compose.yml`, `Caddyfile`, the scripts, `.env.docker`, `credentials.txt` and that file are enough), fill in `.env.docker`, then run `import`. It takes under a minute, and afterwards the project shows up in Docker Desktop's Containers list, where it can be started and stopped too. Export again after changing the code.

**Windows containers (a Windows Server host).** For a Windows host whose Docker runs Windows containers (Windows
Server 2022, or Windows 11 Pro/Enterprise switched to Windows containers), there are separate, lightweight Windows
images: Nano Server, Windows' smallest image, with only `node.exe` (or `caddy.exe`) added. Each is about 150 MB to
download, and they share the Nano Server part. They are built on a Linux engine and moved as files:

1. On a computer with a Linux engine (Docker Desktop in its usual mode, or a Linux server): `./run.sh export-windows`
   (or `.\run.cmd export-windows`) builds them into `docker-images/windows/`. `WINDOWS_VERSION=ltsc2025` in `.env.docker`
   makes them for Windows Server 2025 (the default is `ltsc2022`).
2. Copy the folder with `docker-images\windows` to the Windows host. The source code is not needed: `docker-compose.windows.yml`, `Caddyfile`, `.env.docker` and `credentials.txt` and the
   scripts are enough.
3. On the Windows host: `.\run.cmd import`. The script sees that Docker runs Windows containers and uses
   `docker-compose.windows.yml` for every command (`start`, `stop`, `status`, `logs`).

The Windows images were checked where they were built: every library `node.exe`, `caddy.exe` and the image tool need
is in Nano Server, and each image holds the files it should. Their first run on a Windows host is their first real
run, as a Windows 11 Home computer cannot run Windows containers.

**On Windows without Docker Desktop.** The images are Linux images, so Windows needs a Linux to run them. WSL 2 gives
one, free, on every edition of Windows 10 and 11 (Home too). Once:

1. In PowerShell as administrator: `wsl --install` (it installs Ubuntu), restart, then open **Ubuntu** and choose a
   user name and password.
2. In the Ubuntu window: `curl -fsSL https://get.docker.com | sudo sh`, then `sudo usermod -aG docker $USER`.
3. In PowerShell: `wsl --shutdown`, then open Ubuntu again. `docker run --rm hello-world` there prints "Hello from
   Docker!".

Then `.\run.cmd start` works as before: when Docker Desktop isn't running, it hands the command to `run.sh` inside
WSL, in this same folder, and the addresses open in the Windows browser as usual. With both installed, set
`RUN_DOCKER=wsl` or `RUN_DOCKER=windows` to choose (`$env:RUN_DOCKER='wsl'` in PowerShell).

Or by hand: choose one of the two ways people reach it.

**A. Private (recommended).** The studio listens on the server only (`127.0.0.1:5173`); people reach it through an
SSH tunnel, so nobody else can, and no port is opened:

```sh
docker compose up --build -d
# on your own computer:
ssh -L 5173:localhost:5173 ec2-user@<server>      # then open http://localhost:5173
```

**B. On the internet, with HTTPS and a password.** Point a domain at the server, open ports **80 and 443** in its
security group (nothing else), and set `STUDIO_DOMAIN`, `STUDIO_USER` and `STUDIO_PASSWORD_HASH` in `.env.docker`:

```sh
docker run --rm caddy:2.8-alpine caddy hash-password --plaintext 'the password'
# put the hash in .env.docker with every $ written as $$
docker compose --profile https up --build -d     # https://STUDIO_DOMAIN
```

Caddy gets and renews the certificate itself. The person who signs in is passed to the API as `X-User`, so it records
who saved, published and deployed.

**Why not just open port 5173:** anyone who can open the studio can change and publish every agent with the key the
studio holds. Keep it private, or behind the password (B), or behind your company sign-in (docs/PRODUCTION.md).

Optional extras on the same server:

```sh
docker compose --profile demo up --build -d     # the demo studio (sample data, no key) on 127.0.0.1:8090
docker compose --profile mock up --build -d     # the mock bank services on 127.0.0.1:4400
```

## 3. Check it

```sh
docker compose ps                     # studio: Up (healthy)
curl -s localhost:5173/healthz        # {"ok":true}
docker compose logs studio | tail     # "… API http://16.79.174.151:8100 · key set"
```

In the studio, the Agents page lists the agents from the Agent Builder.

## Updating and stopping

```sh
git pull                              # or copy the new files over
docker compose up --build -d          # rebuilds what changed and restarts
docker compose down                   # stops it (settings and certificates are kept)
```

## The connections the agents use

The agents already have them on the Agent Builder server: the bank database (`crm`) and the mock bank services
(`custom`, "Mock Bank Service"). Nothing has to be set for them to work. If you open **Integrations** to see or manage
them, connect with exactly these values, because the first save writes them into every agent's draft:

| Card                                        | Address                             | Header                |
| ------------------------------------------- | ----------------------------------- | --------------------- |
| REST API (the bank database)                | `http://16.79.174.151:3322`         | `Region: DB2`         |
| Custom integration (the mock bank services) | `https://weave-mock-api.vercel.app` | `x-refusals: in-body` |

Never press **Disconnect** on these cards, or switch one of the banking agents off under **Choose agents**: that takes
the connection and every tool using it off the agents' drafts. Changes there reach the live agents only once published.

## When tabui runs on the same server

Both projects' HTTPS fronts want ports 80 and 443, and only one can have them. Run the studio private (A) and tabui
with HTTPS; or give them separate servers.
