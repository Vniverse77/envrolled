# envrolled

**Plant a decoy `.env`. Whoever uses it gets rickrolled, and you get told.**

Vibe-coded projects leak `.env` files to public GitHub all the time, and bots scrape them within minutes.
`envrolled` generates a believable decoy env file whose values point at **your own trap server**. When a
scraper or attacker tries those values, the trap logs the hit, optionally pings your webhook, and answers
with a `302` to a video. Rick Astley by default, anything you like if you configure it.

One command, self-hostable, no dependencies (Node built-ins only), GPL-3.0-or-later.

## How it works

```
 you                          the internet                       your trap
 ----                         ------------                       ---------
 envrolled init  --->  .env.production.bak  --(leaks / scraped)-->  bot or attacker
                       API_BASE_URL=https://trap.you.dev/v1/9f2c...       |
                                                                           | GET /v1/9f2c...
                                                                           v
                                         envrolled serve:  log JSONL + (webhook) + 302 --> video
```

## Quick start (30 seconds)

```sh
# 1. generate the decoy file (never touches a real .env)
npx envrolled init --trap https://trap.example.com

# 2. run the trap where https://trap.example.com points
npx envrolled serve --port 8787 --log hits.jsonl
```

Put the generated file where scrapers look (a public repo, a forgotten backup path). Do not put real
secrets in it. Check `hits.jsonl` to see who showed up.

## Change the video

The default is `https://www.youtube.com/watch?v=dQw4w9WgXcQ`. Swap it any of these ways:

```sh
npx envrolled serve --redirect https://example.com/my-video      # flag
ENVROLLED_REDIRECT=https://example.com/my-video npx envrolled serve  # env var
echo '{ "redirect": "https://example.com/my-video" }' > envrolled.config.json   # config file
```

The redirect must be an absolute `http(s)` URL. `javascript:`, `data:` and relative URLs are rejected.
The server redirects only to this configured URL, never to anything taken from a request, so it cannot
be used as an open redirect.

## Commands

| Command | What it does |
| --- | --- |
| `envrolled init --trap <url> [--out f] [--count n] [--prefix s] [--path p] [--state f] [--label] [--force]` | Writes the decoy file (default `.env.production.bak`) and a token record (see below). Refuses to overwrite unless `--force`, and refuses real names like `.env`, `.env.local`, `.env.production`. |
| `envrolled serve [options]` | Runs the trap server. |
| `envrolled config` | Prints the resolved configuration and where each value came from. |
| `envrolled --help`, `--version` | Help and version. |

`init` creates URL variables (for example `API_BASE_URL=https://<trap>/v1/<token>`; the path is picked at random per variable from a list such as `/api/v1`, `/admin/session`, `/hooks/payments`, `/internal/api`)
and opaque token variables (`INTERNAL_API_TOKEN=<token>`). Variable names, their order, the URL paths and the header comment are randomised from larger pools on every run, and a few harmless lines (`NODE_ENV`, `PORT`, `LOG_LEVEL`, `APP_NAME`, ...) are mixed in, so there is no constant path, header comment or variable name to filter on. Be honest about the limits: secret values come from a few known shapes (see below), and every URL points at your trap host, so a determined reader can still work out what the file is. `--path /v1` forces one prefix for all URLs; `--count` sets how many decoy variables you get. There is never a `DATABASE_URL`, private key or vendor-format secret. Every token is
unique per variable, so the log tells you which one was used, and takes one of three shapes at random: 24 lowercase hex characters, 32 base64url characters (mixed case and digits), or a UUID-v4-like string. The generated file is meant to look like a
real backup: it contains **no tool name and no "this is a decoy" comment**. The terminal output and
the token record tell you which values are decoys. If you prefer an honest marker, `--label` adds a neutral
comment line. `--prefix <str>` (1-16 chars) prepends a prefix to every token; pass the same `--prefix` to `serve`
(or `ENVROLLED_PREFIX`, or `TOKEN_PREFIX` on the Worker) so it is recognised in headers and query strings.

The server recognises tokens by shape: any of those three shapes (optionally with your prefix) as a whole path segment anywhere in the path, plus the same standing alone in the query, `Authorization`, `X-API-Key` and `X-Auth-Token`. Recognition only fills the `token` field of the log.
**Every request gets the same `302` to your redirect URL, recognised or not.**

**Token record.** `init` saves which token belongs to which variable (and full URLs) to
`$XDG_STATE_HOME/envrolled/state.json` (fallback `~/.local/state/envrolled/state.json`, or
`%LOCALAPPDATA%\envrolled\state.json` on Windows), so it never sits next to the decoy file. Choose another
location with `--state <file>`. Each run is appended; a corrupt file is never overwritten without `--force`.
If a 0.1.0-style `./.envrolled.json` exists and the new file does not, its runs are carried over (the old
file is left for you to delete). The server does not need this file.

Decoy values are deliberately not shaped like real vendor secrets (no AWS, OpenAI, GitHub, Stripe, Google or JWT
formats, and never 32 or 40 hex characters), so they cannot trigger push protection or vendor auto-revocation.
The URL values do contain your trap's hostname, so a reader can see where they point.

`init` refuses any output name matching `.env` or `.env.*` (compared case-insensitively, so `.ENV`, `.env.prod`,
`.env.example` and `.env.local` are all blocked), unless the name ends in `.bak` or `.decoy`
(like the default `.env.production.bak`). Names that do not start with `.env` are fine.
The default output name `.env.production.bak` is kept on purpose: it is a believable leftover backup name and passes the guard above.

## Configuration

