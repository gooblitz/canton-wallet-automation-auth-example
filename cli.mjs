#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { ed25519 } from "@noble/curves/ed25519.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_NETWORK = "devnet";
const DEFAULT_ENV_FILES = [
  path.join(process.cwd(), ".env"),
  path.join(__dirname, ".env"),
];
const STATE_FILE = path.join(__dirname, ".automation-demo-state.json");

const HOLDING_INTERFACE_ID =
  "#splice-api-token-holding-v1:Splice.Api.Token.HoldingV1:Holding";
const TRANSFER_FACTORY_INTERFACE_ID =
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory";
const TEST_TOKEN_ADMIN_PARTY =
  "canton-wallet-test::1220ea3780456f0a3b1a516408adb6c7e70190448f41ded2fcf1c51f69f51796b231";
const TEST_TOKEN_TRANSFER_FACTORY_CID =
  "00df707153b4f591ffedaac97f0be73ac25274f2a565b1c5c42940c62fa26e3273ca121220d8403661d2fe30369de39a8b42504a259d05a5f80082913f647f009672ce4ecb";
const TEST_TOKEN_TRANSFER_FACTORY_BLOB =
  "CgMyLjESrQMKRQDfcHFTtPWR/+2qyX8L5zrCUnTypWWxxcQpQMYvom4yc8oSEiDYQDZh0v4wNp3jmotCUEolnQWl+ACCkT9kfwCWcs5OyxIKdGVzdC10b2tlbhpnCkAxOTNhNDMxMGI4ODUwYjEyZTIwMmVlMmE0ZTY1Y2E1NWE3YzM3MmU0YjAyZDBiZDM4Yzc0MDk3ZTgxZGI3NTAwEglUZXN0VG9rZW4aGFRlc3RUb2tlblRyYW5zZmVyRmFjdG9yeSJgal4KXApaOlhjYW50b24td2FsbGV0LXRlc3Q6OjEyMjBlYTM3ODA0NTZmMGEzYjFhNTE2NDA4YWRiNmM3ZTcwMTkwNDQ4ZjQxZGVkMmZjZjFjNTFmNjlmNTE3OTZiMjMxKlhjYW50b24td2FsbGV0LXRlc3Q6OjEyMjBlYTM3ODA0NTZmMGEzYjFhNTE2NDA4YWRiNmM3ZTcwMTkwNDQ4ZjQxZGVkMmZjZjFjNTFmNjlmNTE3OTZiMjMxOWl8CPD8RQYAQioKJgokCAESIC5QQpMzccxIWXqrmCawhGxbFjH2pex+ho0+d8hq72+wEB4=";
const TEST_TOKEN_TRANSFER_FACTORY_TEMPLATE_ID =
  "193a4310b8850b12e202ee2a4e65ca55a7c372e4b02d0bd38c74097e81db7500:TestToken:TestTokenTransferFactory";

const DEVNET_TEST_TOKENS = {
  TestBTC: { symbol: "tBTC", decimals: 8, name: "Test Bitcoin" },
  TestUSD: { symbol: "tUSD", decimals: 2, name: "Test USD" },
  TestUSDy: { symbol: "tUSDy", decimals: 6, name: "Test USD Yield" },
  TestCDC: { symbol: "tCDC", decimals: 10, name: "Test CDC Token" },
};

const NETWORKS = {
  devnet: {
    name: "devnet",
    displayName: "DevNet",
    walletUrl: "https://lat-dn.cddev.site",
    registryUrl: "",
    assets: {},
  },
  testnet: {
    name: "testnet",
    displayName: "Canton TestNet",
    walletUrl: "https://lat-tn.cddev.site",
    registryUrl:
      "https://api.utilities.digitalasset-staging.com/api/token-standard/v0",
    assets: {
      USDCx: {
        tokenId: "USDCx",
        symbol: "USDCx",
        name: "USDCx",
        decimals: 10,
        instrument: {
          admin:
            "decentralized-usdc-interchain-rep::122049e2af8a725bd19759320fc83c638e7718973eac189d8f201309c512d1ffec61",
          id: "USDCx",
        },
        transferFactorySource: "utilities",
      },
    },
  },
};

await main();

