# prodtracker v0.4.5

A minimalist working-time tracker for post-production. Per-project START/STOP
timer, totals that roll up into **work-days** (not 24h), and auto-pause on
inactivity or sleep. Built with Electron, runs on macOS and Windows.

Interface language is English; the on-screen wordmark reads "prod tracker".

## Features

- Multiple productions tracked in parallel; pick one and START/STOP a timer.
- Cumulative time is stored between launches (single local JSON file).
- Work-day totals: set a working-day length (8h / 10h / custom) and see time both
  as raw `HH MM` and as `Jd HH MM` work-days.
- Auto-pause: the timer stops after a configurable idle threshold
  (1/2/5/10/15/30 min) or on sleep/lock, and resumes on activity.
- Recording state is unmistakable: red frame + breathing STOP button while
  running, violet frame + IDLE readout while auto-paused.
- Per-project stats (total / today / week / month, 14-day breakdown), finish and
  delete productions.

## Requirements

- [Node.js](https://nodejs.org) LTS

## Run from source

```
npm install
npm start
```

## Build (from a Mac)

```
./scripts/build-mac.sh            # macOS  -> dist/*.dmg (Apple Silicon / arm64)
./scripts/build-win-from-mac.sh   # Windows -> dist/*.exe (NSIS x64)
```

Icons can be regenerated with `./scripts/make-icon.sh` from `build-resources/icon.png`.

The macOS `.dmg` and Windows `.exe` are unsigned: users will see a Gatekeeper /
SmartScreen warning on first launch (bypassable). Code signing requires paid
certificates.

Both installers embed the GPL: the Windows NSIS installer shows a license page,
and the macOS `.dmg` carries the license as an agreement shown when it is opened
(`build-resources/license_en.txt`). The `LICENSE` is also bundled inside the app.

## Update checks

Same mechanism as the other Just Edit apps (INGESTO, etc.): a `version.json` file
at the root of this repo, read on launch from:

```
https://raw.githubusercontent.com/noar-justedit/prodtracker/main/version.json
```

```json
{
  "prodtracker": { "version": "0.4.5", "url": "https://github.com/noar-justedit/prodtracker/releases" }
}
```

The app compares `prodtracker.version` in that file with its own version. If the
file announces something newer, it shows a notice linking to `url` (the repo's
Releases page). It never blocks startup and fails silently with no network.

**To publish an update:** bump the version in `version.json` on the `main` branch
to match your new release, and publish a matching GitHub Release (tag `v0.4.6`,
`v0.5.0`, etc., with the built `.dmg`/`.exe` attached). Installs on the previous
version will pick up the notice on their next launch. Keep `version.json` in sync
with what you've actually released - bumping it ahead of a real release will
notify users of an update that isn't there yet.

If you fork, change `GITHUB_REPO` and `UPDATE_BRANCH` in `src/main/main.js` to
your own repo, and update your own `version.json` accordingly - or leave
`GITHUB_REPO` empty to disable the check entirely.

## Data location

A single JSON file, kept between launches:

- macOS: `~/Library/Application Support/prodtracker/prodtracker-data.json`
- Windows: `%APPDATA%\prodtracker\prodtracker-data.json`

## Notes

- One timer runs at a time; starting a production stops any other running one.
- Idle detection only runs while the app is open. If you close it mid-session,
  time keeps counting until the next STOP on reopen.
- Builds target macOS arm64 (Apple Silicon). Adjust `electron-builder.yml` for
  Intel/universal if needed.
- The wordmark uses [Poppins](https://fonts.google.com/specimen/Poppins)
  (SIL Open Font License); the font and its OFL are bundled under
  `src/renderer/fonts/`.

## Third-party components

All bundled components use GPL-compatible licenses:

- **Electron** (MIT) — the runtime bundled into the built app. It ships Chromium,
  Node.js and V8 under permissive (BSD/MIT) licenses, and its ffmpeg build is
  LGPL. Electron's own license notices are packaged inside the app.
- **Poppins** (SIL Open Font License 1.1) — bundled with its OFL text under
  `src/renderer/fonts/`. The font is data aggregated with the program, kept under
  OFL and unmodified (its reserved name is preserved).
- **electron-builder** (MIT) — build tooling only; not distributed.

The application's own code is GPL-3.0-or-later. Combining it with the permissive
components above is allowed, and the resulting distributed program is governed by
the GPL while each bundled component keeps its own notice.

## License

GNU General Public License v3.0 or later (GPL-3.0-or-later). See [LICENSE](LICENSE).

This program is free software: you can redistribute it and/or modify it under the
terms of the GNU GPL as published by the Free Software Foundation, either version
3 of the License, or (at your option) any later version. It comes with NO
WARRANTY. See the LICENSE file for the full text.

## Contributing

Issues and pull requests are welcome. Keep changes focused and match the existing
code style. There is no build step for the renderer; it is plain HTML/CSS/JS.
