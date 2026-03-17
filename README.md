# Automation Demo CLI

This is a small standalone CLI for exercising the wallet automation API from a terminal.

It is aimed at demos and operator workflows, not as a general-purpose SDK.

You can use it to:

- verify an automation token works
- see which wallet party the token resolves to
- inspect holdings in a human-readable way
- query dApp ledger proxy endpoints including `/v2/updates`
- stream events or poll for recent updates
- send DevNet test tokens with local Ed25519 signing

## What You Need

Before using this tool, make sure you already have:

1. A wallet user with CLI automation enabled.
2. An automation token created from the wallet UI.
3. For `send`, the exported Ed25519 private key for the sending party.
4. A running wallet backend, local or remote.

This repo does not bundle the larger wallet runbooks. Token setup and party-key export still happen in the wallet UI.

## Get The Token And Private Key From The Wallet

### 1. Enable CLI automation

Enable the wallet user in the admin UI or through the documented backend/admin flow.

### 2. Create an automation token

In the wallet UI:

1. Sign in.
2. Open `Settings -> Automation API`.
3. Create a token.
4. Choose a profile:
   - `readonly` for read-only commands
   - `submitter` for read commands plus `send`
5. Copy the token when it is shown.

Important notes:

- the plaintext token is shown once
- if you lose it, create a new token and revoke the old one
- store it in your shell env, password manager, or secret manager

### 3. Export the Ed25519 private key for `send`

In the wallet UI:

1. Open `Settings -> Manage Parties`.
2. Select the sending party.
3. Use `Export`.
4. Copy the base64 private key.

The wallet exports the raw 32-byte Ed25519 seed as base64.

Use that exact exported base64 value as `WALLET_PARTY_PRIVATE_KEY` or pass it with `--party-key`.

### Quick summary

Get these values from the wallet UI:

- token: `Settings -> Automation API`
- private key: `Settings -> Manage Parties -> Export`

## Run The CLI

From the repo root:

```bash
npm install
node cli.mjs help
```

If that prints usage, the CLI is runnable.

## Recommended Setup With `.env`

The CLI automatically reads `./.env`.

Use [`.env.example`](/Users/zabirhussain/Projects/canton-wallet-automation-auth-example/.env.example) as a template if you want a starting point. You can also add another file with `--env-file`.

Example `.env`:

```dotenv
WALLET_BASE_URL=https://lat-dn.cddev.site
WALLET_TOKEN=your_automation_token_here
WALLET_PARTY_ID=alice::1220...
WALLET_PARTY_PRIVATE_KEY=base64_exported_private_key_here
```

After that, most commands can be run without repeating long flags.

Flags always override env vars.

Shared flags:

- `--base-url`
- `--token`
- `--party-id`
- `--party-key`
- `--json`
- `--yes`
- `--env-file`

`--party-key` accepts:

- base64 from the wallet export UI
- 64-char hex
- `@/path/to/file`

## First Commands To Run

### Check the active configuration

```bash
node cli.mjs config
```

This shows:

- wallet base URL
- whether a token is configured
- configured or resolved party ID
- whether a party private key is configured
- the last recorded send, if any

### Verify wallet connectivity

```bash
node cli.mjs status
```

Expected output includes:

- provider ID
- network ID
- whether the wallet is connected

### Show the wallet account

```bash
node cli.mjs accounts
```

This prints the active account list and the primary party.

### Show holdings

```bash
node cli.mjs holdings
```

Alias:

```bash
node cli.mjs balance
```

This groups holdings by token and prints a compact balance summary.

Example:

```text
Holdings
Party: z94::1220...
- CantonCoin (CantonCoin): 2681 across 3 contract(s)
- tUSD (TestUSD): 100 across 1 contract(s)
```

## Query Ledger Proxy Endpoints

### Raw allowlisted ledger call

```bash
node cli.mjs ledger-api \
  --method GET \
  --resource /v2/state/ledger-end
```

Other examples:

```bash
node cli.mjs ledger-api \
  --method GET \
  --resource /v2/version
```

```bash
node cli.mjs ledger-api \
  --method POST \
  --resource /v2/state/active-contracts \
  --body-json '{"filter":{"filtersByParty":{"ignored":{"cumulative":[{"identifierFilter":{"InterfaceFilter":{"value":{"interfaceId":"#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding","includeInterfaceView":true,"includeCreatedEventBlob":false}}}}]}}}}'
```

The backend still enforces allowlisting and party scoping.

## Work With Updates

### List recent updates

```bash
node cli.mjs updates --limit 5
```

### Start from a known offset

```bash
node cli.mjs updates \
  --limit 20 \
  --begin-exclusive 814125
```

### Start from the last recorded send

```bash
node cli.mjs updates --since-last-send
```

