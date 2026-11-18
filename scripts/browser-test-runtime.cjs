// Optional browser override shared by the full-suite launcher. No game code or
// assertions are changed; standalone scripts can retain their default channel.
const channel = process.env.VERIFY_BROWSER;
if (channel) {
  const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'C:/Users/Utilisateur/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const launch = chromium.launch.bind(chromium);
  chromium.launch = options => launch({ ...options, channel });
}
