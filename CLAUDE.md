# Word Record: project rules

Layout: `server/` (Express + SQLite, tests in `server/test`), `web/` (React + Vite), `extension/` (Chrome MV3, no build). See README.md for setup.

## Commit per module

- When a module or feature is finished, commit it on its own and push it to `origin` before starting the next one. Don't batch several features into one commit.
- Before committing, run `npm test` and `npm run build`; both must pass.
- Write commit messages as `type(scope): summary`, followed by a short body saying what changed and why (for example `feat(review): ...`, `fix(server): ...`, `docs: ...`).
- When a change affects setup, configuration or user-visible features, update README.md in the same commit.

## Keep the repo publishable

Every commit must leave the repo safe to make public:

- **No secrets:** no API keys, tokens or passwords in code, config or tests. Configuration comes from `WR_*` environment variables (`server/src/config.ts`).
- **No personal data:** no absolute local paths (`/Users/...`), no email addresses and no machine-specific values in tracked files. Resolve paths relative to the repo.
- **No user data:** never commit `data/`, `*.db`, backups or `.env`. Keep them in `.gitignore`.
- **A fresh clone must work:** `npm ci && npm test && npm run build` must pass in a clean clone with nothing extra installed. Dependencies come from the public npm registry only.
- **Dependencies:** `npm audit --omit=dev` should report no high or critical vulnerabilities.

Before pushing, scan what you're adding:

```bash
git diff --cached | grep -nEi "api[_-]?key\s*[:=]\s*['\"][A-Za-z0-9]|sk-[A-Za-z0-9]{20}|ghp_|BEGIN (RSA|OPENSSH)|password\s*[:=]|/Users/"
git diff --cached --name-only | grep -Ei "\.db|^data/|\.env"
```

Both commands should print nothing.