This uses the most recent send stored in `.automation-demo-state.json`.

### Fetch a single update by ID

```bash
node cli.mjs update-by-id \
  --update-id 1220...
```

Alias:

```bash
node cli.mjs tx 1220...
```

You can also fetch the last recorded send:

```bash
node cli.mjs update-by-id --last-send
```

Example flow after a successful send:

```bash
node cli.mjs send --to-party bob::1220... --amount 1.00
node cli.mjs update-by-id --last-send
```

### Watch for updates

```bash
node cli.mjs watch-updates --interval 3
```

Alias:

```bash
node cli.mjs watch --interval 3
```

### Stream dApp events

```bash
node cli.mjs events
```

Stop with `Ctrl+C`.

## Send A DevNet Test Token

`send` is intentionally narrow. It currently supports these DevNet test tokens:

- `TestBTC`
- `TestUSD`
- `TestUSDy`
- `TestCDC`

It does not send Canton Coin or arbitrary token-standard assets.

### Friendly defaults

The `send` command is designed to be easier to drive from a terminal:

- `--token-id` defaults to `TestUSD`
- if you run in a TTY, the CLI prompts for missing `--to-party`, `--amount`, and `--party-key`
- human-readable output is the default
- use `--json` if you want the raw payload

### Minimal send

```bash
node cli.mjs send \
  --to-party bob::1220... \
  --amount 1.00
```

Because `TestUSD` is the default token, `--token-id` is optional.

### Fully explicit send

```bash
node cli.mjs send \
  --to-party bob::1220... \
  --token-id TestUSD \
  --amount 12.50 \
  --memo "automation demo"
```

### Safe validation modes

Dry run:

```bash
node cli.mjs send \
  --to-party bob::1220... \
  --amount 1.00 \
  --dry-run
```

Prepare and sign, but do not execute:

```bash
node cli.mjs send \
  --to-party bob::1220... \
  --amount 1.00 \
  --prepare-only
```

Execute in a detached background helper and return immediately:

```bash
node cli.mjs send \
  --to-party bob::1220... \
  --amount 1.00 \
  --wait=false
```

### What the command does

When you run `send`, the CLI:

1. Resolves the sender from `--party-id` or the wallet’s primary account.
2. Loads the Ed25519 private key.
3. Verifies the key matches the sender party fingerprint.
4. Reads ledger end through the allowlisted proxy.
5. Fetches holding contracts for the active party.
6. Filters holdings by the requested test token.
7. Selects enough UTXOs to cover the amount.
8. Calls `POST /api/v1/dapp/interactive/prepare`.
9. Signs `preparedTransactionHash` locally.
10. Calls `POST /api/v1/dapp/interactive/execute-and-wait`, unless you used `--dry-run` or `--prepare-only`.

### Success output

Successful sends include:

- sender party
- receiver party
- token
- amount
- selected inputs
- command ID
- update ID
- completion offset

The CLI also records the last successful send locally so you can later use:

- `updates --since-last-send`
- `update-by-id --last-send`

Successful sends are stored in `.automation-demo-state.json`.

## Output Modes

By default, the CLI prints compact human-readable output.

If you want the raw payload instead:

```bash
node cli.mjs config --json
node cli.mjs holdings --json
```

`config --json` and `holdings --json` are the most useful forms for scripting or piping into other tools.

## Security Notes

Keep these constraints in mind:

- a token alone is not enough to send funds
- a private key alone is not enough to access the automation backend
- `readonly` tokens cannot use `send`
- revoking the token blocks backend access immediately
- revoking the token does not invalidate an already exported party key

Treat both the automation token and the exported party key as secrets.

## Troubleshooting

### `401 Unauthorized`

Usually means one of:

- invalid token
- revoked token
- CLI automation disabled for the user
- disabled user account

### `403 Forbidden`

Usually means the token profile is too weak for the attempted action.

For `send`, you need a `submitter` token.

### `supplied private key does not match the signing party`

The key and the party ID do not belong together.

Check:

- `--party-id`
- `WALLET_PARTY_ID`
- the exported key you copied from the wallet

### `no holdings found`

The active party does not currently hold the requested token.

Check:

- `holdings`
- `--token-id`
- the sending party

### `insufficient balance`

The wallet has some holdings for the token, but not enough to cover the requested amount.

Run `holdings` first to confirm what is available.

### `interactive prepare failed`

The backend rejected the submission before signing or execution.

Check:

- the token is `submitter`
- the destination party ID is valid
- the sender party/key pair is correct
- the local wallet backend is healthy

## Validation

Safe validation commands:

```bash
node --check cli.mjs
node cli.mjs help
node cli.mjs config
node cli.mjs status
node cli.mjs accounts
node cli.mjs holdings
node cli.mjs send --dry-run --to-party bob::1220... --amount 1.00
```
