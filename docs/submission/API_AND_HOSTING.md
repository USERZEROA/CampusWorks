# API configuration and hosting

## Public GitHub experience

The published browser experience is available at https://userzeroa.github.io/campusworks-demo/. Visitors can choose Student, TA, Instructor or Administrator and explore prepared synthetic records. Changes stay in that visitor's browser; they do not change another visitor's data or a shared application database.

This GitHub Pages site does not require an API Key and makes no live AI calls. Its clearly labeled AI examples are saved real OpenAI responses from earlier local tests with synthetic evidence. The public repository contains this browser experience; the full application source remains private.

A private API Key cannot be kept secret in frontend JavaScript, HTML, browser storage or a public GitHub repository. GitHub Pages serves static files and does not provide the application's server or MongoDB. Public live AI would require a separate backend holding the Key in server-side secrets. With GitHub-only hosting, use the existing browser experience and saved examples.

## Enter the OpenAI Key on the presentation computer

Use the complete application checkout and complete the Docker, Node.js and browser setup in [QUICKSTART.md](../QUICKSTART.md). Run this command from that repository root on Windows:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ai-provider-dialog.ps1
```

The masked **CampusWorks API Key** window asks only for the Key. Enter the OpenAI Key and select **Save securely**; the application chooses the provider address and model automatically. The window itself makes no API calls. It encrypts the saved credential for the current Windows account in the ignored `.cache/ai-provider.xml` file. Enter the Key again on a new computer or Windows account.

Check the local configuration, then start one complete presentation with fresh OpenAI responses:

```sh
npm run check:ai
npm run demo:loop -- --cycles 1
```

`check:ai` validates local configuration without contacting OpenAI. The presentation builds the full application, prepares its local database and opens six independent browser identities. Playback takes approximately five minutes, plus preparation, provider response time and any pauses. Omit `--cycles 1` to repeat.

The Key window configures native launchers. For a Docker web application, follow the separate server environment instructions in [QUICKSTART.md](../QUICKSTART.md); the encrypted Windows file is not a container credential. Keep the Key in local ignored configuration or server-side runtime settings, never in the public browser experience.