async function main() {
  const parsed = parseArgv(process.argv.slice(2));
  await loadEnvFiles(parsed.options);

  const command = normalizeCommand(parsed.command);
  const options = parsed.options;
  const positionals = parsed.positionals;
  const ui = createUI(options);

  try {
    switch (command) {
      case "":
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return;
      case "__execute-prepared":
        await runBackgroundExecute(positionals, options);
        return;
    }

    const config = getConfig(options);
    switch (command) {
      case "status":
        await runStatus(config, ui);
        return;
      case "accounts":
        await runAccounts(config, ui);
        return;
      case "config":
        await runConfig(config, ui);
        return;
      case "holdings":
        await runHoldings(config, ui);
        return;
      case "ledger-api":
        await runLedgerApi(config, options, ui);
        return;
      case "updates":
        await runUpdates(config, options, ui);
        return;
      case "update-by-id":
        await runUpdateById(config, options, positionals, ui);
        return;
      case "watch-updates":
        await runWatchUpdates(config, options, ui);
        return;
      case "events":
        await runEvents(config, ui);
        return;
      case "send":
        await runSend(config, options, positionals, ui);
        return;
      default:
        throw new Error(`Unknown command: ${command}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  }
}

function normalizeCommand(command) {
  switch (command) {
    case "balance":
      return "holdings";
    case "tx":
      return "update-by-id";
    case "watch":
      return "watch-updates";
    default:
      return command;
  }
}

function printHelp() {
  console.log(`Automation Demo CLI

Usage:
  node cli.mjs <command> [options]

Global options:
  --base-url <url>         Wallet base URL. Env: WALLET_BASE_URL
                           Network env: WALLET_TESTNET_BASE_URL, WALLET_DEVNET_BASE_URL
  --network <network>      Network config: devnet, testnet. Env: WALLET_NETWORK
  --token <token>          Automation token. Env: WALLET_TOKEN
  --party-id <party>       Signing party. Env: WALLET_PARTY_ID
  --party-key <key>        Exported Ed25519 private key. Env: WALLET_PARTY_PRIVATE_KEY
  --registry-url <url>     Token-standard registry URL. Env: WALLET_REGISTRY_URL
                           Network env: WALLET_TESTNET_REGISTRY_URL, WALLET_DEVNET_REGISTRY_URL
  --utilities-url <url>    Alias for --registry-url. Env: WALLET_UTILITIES_URL
  --env-file <path>        Extra .env file to load
  --json                   Print raw JSON output
  --yes                    Skip interactive confirmation prompts

User-friendly commands:
  status                   Show wallet/provider/network status
  accounts                 Show wallet accounts and primary party
  config                   Show active config and resolved wallet party
  holdings                 Show holdings grouped by token
  balance                  Alias for holdings
  updates                  List recent updates for the active party
  update-by-id             Fetch a single update by ID
  tx                       Alias for update-by-id
  watch-updates            Poll updates continuously
  watch                    Alias for watch-updates
  events                   Stream SSE dApp events
  send                     Send a DevNet test token or TestNet USDCx
  ledger-api               Raw allowlisted ledger proxy call

Common examples:
  node cli.mjs config
  node cli.mjs holdings
  node cli.mjs updates --limit 5
  node cli.mjs watch --interval 3
  node cli.mjs send --to-party bob::1220... --amount 1.00
  node cli.mjs send --dry-run

Notes:
  - send defaults to TestUSD on devnet if --token-id is omitted
  - send defaults to USDCx on testnet if --token-id is omitted
  - missing send inputs are prompted for interactively when running in a TTY
  - send --prepare-only prepares and signs but does not execute
  - send --wait=false executes in a detached background process and returns immediately
`);
}

async function loadEnvFiles(options) {
  const candidates = [];
  const extraEnvFile = getOption(options, "env-file", "");
  if (extraEnvFile) {
    candidates.push(path.resolve(process.cwd(), extraEnvFile));
  }
  candidates.push(...DEFAULT_ENV_FILES);

  for (const file of uniqueStrings(candidates)) {
    if (!(await fileExists(file))) continue;
    const content = await readFile(file, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator === -1) continue;
      const key = trimmed.slice(0, separator).trim();
      let value = trimmed.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  }
}

function getConfig(options) {
  const network = normalizeNetworkName(
    getOption(
      options,
      "network",
      process.env.WALLET_NETWORK ?? DEFAULT_NETWORK,
    ),
  );
  const networkConfig = getNetworkConfig(network);
  const baseUrl = resolveNetworkUrl({
    options,
    optionKey: "base-url",
    network,
    networkConfig,
    configKey: "walletUrl",
    envSuffix: "BASE_URL",
    globalEnvKeys: ["WALLET_BASE_URL"],
  });
  const registryUrl = resolveNetworkUrl({
    options,
    optionKey: "registry-url",
    aliasOptionKey: "utilities-url",
    network,
    networkConfig,
    configKey: "registryUrl",
    envSuffix: "REGISTRY_URL",
    aliasEnvSuffix: "UTILITIES_URL",
    globalEnvKeys: ["WALLET_REGISTRY_URL", "WALLET_UTILITIES_URL"],
  });
  return {
    baseUrl,
    network,
    networkConfig,
    utilitiesUrl: registryUrl,
    registryUrl,
    token: getOption(options, "token", process.env.WALLET_TOKEN ?? ""),
    partyId: getOption(options, "party-id", process.env.WALLET_PARTY_ID ?? ""),
    partyKey: getOption(
      options,
      "party-key",
      process.env.WALLET_PARTY_PRIVATE_KEY ?? "",
    ),
  };
}

function createUI(options) {
  return {
    json: hasFlag(options, "json"),
    yes: hasFlag(options, "yes"),
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  };
}

async function runStatus(config, ui) {
  requireBase(config);
  const result = await jsonRpc(config, "status");
  output(ui, result, () => {
    console.log("Status");
    console.log(`Provider: ${result?.provider?.id ?? "unknown"}`);
    console.log(`Network: ${result?.network?.networkId ?? "unknown"}`);
    console.log(`Connected: ${result?.isConnected ? "yes" : "no"}`);
    console.log(
      `Network healthy: ${result?.isNetworkConnected ? "yes" : "no"}`,
    );
    if (result?.session?.id) {
      console.log(`Session ID: ${result.session.id}`);
    }
  });
}

async function runAccounts(config, ui) {
  requireBase(config);
  requireToken(config);
  const [accounts, primary] = await Promise.all([
    jsonRpc(config, "listAccounts"),
    jsonRpc(config, "getPrimaryAccount"),
  ]);
  output(ui, { accounts, primary }, () => {
    console.log("Accounts");
    for (const account of accounts ?? []) {
      const primaryMark = account.primary ? "*" : "-";
      console.log(
        `${primaryMark} ${account.partyId} (${account.networkId ?? "unknown"}, ${account.status ?? "unknown"})`,
      );
    }
    if (primary?.publicKey) {
      console.log(`Primary public key: ${primary.publicKey}`);
    }
  });
}

async function runConfig(config, ui) {
  requireBase(config);

  let primary = null;
  if (config.token) {
    try {
      primary = await jsonRpc(config, "getPrimaryAccount");
    } catch {
      primary = null;
    }
  }

  const state = await readState();
  const payload = {
    baseUrl: config.baseUrl,
    network: config.network,
    registryUrl: config.registryUrl || null,
    tokenConfigured: Boolean(config.token),
    tokenPreview: config.token ? `${config.token.slice(0, 12)}...` : null,
    partyIdConfigured: config.partyId || null,
    partyKeyConfigured: Boolean(config.partyKey),
    resolvedPrimaryParty: primary?.partyId ?? null,
    lastSend: state.lastSend ?? null,
  };

  output(ui, payload, () => {
    console.log("Config");
    console.log(`Base URL: ${payload.baseUrl || "(missing)"}`);
    console.log(`Network: ${payload.network}`);
    if (payload.registryUrl)
      console.log(`Registry URL: ${payload.registryUrl}`);
    console.log(
      `Token: ${payload.tokenConfigured ? payload.tokenPreview : "(missing)"}`,
    );
    console.log(
      `Party ID: ${payload.partyIdConfigured ?? payload.resolvedPrimaryParty ?? "(not set)"}`,
    );
    console.log(
      `Party key: ${payload.partyKeyConfigured ? "configured" : "(missing)"}`,
    );
    if (payload.lastSend?.updateId) {
      console.log(`Last send update ID: ${payload.lastSend.updateId}`);
    }
  });
}

async function runHoldings(config, ui) {
  requireBase(config);
  requireToken(config);

  const primary = await jsonRpc(config, "getPrimaryAccount");
  const ledgerEnd = await dappLedgerApi(config, {
    requestMethod: "GET",
    resource: "/v2/state/ledger-end",
  });
  const holdings = await fetchHoldings(config, ledgerEnd?.offset);
  const summary = summarizeHoldings(holdings);

  output(ui, { partyId: primary?.partyId ?? null, holdings, summary }, () => {
    console.log("Holdings");
    console.log(`Party: ${primary?.partyId ?? "unknown"}`);
    if (summary.length === 0) {
      console.log("No holdings found.");
      return;
    }
    for (const item of summary) {
      console.log(
        `- ${item.symbol} (${item.tokenId}): ${item.total} across ${item.contractCount} contract(s)`,
      );
    }
  });
}

async function runLedgerApi(config, options, ui) {
  requireBase(config);
  requireToken(config);

  const method = getOption(options, "method", "GET").toUpperCase();
  const resource = getOption(options, "resource", "/v2/version");
  const bodyValue = await getOptionalBody(options);
  const result = await dappLedgerApi(config, {
    requestMethod: method,
    resource,
    body: bodyValue,
  });

  output(ui, result, () => {
    console.log(`Ledger API: ${method} ${resource}`);
    printPrettyObject(result);
  });
}

async function runUpdates(config, options, ui) {
  requireBase(config);
  requireToken(config);

  const limit = getOption(options, "limit", "20");
  const query = new URLSearchParams();
  if (limit) query.set("limit", limit);

  const state = await readState();
  const beginExclusive =
    hasFlag(options, "since-last-send") &&
    state.lastSend?.completionOffset !== undefined
      ? state.lastSend.completionOffset
      : parseIntegerOption(options, "begin-exclusive");
  const endInclusive = parseIntegerOption(options, "end-inclusive");

  const body = {};
  if (beginExclusive !== undefined) body.beginExclusive = beginExclusive;
  if (endInclusive !== undefined) body.endInclusive = endInclusive;
  if (hasFlag(options, "verbose")) body.verbose = true;

  const resource =
    query.size > 0 ? `/v2/updates?${query.toString()}` : "/v2/updates";
  const result = await dappLedgerApi(config, {
    requestMethod: "POST",
    resource,
    body: JSON.stringify(body),
  });
  const summaries = Array.isArray(result)
    ? result.map(summarizeUpdateEntry)
    : [];

  output(ui, { updates: result, summaries }, () => {
    console.log("Updates");
    if (summaries.length === 0) {
      console.log("No updates returned.");
      return;
    }
    for (const summary of summaries) {
      if (summary.type === "Transaction") {
        console.log(
          `- tx ${summary.updateId} offset=${summary.offset} events=${summary.eventsCount} commandId=${summary.commandId ?? "-"}`,
        );
      } else if (summary.type === "OffsetCheckpoint") {
        console.log(`- checkpoint offset=${summary.offset}`);
      } else {
        console.log(`- ${summary.type}`);
      }
    }
  });
}

async function runUpdateById(config, options, positionals, ui) {
  requireBase(config);
  requireToken(config);

  const state = await readState();
  let updateId = getOption(options, "update-id", positionals[0] ?? "");
  if (!updateId && hasFlag(options, "last-send")) {
    updateId = state.lastSend?.updateId ?? "";
  }
  if (!updateId) {
    throw new Error(
      "update-by-id requires --update-id <updateId> or --last-send",
    );
  }

  const transactionShape = getOption(
    options,
    "transaction-shape",
    "TRANSACTION_SHAPE_ACS_DELTA",
  );
  const verbose = hasFlag(options, "verbose");
  const body = {
    updateId,
    updateFormat: {
      includeTransactions: {
        transactionShape,
        eventFormat: verbose ? { verbose: true } : {},
      },
      includeReassignments: verbose ? { verbose: true } : {},
    },
  };

  const result = await dappLedgerApi(config, {
    requestMethod: "POST",
    resource: "/v2/updates/update-by-id",
    body: JSON.stringify(body),
  });
  const summary = summarizeSingleUpdate(result);

  output(ui, result, () => {
    console.log("Update");
    if (summary.type === "Transaction") {
      console.log(`Update ID: ${summary.updateId}`);
      console.log(`Offset: ${summary.offset}`);
      console.log(`Command ID: ${summary.commandId ?? "-"}`);
      console.log(`Events: ${summary.eventsCount}`);
    } else {
      printPrettyObject(result);
    }
  });
}

async function runWatchUpdates(config, options, ui) {
  requireBase(config);
  requireToken(config);

  const intervalSeconds = parseIntegerOption(options, "interval") ?? 5;
  const limit = getOption(options, "limit", "20");
  const state = await readState();
  let cursor;

  if (parseIntegerOption(options, "begin-exclusive") !== undefined) {
    cursor = parseIntegerOption(options, "begin-exclusive");
  } else if (
    hasFlag(options, "since-last-send") &&
    state.lastSend?.completionOffset !== undefined
  ) {
    cursor = state.lastSend.completionOffset;
  } else {
    const ledgerEnd = await dappLedgerApi(config, {
      requestMethod: "GET",
      resource: "/v2/state/ledger-end",
    });
    cursor = ledgerEnd?.offset;
  }

  console.log(
    `Watching updates from offset ${cursor} every ${intervalSeconds}s. Press Ctrl+C to exit.`,
  );

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());

  while (!controller.signal.aborted) {
    const resource = `/v2/updates?${new URLSearchParams({ limit }).toString()}`;
    const result = await dappLedgerApi(config, {
      requestMethod: "POST",
      resource,
      body: JSON.stringify({ beginExclusive: cursor }),
    });
    const summaries = Array.isArray(result)
      ? result.map(summarizeUpdateEntry)
      : [];
    for (const summary of summaries) {
      if (summary.type === "Transaction") {
        console.log(
          `[tx] offset=${summary.offset} updateId=${summary.updateId} commandId=${summary.commandId ?? "-"} events=${summary.eventsCount}`,
        );
      } else if (summary.type === "OffsetCheckpoint") {
        console.log(`[checkpoint] offset=${summary.offset}`);
      }
      if (summary.offset !== undefined && summary.offset > cursor) {
        cursor = summary.offset;
      }
    }
    await sleep(intervalSeconds * 1000);
  }
}

async function runEvents(config, ui) {
  requireBase(config);
  requireToken(config);

  const controller = new AbortController();
  process.on("SIGINT", () => controller.abort());

  const response = await fetch(`${config.baseUrl}/api/v1/dapp/events`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    signal: controller.signal,
  });

  if (!response.ok || !response.body) {
    const text = await response.text();
    throw new Error(`events request failed (${response.status}): ${text}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  console.log("Streaming events. Press Ctrl+C to exit.");

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = findSseBoundary(buffer);
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        const separatorLength = buffer.startsWith("\r\n\r\n", boundary) ? 4 : 2;
        buffer = buffer.slice(boundary + separatorLength);
        const parsed = parseSseEvent(rawEvent);
        if (parsed) {
          const payload = maybeJson(parsed.data);
          output(
            ui,
            { event: parsed.event ?? "message", data: payload },
            () => {
              console.log(`[${parsed.event ?? "message"}]`);
              printPrettyObject(payload);
            },
          );
        }
        boundary = findSseBoundary(buffer);
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  }
}

async function runSend(config, options, positionals, ui) {
  requireBase(config);
  requireToken(config);

  const input = await resolveSendInput(config, options, positionals, ui);
  const primary = await jsonRpc(config, "getPrimaryAccount");
  const senderParty = config.partyId || asString(primary?.partyId);
  if (!senderParty) {
    throw new Error(
      "failed to resolve sender party; set --party-id or WALLET_PARTY_ID",
    );
  }
  validatePartyId(input.toParty);
  validatePartyId(senderParty);

  const privateKey = await loadPrivateKey(config.partyKey || input.partyKey);
  try {
    const publicKey = Uint8Array.from(ed25519.getPublicKey(privateKey));
    const fingerprint = computeEd25519Fingerprint(publicKey);
    validatePartyFingerprint(senderParty, fingerprint);

    const ledgerEnd = await dappLedgerApi(config, {
      requestMethod: "GET",
      resource: "/v2/state/ledger-end",
    });
    const activeAtOffset = ledgerEnd?.offset;
    const holdings = await fetchHoldings(config, activeAtOffset);
    const tokenConfig = getSendTokenConfig(config, input.tokenId);
    const matchingHoldings = holdings
      .filter((holding) => holdingMatchesToken(holding, tokenConfig))
      .sort((left, right) =>
        compareScaledDecimalStrings(
          right.amount,
          left.amount,
          tokenConfig.decimals,
        ),
      );
    if (matchingHoldings.length === 0) {
      throw new Error(`no holdings found for ${input.tokenId}`);
    }

    const selection = selectHoldings(
      matchingHoldings,
      input.amount,
      tokenConfig.decimals,
    );
    const prepareBody = await buildSendPrepareBody(config, {
      senderParty,
      receiverParty: input.toParty,
      amount: input.amount,
      memo: input.memo,
      tokenConfig,
      selection,
    });

    const preview = {
      senderParty,
      receiverParty: input.toParty,
      tokenId: input.tokenId,
      symbol: tokenConfig.symbol,
      network: config.network,
      amount: input.amount,
      memo: input.memo || undefined,
      selectedInputs: selection.contractIds,
      selectedTotal: unitsToDecimal(selection.totalUnits, tokenConfig.decimals),
      dryRun: input.dryRun,
      prepareOnly: input.prepareOnly,
      wait: input.wait,
    };

    if (input.dryRun) {
      output(ui, { preview, prepareBody }, () => {
        console.log("Dry run");
        printSendSummary(preview);
        console.log("No transaction was prepared or executed.");
      });
      return;
    }

    if (!ui.yes && ui.tty) {
      const confirmed = await confirmPrompt(
        `Send ${input.amount} ${tokenConfig.symbol} to ${input.toParty}?`,
      );
      if (!confirmed) {
        throw new Error("send cancelled");
      }
    }

    const prepared = await dappPrepare(config, prepareBody, senderParty);
    const executeBody = {
      preparedTransaction: prepared.preparedTransaction,
      hashingSchemeVersion: prepared.hashingSchemeVersion,
      signatureBase64: bytesToBase64(
        ed25519.sign(
          base64ToBytes(prepared.preparedTransactionHash),
          privateKey,
        ),
      ),
      fingerprint,
    };

    if (input.prepareOnly) {
      output(
        ui,
        {
          preview,
          prepared,
          signatureBase64: executeBody.signatureBase64,
          fingerprint,
        },
        () => {
          console.log("Prepared only");
          printSendSummary(preview);
          console.log(`Command ID: ${prepared.commandId}`);
          console.log(`Prepared hash: ${prepared.preparedTransactionHash}`);
          console.log("Transaction was not executed.");
        },
      );
      return;
    }

    if (!input.wait) {
      const detached = await spawnDetachedExecute(
        config,
        senderParty,
        executeBody,
        {
          commandId: prepared.commandId,
          receiverParty: input.toParty,
          tokenId: input.tokenId,
          amount: input.amount,
          network: config.network,
          senderParty,
        },
      );
      output(ui, detached, () => {
        console.log("Send submitted in background");
        printSendSummary(preview);
        console.log(`Command ID: ${prepared.commandId}`);
        console.log(`Result file: ${detached.resultFile}`);
      });
      return;
    }

    const executed = await dappExecuteAndWait(config, executeBody, senderParty);
    const result = {
      ...preview,
      prepared: {
        commandId: prepared.commandId,
        hashingSchemeVersion: prepared.hashingSchemeVersion,
        expiresAt: prepared.expiresAt,
      },
      executed,
    };

    await writeState({
      lastSend: {
        updateId: executed.updateId,
        completionOffset: executed.completionOffset,
        commandId: prepared.commandId,
        senderParty,
        receiverParty: input.toParty,
        tokenId: input.tokenId,
        amount: input.amount,
        network: config.network,
        sentAt: new Date().toISOString(),
      },
    });

    output(ui, result, () => {
      console.log("Send complete");
      printSendSummary(preview);
      console.log(`Update ID: ${executed.updateId}`);
      console.log(`Completion offset: ${executed.completionOffset}`);
    });
  } finally {
    privateKey.fill(0);
  }
}

async function resolveSendInput(config, options, positionals, ui) {
  const resolved = {
    toParty: getOption(
      options,
      "to-party",
      getOption(options, "to", positionals[0] ?? ""),
    ),
    tokenId: getOption(
      options,
      "token-id",
      positionals[1] ?? defaultSendTokenId(config),
    ),
    amount: getOption(options, "amount", positionals[2] ?? ""),
    memo: getOption(options, "memo", ""),
    partyKey: getOption(options, "party-key", ""),
    dryRun: hasFlag(options, "dry-run"),
    prepareOnly: hasFlag(options, "prepare-only"),
    wait: getOption(options, "wait", "true").toLowerCase() !== "false",
  };

  if (ui.tty && !resolved.toParty) {
    resolved.toParty = await promptValue("Recipient party ID");
  }
  if (ui.tty && !resolved.amount) {
    resolved.amount = await promptValue("Amount");
  }
  if (ui.tty && !config.partyKey && !resolved.partyKey) {
    resolved.partyKey = await promptValue("Party key (base64 or @file)", {
      silent: true,
    });
  }

  if (!resolved.toParty) throw new Error("send requires --to-party <partyId>");
  if (!resolved.amount) throw new Error("send requires --amount <decimal>");
  getSendTokenConfig(config, resolved.tokenId);

  return resolved;
}

async function runBackgroundExecute(positionals, options) {
  const payloadFile = getOption(options, "payload-file", positionals[0] ?? "");
  if (!payloadFile) {
    throw new Error("__execute-prepared requires --payload-file");
  }
  const payload = JSON.parse(await readFile(payloadFile, "utf8"));
  try {
    const executed = await dappExecuteAndWait(
      payload.config,
      payload.executeBody,
      payload.senderParty,
    );
    const result = {
      ok: true,
      commandId: payload.metadata.commandId,
      updateId: executed.updateId,
      completionOffset: executed.completionOffset,
      completedAt: new Date().toISOString(),
    };
    await writeFile(payload.resultFile, JSON.stringify(result, null, 2));
    await writeState({
      lastSend: {
        updateId: executed.updateId,
        completionOffset: executed.completionOffset,
        commandId: payload.metadata.commandId,
        senderParty: payload.metadata.senderParty,
        receiverParty: payload.metadata.receiverParty,
        tokenId: payload.metadata.tokenId,
        amount: payload.metadata.amount,
        network: payload.metadata.network,
        sentAt: new Date().toISOString(),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeFile(
      payload.resultFile,
      JSON.stringify(
        {
          ok: false,
          commandId: payload.metadata.commandId,
          error: message,
          failedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

async function spawnDetachedExecute(
  config,
  senderParty,
  executeBody,
  metadata,
) {
  const dir = await mkdtemp(path.join(tmpdir(), "automation-demo-"));
  const payloadFile = path.join(dir, "payload.json");
  const resultFile = path.join(dir, "result.json");
  await writeFile(
    payloadFile,
    JSON.stringify(
      { config, senderParty, executeBody, metadata, resultFile },
      null,
      2,
    ),
  );
  const child = spawn(
    process.execPath,
    [__filename, "__execute-prepared", "--payload-file", payloadFile],
    {
      detached: true,
      stdio: "ignore",
    },
  );
  child.unref();
  return {
    background: true,
    pid: child.pid,
    payloadFile,
    resultFile,
    commandId: metadata.commandId,
  };
}

function getSendTokenConfig(config, tokenId) {
  if (DEVNET_TEST_TOKENS[tokenId]) {
    if (config.network !== "devnet") {
      throw new Error(
        `${tokenId} is only supported on devnet; use --token-id USDCx for testnet`,
      );
    }
    return {
      tokenId,
      ...DEVNET_TEST_TOKENS[tokenId],
      instrument: {
        admin: TEST_TOKEN_ADMIN_PARTY,
        id: tokenId,
      },
      sendPath: "devnet-test-token",
    };
  }

  const configured = config.networkConfig?.assets?.[tokenId];
  if (configured) {
    return {
      ...configured,
      sendPath:
        configured.transferFactorySource === "utilities"
          ? "utilities-registry"
          : "registry",
    };
  }

  const networkAssets = Object.keys(config.networkConfig?.assets ?? {});
  const supported = [...Object.keys(DEVNET_TEST_TOKENS), ...networkAssets].join(
    ", ",
  );
  throw new Error(
    `send does not support ${tokenId} on ${config.network}; supported tokens: ${supported}`,
  );
}

function holdingMatchesToken(holding, tokenConfig) {
  if (!holding?.instrument || !tokenConfig?.instrument) return false;
  if (holding.instrument.id !== tokenConfig.instrument.id) return false;
  if (!tokenConfig.instrument.admin) return true;
  return holding.instrument.admin === tokenConfig.instrument.admin;
}

async function buildSendPrepareBody(config, params) {
  switch (params.tokenConfig.sendPath) {
    case "devnet-test-token":
      return buildDevnetTestTokenPrepareBody(params);
    case "utilities-registry":
      return await buildUtilitiesRegistryPrepareBody(config, params);
    default:
      throw new Error(`unsupported send path: ${params.tokenConfig.sendPath}`);
  }
}

function createTransferTiming() {
  const now = new Date();
  return {
    requestedAt: new Date(now.getTime() - 1000),
    executeBefore: new Date(now.getTime() + 24 * 60 * 60 * 1000),
  };
}

function buildTransferChoiceArgument(
  params,
  contextValues = {},
  timing = createTransferTiming(),
) {
  const metaValues = params.memo ? { memo: params.memo } : {};

  return {
    expectedAdmin: params.tokenConfig.instrument.admin,
    transfer: {
      sender: params.senderParty,
      receiver: params.receiverParty,
      amount: params.amount,
      instrumentId: {
        admin: params.tokenConfig.instrument.admin,
        id: params.tokenConfig.instrument.id,
      },
      requestedAt: formatLedgerTimestamp(timing.requestedAt),
      executeBefore: formatLedgerTimestamp(timing.executeBefore),
      inputHoldingCids: params.selection.contractIds,
      meta: { values: metaValues },
    },
    extraArgs: {
      context: normalizeChoiceContext(contextValues),
      meta: { values: metaValues },
    },
  };
}

function normalizeChoiceContext(contextValues) {
  if (isObject(contextValues) && isObject(contextValues.values)) {
    return contextValues;
  }
  return { values: contextValues ?? {} };
}

function buildDevnetTestTokenPrepareBody(params) {
  return {
    commandId: randomUUID(),
    commands: [
      {
        ExerciseCommand: {
          templateId: TRANSFER_FACTORY_INTERFACE_ID,
          contractId: TEST_TOKEN_TRANSFER_FACTORY_CID,
          choice: "TransferFactory_Transfer",
          choiceArgument: buildTransferChoiceArgument(params),
        },
      },
    ],
    disclosedContracts: [
      {
        templateId: TEST_TOKEN_TRANSFER_FACTORY_TEMPLATE_ID,
        contractId: TEST_TOKEN_TRANSFER_FACTORY_CID,
        createdEventBlob: TEST_TOKEN_TRANSFER_FACTORY_BLOB,
      },
    ],
  };
}

async function buildUtilitiesRegistryPrepareBody(config, params) {
  if (!config.utilitiesUrl) {
    throw new Error(
      "WALLET_REGISTRY_URL, WALLET_TESTNET_REGISTRY_URL, --registry-url, or --utilities-url is required for USDCx registry transfers",
    );
  }

  const timing = createTransferTiming();
  const baseChoiceArgument = buildTransferChoiceArgument(params, {}, timing);
  const factory = await fetchUtilitiesTransferFactory(
    config.utilitiesUrl,
    params.tokenConfig.instrument.admin,
    baseChoiceArgument,
  );
  const contextValues = factory?.choiceContext?.choiceContextData ?? {};
  const choiceArgument = buildTransferChoiceArgument(
    params,
    contextValues,
    timing,
  );

  return {
    commandId: randomUUID(),
    commands: [
      {
        ExerciseCommand: {
          templateId: TRANSFER_FACTORY_INTERFACE_ID,
          contractId: factory.factoryId,
          choice: "TransferFactory_Transfer",
          choiceArgument,
        },
      },
    ],
    disclosedContracts: normalizeDisclosedContracts(
      factory?.choiceContext?.disclosedContracts,
    ),
  };
}

async function fetchUtilitiesTransferFactory(
  utilitiesUrl,
  instrumentAdmin,
  choiceArguments,
) {
  const url = `${trimTrailingSlash(utilitiesUrl)}/registrars/${encodeURIComponent(
    instrumentAdmin,
  )}/registry/transfer-instruction/v1/transfer-factory`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      choiceArguments,
      excludeDebugFields: true,
    }),
  });
  const json = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(
      `transfer factory request failed (${response.status}): ${extractProblemDetail(json)}`,
    );
  }
  if (!json?.factoryId) {
    throw new Error("transfer factory response did not include factoryId");
  }
  return json;
}

function normalizeDisclosedContracts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => ({
      templateId: asString(item?.templateId),
      contractId: asString(item?.contractId),
      createdEventBlob: asString(item?.createdEventBlob),
      synchronizerId: asString(item?.synchronizerId) || undefined,
    }))
    .filter(
      (item) => item.templateId && item.contractId && item.createdEventBlob,
    );
}

function defaultSendTokenId(config) {
  if (config.network === "testnet") return "USDCx";
  return "TestUSD";
}

function parseArgv(argv) {
  let command = "";
  const positionals = [];
  const options = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      if (eq !== -1) {
        options[arg.slice(2, eq)] = arg.slice(eq + 1);
        continue;
      }
      const next = argv[index + 1];
      if (next && !next.startsWith("-")) {
        options[arg.slice(2)] = next;
        index += 1;
      } else {
        options[arg.slice(2)] = "true";
      }
      continue;
    }
    if (!command) {
      command = arg;
    } else {
      positionals.push(arg);
    }
  }

  return { command, positionals, options };
}

function getOption(options, key, fallback) {
  const value = options[key];
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

function getFirstOption(options, keys) {
  for (const key of keys) {
    const value = options[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function getFirstEnv(keys) {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function resolveNetworkUrl({
  options,
  optionKey,
  aliasOptionKey = "",
  network,
  networkConfig,
  configKey,
  envSuffix,
  aliasEnvSuffix = "",
  globalEnvKeys,
}) {
  const optionValue = getFirstOption(
    options,
    [optionKey, aliasOptionKey].filter(Boolean),
  );
  if (optionValue) return trimTrailingSlash(optionValue);

  const networkEnvKeys = [
    `WALLET_${network.toUpperCase()}_${envSuffix}`,
    aliasEnvSuffix ? `WALLET_${network.toUpperCase()}_${aliasEnvSuffix}` : "",
  ].filter(Boolean);
  const networkEnvValue = getFirstEnv(networkEnvKeys);
  if (networkEnvValue) return trimTrailingSlash(networkEnvValue);

  const globalEnvValue = getFirstEnv(globalEnvKeys);
  if (
    globalEnvValue &&
    !isOtherNetworkDefaultUrl(network, globalEnvValue, configKey)
  ) {
    return trimTrailingSlash(globalEnvValue);
  }

  return trimTrailingSlash(networkConfig[configKey] ?? "");
}

function isOtherNetworkDefaultUrl(selectedNetwork, value, configKey) {
  const normalized = trimTrailingSlash(String(value || ""));
  if (!normalized) return false;
  for (const [networkName, networkConfig] of Object.entries(NETWORKS)) {
    if (networkName === selectedNetwork) continue;
    if (trimTrailingSlash(networkConfig[configKey] ?? "") === normalized)
      return true;
  }
  return false;
}

function normalizeNetworkName(value) {
  const normalized = String(value || DEFAULT_NETWORK)
    .trim()
    .toLowerCase();
  if (normalized === "test" || normalized === "test-net") return "testnet";
  if (normalized === "dev" || normalized === "dev-net") return "devnet";
  return normalized;
}

function getNetworkConfig(network) {
  const config = NETWORKS[network];
  if (!config) {
    throw new Error(
      `unsupported network: ${network}. Supported networks: ${Object.keys(NETWORKS).join(", ")}`,
    );
  }
  return config;
}

function hasFlag(options, key) {
  return Object.hasOwn(options, key);
}

function parseIntegerOption(options, key) {
  const value = options[key];
  if (value === undefined) return undefined;
  if (!/^-?\d+$/.test(String(value))) {
    throw new Error(`--${key} must be an integer`);
  }
  return Number.parseInt(String(value), 10);
}

function requireBase(config) {
  if (!config.baseUrl)
    throw new Error("WALLET_BASE_URL or --base-url is required");
}

function requireToken(config) {
  if (!config.token) throw new Error("WALLET_TOKEN or --token is required");
}

async function getOptionalBody(options) {
  const bodyFile = getOption(options, "body-file", "");
  if (bodyFile) return await readFile(bodyFile, "utf8");
  const bodyJson = getOption(options, "body-json", "");
  if (bodyJson) {
    JSON.parse(bodyJson);
    return bodyJson;
  }
  const body = getOption(options, "body", "");
  return body || undefined;
}

async function jsonRpc(config, method, params) {
  const body = { jsonrpc: "2.0", id: randomUUID(), method };
  if (params !== undefined) body.params = params;
  const response = await fetch(`${config.baseUrl}/api/v1/dapp`, {
    method: "POST",
    headers: buildJsonHeaders(config.token),
    body: JSON.stringify(body),
  });
  const json = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(
      `JSON-RPC request failed (${response.status}): ${JSON.stringify(json)}`,
    );
  }
  if (json?.error) {
    throw new Error(
      `${json.error.message ?? "JSON-RPC error"} (code ${json.error.code ?? "unknown"})`,
    );
  }
  return json?.result;
}

async function dappLedgerApi(config, request) {
  const response = await fetch(`${config.baseUrl}/api/v1/dapp/ledger-api`, {
    method: "POST",
    headers: buildJsonHeaders(config.token),
    body: JSON.stringify(request),
  });
  const json = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(
      `ledger-api request failed (${response.status}): ${extractProblemDetail(json)}`,
    );
  }
  return maybeJson(json.response);
}

async function dappPrepare(config, body, partyId) {
  const url = new URL(`${config.baseUrl}/api/v1/dapp/interactive/prepare`);
  if (partyId) url.searchParams.set("partyId", partyId);
  const response = await fetch(url, {
    method: "POST",
    headers: buildJsonHeaders(config.token),
    body: JSON.stringify(body),
  });
  const json = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(
      `interactive prepare failed (${response.status}): ${extractProblemDetail(json)}`,
    );
  }
  return json;
}

async function dappExecuteAndWait(config, body, partyId) {
  const url = new URL(
    `${config.baseUrl}/api/v1/dapp/interactive/execute-and-wait`,
  );
  if (partyId) url.searchParams.set("partyId", partyId);
  const response = await fetch(url, {
    method: "POST",
    headers: buildJsonHeaders(config.token),
    body: JSON.stringify(body),
  });
  const json = await parseResponseJson(response);
  if (!response.ok) {
    throw new Error(
      `interactive execute failed (${response.status}): ${extractProblemDetail(json)}`,
    );
  }
  return json;
}

async function fetchHoldings(config, activeAtOffset) {
  const payload = {
    filter: {
      filtersByParty: {
        ignored: {
          cumulative: [
            {
              identifierFilter: {
                InterfaceFilter: {
                  value: {
                    interfaceId: HOLDING_INTERFACE_ID,
                    includeInterfaceView: true,
                    includeCreatedEventBlob: false,
                  },
                },
              },
            },
          ],
        },
      },
    },
  };
  if (activeAtOffset !== undefined) payload.activeAtOffset = activeAtOffset;

  const response = await dappLedgerApi(config, {
    requestMethod: "POST",
    resource: "/v2/state/active-contracts",
    body: JSON.stringify(payload),
  });

  return normalizeActiveContracts(response)
    .map((contract) => normalizeHolding(contract))
    .filter(Boolean);
}

function normalizeActiveContracts(raw) {
  if (Array.isArray(raw)) {
    return raw
      .map(extractContract)
      .filter((entry) => entry.contractId && entry.payload);
  }
  if (raw && Array.isArray(raw.activeContracts)) {
    return raw.activeContracts
      .map((entry) => {
        const contractEntry = entry?.contractEntry ?? {};
        return {
          contractId: contractEntry.contractId ?? "",
          templateId: contractEntry.templateId ?? "",
          interfaceId: contractEntry.interfaceId ?? "",
          createdEventBlob: contractEntry.createdEventBlob ?? "",
          payload: contractEntry.payload ?? {},
        };
      })
      .filter((entry) => entry.contractId && entry.payload);
  }
  throw new Error("unexpected active-contracts response shape");
}

function extractContract(entry) {
  const createdEvent =
    entry?.contractEntry?.JsActiveContract?.createdEvent ??
    entry?.activeContract?.contractEntry?.JsActiveContract?.createdEvent ??
    null;
  if (createdEvent) {
    return {
      contractId: createdEvent.contractId ?? "",
      templateId: createdEvent.templateId ?? "",
      interfaceId: "",
      createdEventBlob: createdEvent.createdEventBlob ?? "",
      payload: createdEvent.createArgument ?? {},
    };
  }
  if (entry?.contractEntry?.contractId) {
    return {
      contractId: entry.contractEntry.contractId,
      templateId: entry.contractEntry.templateId ?? "",
      interfaceId: entry.contractEntry.interfaceId ?? "",
      createdEventBlob: entry.contractEntry.createdEventBlob ?? "",
      payload: entry.contractEntry.payload ?? {},
    };
  }
  return {
    contractId: entry?.contractId ?? "",
    templateId: entry?.templateId ?? "",
    interfaceId: entry?.interfaceId ?? "",
    createdEventBlob: entry?.createdEventBlob ?? "",
    payload: entry?.payload ?? {},
  };
}

function normalizeHolding(contract) {
  const owner = extractOwner(contract.payload);
  const instrument = extractInstrument(contract.payload);
  const amount = extractAmount(contract.payload);
  if (!owner || !instrument || !amount || amount === "0") return null;
  return {
    contractId: contract.contractId,
    templateId: contract.templateId,
    owner,
    instrument,
    amount,
    payload: contract.payload,
  };
}

function extractInstrument(payload) {
  if (!isObject(payload)) return null;
  if (isObject(payload.instrumentId)) {
    return {
      admin: asString(payload.instrumentId.admin),
      id: asString(payload.instrumentId.id),
    };
  }
  if (isObject(payload.instrument)) {
    const admin =
      asString(payload.instrument.admin) ||
      asString(payload.instrument.source) ||
      asString(payload.registrar);
    return { admin, id: asString(payload.instrument.id) };
  }
  if (isObject(payload.tokenConfig)) {
    return {
      admin: asString(payload.admin),
      id: asString(payload.tokenConfig.tokenId),
    };
  }
  if (typeof payload.dso === "string" && isObject(payload.amount)) {
    return { admin: payload.dso, id: "CantonCoin" };
  }
  if (isObject(payload.amulet) && typeof payload.amulet.dso === "string") {
    return { admin: payload.amulet.dso, id: "CantonCoin" };
  }
  if (
    isObject(payload.amount) &&
    isObject(payload.amount.unit) &&
    isObject(payload.amount.unit.instrumentId)
  ) {
    return {
      admin: asString(payload.amount.unit.instrumentId.admin),
      id: asString(payload.amount.unit.instrumentId.id),
    };
  }
  return null;
}

function extractAmount(payload) {
  if (!isObject(payload)) return "0";
  if (typeof payload.amount === "string") return payload.amount;
  if (typeof payload.amount === "number") return formatNumber(payload.amount);
  if (isObject(payload.amount) && typeof payload.amount.value === "string")
    return payload.amount.value;
  if (
    isObject(payload.amount) &&
    typeof payload.amount.initialAmount === "string"
  )
    return payload.amount.initialAmount;
  if (isObject(payload.transfer)) return extractAmount(payload.transfer);
  if (isObject(payload.amulet)) return extractAmount(payload.amulet);
  return "0";
}

function extractOwner(payload) {
  if (!isObject(payload)) return "";
  if (typeof payload.owner === "string") return payload.owner;
  if (isObject(payload.amulet) && typeof payload.amulet.owner === "string")
    return payload.amulet.owner;
  return "";
}

function summarizeHoldings(holdings) {
  const grouped = new Map();
  for (const holding of holdings) {
    const tokenId = holding.instrument.id || "Unknown";
    const tokenKey = `${holding.instrument.admin ?? ""}::${tokenId}`;
    const meta = getTokenMetaForHolding(holding);
    const current = grouped.get(tokenKey) ?? {
      tokenId,
      admin: holding.instrument.admin || "",
      symbol: meta.symbol,
      decimals: meta.decimals,
      totalUnits: 0n,
      contractCount: 0,
    };
    current.totalUnits += decimalToUnits(holding.amount, meta.decimals);
    current.contractCount += 1;
    grouped.set(tokenKey, current);
  }
  return [...grouped.values()]
    .map((item) => ({
      tokenId: item.tokenId,
      admin: item.admin,
      symbol: item.symbol,
      total: unitsToDecimal(item.totalUnits, item.decimals),
      contractCount: item.contractCount,
    }))
    .sort((left, right) => left.symbol.localeCompare(right.symbol));
}

function getTokenMetaForHolding(holding) {
  const tokenId = holding?.instrument?.id ?? "";
  const admin = holding?.instrument?.admin ?? "";
  if (DEVNET_TEST_TOKENS[tokenId]) return DEVNET_TEST_TOKENS[tokenId];
  for (const networkConfig of Object.values(NETWORKS)) {
    for (const asset of Object.values(networkConfig.assets ?? {})) {
      if (
        asset.instrument?.id === tokenId &&
        (!asset.instrument.admin || asset.instrument.admin === admin)
      ) {
        return asset;
      }
    }
  }
  if (tokenId === "Amulet" || tokenId === "CantonCoin") {
    return { symbol: "CC", decimals: 10 };
  }
  return { symbol: tokenId || "Unknown", decimals: 10 };
}

function summarizeUpdateEntry(entry) {
  const update = entry?.update ?? {};
  if (update.Transaction?.value) {
    const tx = update.Transaction.value;
    return {
      type: "Transaction",
      updateId: tx.updateId,
      commandId: tx.commandId,
      offset: tx.offset,
      eventsCount: Array.isArray(tx.events) ? tx.events.length : 0,
    };
  }
  if (update.OffsetCheckpoint?.value) {
    return {
      type: "OffsetCheckpoint",
      offset: update.OffsetCheckpoint.value.offset,
    };
  }
  return { type: Object.keys(update)[0] ?? "Unknown" };
}

function summarizeSingleUpdate(result) {
  return summarizeUpdateEntry({ update: result.update ?? result });
}

function selectHoldings(holdings, requestedAmount, decimals) {
  const target = decimalToUnits(requestedAmount, decimals);
  if (target <= 0n) throw new Error("amount must be greater than zero");
  const selected = [];
  let total = 0n;
  for (const holding of holdings) {
    const units = decimalToUnits(holding.amount, decimals);
    if (units <= 0n) continue;
    selected.push(holding.contractId);
    total += units;
    if (total >= target) return { contractIds: selected, totalUnits: total };
  }
  throw new Error(
    `insufficient balance: need ${requestedAmount}, have ${unitsToDecimal(total, decimals)}`,
  );
}

function compareScaledDecimalStrings(left, right, decimals) {
  const leftUnits = decimalToUnits(left, decimals);
  const rightUnits = decimalToUnits(right, decimals);
  if (leftUnits === rightUnits) return 0;
  return leftUnits > rightUnits ? 1 : -1;
}

function decimalToUnits(value, decimals) {
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`invalid decimal amount: ${value}`);
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed))
    throw new Error(`invalid decimal amount: ${value}`);
  const [whole, fractional = ""] = trimmed.split(".");
  if (
    fractional.length > decimals &&
    /[1-9]/.test(fractional.slice(decimals))
  ) {
    throw new Error(
      `amount ${value} exceeds token precision (${decimals} decimals)`,
    );
  }
  const paddedFractional = fractional.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(`${whole}${paddedFractional}`.replace(/^0+(?=\d)/, "") || "0");
}

