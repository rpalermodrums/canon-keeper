# Playwright Blocker

Date: 2026-02-06

Attempted command:

```bash
/Users/ryanpalermo/.codex/skills/playwright/scripts/playwright_cli.sh --help
```

Observed error:

```text
npm error code ENOTFOUND
npm error syscall getaddrinfo
npm error network request to https://registry.npmjs.org/@playwright%2fmcp failed
reason: getaddrinfo ENOTFOUND registry.npmjs.org
```

Impact:
- `@playwright/mcp` could not be installed in this environment.
- Browser automation, trace, screenshot, and video artifacts from Playwright are blocked.

Fallback performed:
- Executed RPC-driven simulated journey to collect export artifacts and `project.getHistory` snapshot.
