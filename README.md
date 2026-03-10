# Many Paths Feed

A lightweight daily news digest that monitors New Mexico news sources for homelessness-related coverage and sends a curated email once per day. Zero daily intervention. Zero cost.

## How it works

1. GitHub Actions runs the script every morning at 7am MT
2. The script fetches RSS feeds from NM news outlets
3. Articles are filtered against a keyword list (homelessness, shelter, local orgs, etc.)
4. New articles are stored in a SQLite database for deduplication
5. A digest email is sent only if there are new articles -- no email if nothing new

## Configuration

**Add a news source:** Edit `sources.yaml` -- add a `name` and RSS `url`

**Add a keyword:** Edit `keywords.yaml` -- one term per line

**Add a recipient:** Edit `recipients.yaml` -- one email address per line

All config files are plain text. No code changes required.

## One-time setup

Add three secrets to the repo (Settings > Secrets and variables > Actions):

| Secret | Value |
|---|---|
| `GMAIL_USER` | Gmail address to send from |
| `GMAIL_APP_PASSWORD` | Gmail App Password (16-char code, not your login password) |

Recipients are managed in `recipients.yaml` -- no secrets needed.

Then trigger a manual run to verify: Actions tab > Daily NM Homelessness Digest > Run workflow.

## Local usage

```bash
yarn install

# Run a digest (set env vars first)
GMAIL_USER=you@example.com \
GMAIL_APP_PASSWORD=xxxx \
RECIPIENT_EMAIL=you@example.com \
node digest.js

# View all-time source stats
node stats.js
```

## Email format

```
Subject: NM Homelessness News -- Monday, March 10, 2026 (5 articles)

Source New Mexico
  - Headline here
    https://sourcenm.com/...
    keywords: homelessness, shelter

Santa Fe New Mexican
  - Another headline
    https://santafenewmexican.com/...
    keywords: The Life Link

────────────────────────────────────────────────────
5 articles from 2 sources today.
Top sources all time: Source NM (42), KRQE (28)
```
