// prodtracker - restore the executable bit on the shell scripts.
// Run automatically by "npm install" (postinstall). GitHub's web upload stores
// files as 0644, so a repo downloaded as a ZIP or uploaded through the browser
// arrives with non-executable scripts and "./scripts/build-mac.sh" fails with
// "permission denied". This puts it back. No-op on Windows.
const fs = require("fs");
const path = require("path");

if (process.platform === "win32") process.exit(0);

const dir = path.join(__dirname);
try {
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".sh")) continue;
    const p = path.join(dir, f);
    const mode = fs.statSync(p).mode & 0o777;
    if (mode !== 0o755) fs.chmodSync(p, 0o755);
  }
} catch (e) {
  // Never break the install over this.
}
