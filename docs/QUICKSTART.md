# Run CampusWorks on a new computer

Choose the web application for normal use, or the six-window presentation for an automatic product walkthrough. Both start from the tracked source and lockfile. Build output, dependencies, browser binaries, databases and credentials are created locally; do not copy another computer's `.cache`, `.output`, `node_modules` or `.env`.

## Get the source

Install Git and Docker with the Compose plugin, then start Docker in Linux-container mode. The first installation needs internet access to download packages, browser binaries and container images.

If the repository is private, authenticate Git with a GitHub account that has access before cloning. Git Credential Manager or an installed GitHub CLI can handle that sign-in.

```sh
git clone https://github.com/USERZEROA/CampusWorks.git
cd CampusWorks
```

## Open the web application

This path needs Docker and Compose. A host Node.js installation and Playwright browsers are not required.

```sh
docker compose up --build -d
docker compose ps
```

Open <http://localhost:3000>. Wait for MongoDB initialization and application readiness on the first launch. No `.env` file is needed for this local demonstration: Compose supplies the local database and session settings and enables the synthetic course accounts.

| Account | Role |
| --- | --- |
| `student@example.com` | Student |
| `ta@example.com` | TA in CS101 |
| `instructor@example.com` | Instructor |
| `admin@example.com` | Administrator |

Stop with `docker compose down`. Named database volumes remain available for the next launch. Do not add `-v` unless you intend to erase that Compose project's local data.

For application logs, run `docker compose logs --tail 100 campusworks`. If port 3000 or 27017 is already occupied, stop the application that owns it before starting this path.

## Play the five-minute, six-window demonstration

This path also needs a graphical desktop, Node.js and the bundled Playwright browsers. Use a Node version matching `package.json`: Node 22.21+ within the 22 series, 24.11+ within the 24 series, or 26+. `.nvmrc` selects the 22 series.

The presentation starts its own Compose project and generated demonstration database, with a free loopback MongoDB port assigned by Docker. The ordinary web application can remain running. Set `DEMO_MONGO_PORT` in the environment or private `.env` only when a fixed demonstration database port is needed.

```sh
npm ci
npx playwright install chromium firefox
```

On a Linux desktop supported by Playwright, install browser system dependencies with `npx playwright install --with-deps chromium firefox` instead. Visible presentation windows require a working graphical session. Native foreground/maximization verification uses the Windows helper; other desktop platforms do not provide that same verification.

Configure the OpenAI Key on this computer using one of the following options.

**Windows Key window:**

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai-provider-dialog.ps1
```

Enter only the Key and save. Windows protects it for the current account in ignored `.cache/ai-provider.xml`. A saved file from another machine or account cannot replace this step.

**Environment or local file:**

On any platform, supply `AI_API_KEY` in the environment or create an ignored `.env` file in the repository root with a text editor:

```dotenv
AI_API_KEY=YOUR_OPENAI_API_KEY
```

The native AI launchers use the OpenAI address and model automatically. No URL needs to be entered. Never commit the populated file or put the Key in a command argument.

```sh
npm run check:ai
npm run demo:loop -- --cycles 1
```

`check:ai` checks local configuration without contacting the provider. The presentation then builds the application, prepares synthetic records, opens six independent browser identities and obtains fresh OpenAI responses. Initial preparation is separate from the approximately five-minute playback cycle. API latency, preserved reading intervals and manual pauses can make the wall-clock duration longer.

The banner identifies the active role and step. Pause/Resume is one toggle; Space and Pause/Break also control playback. Left/right arrows inspect previously visited pages while paused, without replaying business actions. Resume returns to the automation page. Close a presentation window or use Stop demo to stop its owned resources. See [automatic presentation controls](AUTOMATED_DEMO.md).

Omit `--cycles 1` to repeat. Request, token and concurrency limits remain active across rounds and relaunches; a provider failure is not replaced by a saved answer. An explicit local check without AI is available with `npm run demo:loop -- --without-ai --cycles 1`.

## Enable AI in the Docker web application

The Windows Key window configures native launchers, not containers. For Docker, put the Key in the repository's ignored `.env` file:

```dotenv
AI_API_KEY=YOUR_OPENAI_API_KEY
```

Compose supplies the OpenAI address and model defaults. AI remains disabled when no Key is supplied.

```sh
docker compose up --build -d
```

AI is optional for manual application, appointment and queue workflows. Valid provider credentials, account access and network connectivity are required for live AI results. Missing configuration is not a successful provider check.

## Develop and run local checks

For manual development, install the Node version listed above and run `npm ci` once. Copy `.env.example` to `.env`, fill `SESSION_SECRET` with a generated value and choose whether to seed synthetic courses. Set `SEED_DEMO_DATA=true` for a populated local demonstration; the example defaults it to false. The automated presentation above creates its own session secret and synthetic data.

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
docker compose up -d mongo-init
npm run dev
```

Run these from the repository root after `npm ci`:

```sh
npm run test:unit
npm run typecheck
npm run build
npm run verify:local
```

The full local runner requires Docker and installed Chromium/Firefox browsers. It creates its own isolated database and two application instances; it does not require a provider Key. Run `node scripts/check-demo-presenter.mjs --headed` for the separate presenter-control check without a database or provider call. [Recorded validation and its limits](VERIFICATION.md) distinguish application checks, presentation checks, real provider results and the environments actually exercised.