function unitsToDecimal(units, decimals) {
  const absolute = units < 0n ? -units : units;
  const raw = absolute.toString().padStart(decimals + 1, "0");
  const whole = raw.slice(0, raw.length - decimals) || "0";
  const fractional =
    decimals === 0 ? "" : raw.slice(raw.length - decimals).replace(/0+$/, "");
  const result = fractional ? `${whole}.${fractional}` : whole;
  return units < 0n ? `-${result}` : result;
}

async function loadPrivateKey(rawValue) {
  if (!rawValue)
    throw new Error(
      "WALLET_PARTY_PRIVATE_KEY or --party-key is required for send",
    );
  let value = rawValue.trim();
  if (value.startsWith("@"))
    value = (await readFile(value.slice(1), "utf8")).trim();
  if (/^[0-9a-fA-F]{64}$/.test(value)) return hexToBytes(value);
  const bytes = base64ToBytes(value);
  if (bytes.length !== 32) {
    throw new Error(
      `Ed25519 private key must decode to 32 bytes, got ${bytes.length}`,
    );
  }
  return bytes;
}

function validatePartyFingerprint(partyId, fingerprint) {
  const parts = partyId.split("::");
  if (parts.length !== 2 || parts[1] !== fingerprint) {
    throw new Error("supplied private key does not match the signing party");
  }
}

