# MY DAILY PAPER V2 — Local-first implementation (development branch)

## Goals
- Keep personalized interests, feed URL lists, article history, bookmarks and snapshots on the device.
- No personal feed data or user interests are written to GitHub or GitHub Pages.
- The existing GitHub Actions / \`news.json\` workflow is **not used by V2**.
- Add blank, editable newspaper profiles and direct RSS / Atom parsing, plus per-source error isolation.
- Keep current \`main\` implementation unchanged while V2 is reviewed.

## Preview
Open \`reader.html\` on a static HTTPS host to try the interface. The browser version only fetches feeds with a compatible CORS policy. In a native Android wrapper, the built-in CapacitorHttp patch routes `fetch` via the device HTTP stack.

## Android (planned wrapper)
This development version includes a Capacitor configuration and scripts. It is **not a built or tested APK**. Validate the Capacitor dependencies in a Node environment and the built-in CapacitorHttp native `fetch` patch (`plugins.CapacitorHttp.enabled=true`). This avoids importing a non-existent separate `@capacitor/http` package. Android builds require Android SDK and Android Studio. iOS builds require macOS with Xcode. The same built-in CapacitorHttp native fetch patch can be used on both targets.

The repository does not contain local feeds or any MIOLAB-specific keywords: make those settings on-device in the Settings dialog.

## Local checks

Run `npm test` for built-in Node checks and `npm run build` to stage the web assets. A passing static check does not prove browser or native-device runtime behavior.

## Features implemented in V2 source
- Multiple on-device newspaper profiles
- RSS / Atom fetch and parse, keyword filtering and source categories
- Per-source error reporting, preservation of existing articles during failures
- Local IndexedDB article storage with reading-list flags
- Local day snapshots / issue archive
- Manual JSON export and import
- A4 print styling
- Refresh on app open when last run is older than six hours; no background scheduling promises

## Important limitations
- Browser/PWA CORS rules mean many RSS feeds cannot be fetched directly. No public proxy is bundled.
- Native Android requests and installed app behavior require device testing.
- No guaranteed background fetch when the app is closed.
- Settings are tied to the device/browser profile. Clearing app data can remove articles; export backups periodically.
- Important: Never place private feeds, API keys or user preferences in source, workflow files or public commits.
- V2 is under review on a separate branch; legacy pages and \`news.json\` remain in the repository history and current main until a deliberate migration.