Precedence: **flag > environment variable > config file > default.**
The config file is `./envrolled.config.json` (or `--config <file>`), keys use the names in the first column.

| Key / flag | Env var | Default | Meaning |
| --- | --- | --- | --- |
| `port` / `--port` | `ENVROLLED_PORT`, `PORT` | `8787` | Listen port |
| `host` / `--host` | `ENVROLLED_HOST` | `0.0.0.0` | Listen address |
| `redirect` / `--redirect` | `ENVROLLED_REDIRECT` | Rick Astley URL | Where visitors are sent |
| `notify` / `--notify` | `ENVROLLED_NOTIFY` | none | Webhook URL for hit notifications |
| `log` / `--log` | `ENVROLLED_LOG` | none | JSONL hit log file |
| `trustProxy` / `--trust-proxy` | `ENVROLLED_TRUST_PROXY` | `false` | Read client IP from `CF-Connecting-IP` / `X-Forwarded-For` |
| `stats` / `--stats` | `ENVROLLED_STATS` | `false` | Enable `GET /stats` |
| `statsPort` / `--stats-port` | `ENVROLLED_STATS_PORT` | none | Serve `/stats` on a separate port (must differ from `port`) |
| `statsHost` / `--stats-host` | `ENVROLLED_STATS_HOST` | `127.0.0.1` | Address of the stats listener |
| `prefix` / `--prefix` | `ENVROLLED_PREFIX` | none | Also recognise tokens with this prefix |

Every request except `/healthz` (and `/stats` when enabled) is logged as one JSON line:
`{"time","ip","method","path","userAgent","token"}`, then answered with `302`. `GET /healthz` returns `ok`.
Requests that exceed Node's header size limit get a `431` from Node itself and are not logged.
`GET /stats` returns `{"total":N,"today":N}`: counts only, no IPs. Because it lives on the same host as the trap, a visitor can discover it and learn it is a trap: **enable it only behind a separate admin host or port**. `--stats-port <n>` serves `/stats` on its own listener bound to `127.0.0.1` unless you set `--stats-host`, and disables it on the trap port. Reach it through an SSH tunnel or a private network; `--stats-port` may not equal `--port`.
Counters are rebuilt from the log file on start.

### Hostname warning

Your trap's hostname ends up inside the decoy file. A `*.workers.dev` host, or any host containing the tool
name, tells a reader what the file is. Use a believable custom domain (for example `api.yourcompany.dev`).
Do the same for the Worker: `deploy/wrangler.toml` uses a generic example name, change it.

## Notifications

`--notify <url>` sends a JSON `POST` per hit, at most **one per IP per minute** so a bot cannot spam you.
The body contains `text`, `content`, `allowed_mentions` (disabled, so attacker text cannot ping anyone) and a `hit` object.

- **Discord:** use a channel's incoming webhook URL (`https://discord.com/api/webhooks/...`).
- **Slack:** use an incoming webhook URL (`https://hooks.slack.com/services/...`).
- **Telegram:** `https://api.telegram.org/bot<BOT_TOKEN>/sendMessage?chat_id=<CHAT_ID>` works, because the body carries `text`.
- **Anything else:** receive the generic JSON.

Webhook URLs are secrets: prefer the env var over a file you commit.

## Deploy

- **VPS / homelab:** `npx envrolled serve --log /var/log/envrolled.jsonl` under systemd, pm2 or Docker, behind a domain.
- **Behind a reverse proxy (nginx, Caddy, Cloudflare):** add `--trust-proxy` so the real client IP is logged.
  With it, the IP comes from `CF-Connecting-IP`, then `X-Real-IP`, then the rightmost `X-Forwarded-For` entry.
  Your proxy must overwrite these headers rather than pass client-supplied ones through; otherwise anyone can forge their IP in the log.
- **Cloudflare Worker (free, no server):** `deploy/cloudflare-worker.js` plus an example `deploy/wrangler.toml`.
  Set `REDIRECT_URL` (and optionally the `NOTIFY_URL` secret), then `npx wrangler deploy`. Hits go to Workers logs
  (`wrangler tail`). The Worker's rate limit is best-effort per isolate. It is not covered by the test suite;
  it is syntax-checked only.

## What it does NOT do

- It is not a secret manager and it protects nothing. **If a real key leaked, rotate it anyway.**
- It does not detect leaks by itself; it only tells you when someone uses the decoy.
- It does not hack back, serve code, fingerprint browsers or try to identify anyone. It sees what any HTTP
  server sees (IP, user agent, path, time), logs that, and redirects.

## Ethics and legal

IP addresses are personal data in many jurisdictions. You are responsible for complying with the privacy law
where you live (retention, notice, GDPR-style rules). Keep logs only as long as you need them. Use the
decoys only on systems and repositories you own.

## Prior art

This idea is not new, and the existing tools are more capable:

- [Thinkst Canarytokens](https://canarytokens.org): the original, many token types, hosted or self-hosted.
- [GitGuardian Honeytoken](https://www.gitguardian.com): honeytokens integrated into a secrets-detection product.
- Deadfall: honeytokens aimed at leaked credentials.

`envrolled` differs by being one command, meme-flavoured, self-hostable, with a user-configurable video
and zero dependencies. If you need serious alerting, use the tools above.

## Contributing

Issues and pull requests are welcome at https://github.com/Vniverse77/envrolled. Run `npm test`
(`node --test`, no dependencies). Keep the zero-dependency rule, and keep the tool log-and-redirect only.

## License

GPL-3.0-or-later. See [LICENSE](LICENSE).