function validatePartyId(partyId) {
  const parts = partyId.split("::");
  if (
    parts.length !== 2 ||
    !parts[0] ||
    !/^1220[0-9a-f]{64}$/i.test(parts[1])
  ) {
    throw new Error(`invalid party ID: ${partyId}`);
  }
}

function computeEd25519Fingerprint(publicKey) {
  const prefix = Uint8Array.from([0x00, 0x00, 0x00, 0x0c]);
  const input = new Uint8Array(prefix.length + publicKey.length);
  input.set(prefix);
  input.set(publicKey, prefix.length);
  return `1220${createHash("sha256").update(input).digest("hex")}`;
}

function buildJsonHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function parseResponseJson(response) {
  const text = await response.text();
  return text ? maybeJson(text) : {};
}

function maybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractProblemDetail(payload) {
  if (payload && typeof payload === "object") {
    return payload.detail ?? payload.title ?? JSON.stringify(payload);
  }
  return String(payload);
}

function parseSseEvent(rawEvent) {
  const lines = rawEvent.replace(/\r/g, "").split("\n");
  let event = "";
  const dataLines = [];
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) continue;
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return null;
  return { event, data: dataLines.join("\n") };
}

function findSseBoundary(buffer) {
  const crlf = buffer.indexOf("\r\n\r\n");
  const lf = buffer.indexOf("\n\n");
  if (crlf === -1) return lf;
  if (lf === -1) return crlf;
  return Math.min(crlf, lf);
}

