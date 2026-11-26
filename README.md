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
                       API_BASE_URL=https://trap.you.dev/t/9f2c...        |
                                                                           | GET /t/9f2c...
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
| `envrolled init --trap <url> [--out f] [--count n] [--prefix s] [--label] [--force]` | Writes the decoy file (default `.env.production.bak`) and `.envrolled.json` with the token list. Refuses to overwrite unless `--force`, and refuses real names like `.env`, `.env.local`, `.env.production`. |
| `envrolled serve [options]` | Runs the trap server. |
| `envrolled config` | Prints the resolved configuration and where each value came from. |
| `envrolled --help`, `--version` | Help and version. |

`init` creates URL variables (`API_BASE_URL=<trap>/t/<token>`, `ADMIN_PANEL_URL`, `PAYMENT_WEBHOOK_URL`, ...)
and opaque token variables (`INTERNAL_API_TOKEN=<token>`). Every token is 24 random lowercase hex characters,
unique per variable, so the log tells you which one was used. The generated file is meant to look like a
real backup: it contains **no tool name and no "this is a decoy" comment**. The terminal output and
`.envrolled.json` tell you which values are decoys. If you prefer an honest marker, `--label` adds a neutral
comment line. `--prefix <str>` (1-16 chars) prepends a prefix to every token; pass the same `--prefix` to `serve`
(or `ENVROLLED_PREFIX`, or `TOKEN_PREFIX` on the Worker) so it is recognised in headers and query strings.

The server recognises tokens by shape: anything under `/t/<token>`, plus 24-hex strings (or prefix + 24 hex)
in the query, `Authorization`, `X-API-Key` and `X-Auth-Token`. Recognition only fills the `token` field of the log.
**Every request gets the same `302` to your redirect URL, recognised or not.**
`.envrolled.json` is only a record for you (the server does not need it).

Decoy values are deliberately not shaped like real vendor secrets (no AWS, OpenAI, GitHub, Stripe, Google or JWT
formats, and never 32 or 40 hex characters), so they cannot trigger push protection or vendor auto-revocation.
The URL values do contain your trap's hostname, so a reader can see where they point.

`init` refuses any output name matching `.env` or `.env.*` (compared case-insensitively, so `.ENV`, `.env.prod`,
`.env.example` and `.env.local` are all blocked), unless the name ends in `.bak` or `.decoy`
(like the default `.env.production.bak`). Names that do not start with `.env` are fine.
Running `init` again keeps earlier token lists: `.envrolled.json` holds a `runs` array, one entry per run. A corrupt
state file is never overwritten without `--force`.

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
| `prefix` / `--prefix` | `ENVROLLED_PREFIX` | none | Also recognise tokens with this prefix |

Every request except `/healthz` (and `/stats` when enabled) is logged as one JSON line:
`{"time","ip","method","path","userAgent","token"}`, then answered with `302`. `GET /healthz` returns `ok`.
Requests that exceed Node's header size limit get a `431` from Node itself and are not logged.
`GET /stats` returns `{"total":N,"today":N}`: counts only, no IPs, handy for a public "bots rickrolled" counter.
Counters are rebuilt from the log file on start.

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