async function readState() {
  if (!(await fileExists(STATE_FILE))) return {};
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}

async function writeState(patch) {
  const current = await readState();
  const next = { ...current, ...patch };
  await writeFile(STATE_FILE, JSON.stringify(next, null, 2));
}

function output(ui, raw, humanWriter) {
  if (ui.json) {
    console.log(JSON.stringify(raw, null, 2));
  } else {
    humanWriter();
  }
}

function printSendSummary(preview) {
  console.log(`From: ${preview.senderParty}`);
  console.log(`To:   ${preview.receiverParty}`);
  console.log(`What: ${preview.amount} ${preview.symbol ?? preview.tokenId}`);
  if (preview.memo) console.log(`Memo: ${preview.memo}`);
}

function printPrettyObject(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function promptValue(question, options = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    if (options.silent) {
      return (await rl.question(`${question}: `)).trim();
    }
    return (await rl.question(`${question}: `)).trim();
  } finally {
    rl.close();
  }
}

async function confirmPrompt(question) {
  const answer = (await promptValue(`${question} [y/N]`)).toLowerCase();
  return answer === "y" || answer === "yes";
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function trimTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

function asString(value) {
  return typeof value === "string" ? value : "";
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatNumber(value) {
  return value.toLocaleString("en-US", {
    useGrouping: false,
    maximumSignificantDigits: 21,
  });
}

function formatLedgerTimestamp(value) {
  const iso = value.toISOString();
  return `${iso.slice(0, 19)}.${iso.slice(20, 23)}000Z`;
}

function base64ToBytes(value) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

function bytesToBase64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

function hexToBytes(value) {
  return Uint8Array.from(Buffer.from(value, "hex"));
}
