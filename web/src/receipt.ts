import { getAddress, parseEventLogs, zeroAddress } from "viem";
import { ARC_MAINNET, ARC_TESTNET, CHAINS, DEFAULT_CHAIN, LOCAL_CHAIN, NATIVE_DECIMALS, TOKEN_DECIMALS, addressUrl, devMode, supportedChain, txUrl, type ChainConfig, type Hex } from "./config";
import { ERC20_ABI, deploymentStatus, readClient } from "./chain";
import { parseSheet } from "./csv";
import { decodeRef, escapeCsv, formatAmount, plainAmount, shortAddress, utcDate, utcTime } from "./format";
import { centsToString, ecbUsdPerEur, eurAtParCents, eurPerUsd, usdToEurCents, type EcbRate } from "./fx";
import { REMITSHEET_ABI } from "./generated/remitsheet";
import { navigate } from "./main";
import { clear, copyText, download, extLink, h, icon, storageGet, storageSet, toast } from "./ui";
import { onWalletChange } from "./wallet";

type AssetInfo = { symbol: string; decimals: number; native: boolean; address: Hex };
type Line = { index: number; to: Hex; amount: bigint; label: string };
type Batch = { emitter: Hex; ref: Hex; refText: string; sender: Hex; asset: AssetInfo; total: bigint; count: number; lines: Line[] };
export type ReceiptData = {
  chain: ChainConfig;
  hash: Hex;
  status: "success" | "reverted";
  blockNumber: bigint;
  timestamp: number;
  from: Hex;
  fee: bigint;
  batches: Batch[];
  ignoredEmitters: Hex[];
};

export type RecentBatch = { hash: Hex; chainId: number; timestamp: number; count: number; total: string; asset: string; ref: string };
export const RECENT_KEY = "remitsheet:recent";

async function assetInfo(chain: ChainConfig, token: Hex): Promise<AssetInfo> {
  if (token === zeroAddress) return { symbol: "USDC", decimals: NATIVE_DECIMALS, native: true, address: token };
  if (chain.eurc && token.toLowerCase() === chain.eurc.toLowerCase()) return { symbol: "EURC", decimals: TOKEN_DECIMALS, native: false, address: token };
  const pc = readClient(chain);
  try {
    const [symbol, decimals] = await Promise.all([
      pc.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" }) as Promise<string>,
      pc.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" }) as Promise<number>,
    ]);
    return { symbol: String(symbol).slice(0, 12), decimals: Number(decimals), native: false, address: token };
  } catch {
    return { symbol: shortAddress(token), decimals: 18, native: false, address: token };
  }
}

/** Rebuilds the batches of a transaction from its logs. Only logs from genuine Remitsheet code are used. */
export async function loadReceipt(chain: ChainConfig, hash: Hex): Promise<ReceiptData> {
  const pc = readClient(chain);
  const receipt = await pc.getTransactionReceipt({ hash });
  const block = await pc.getBlock({ blockNumber: receipt.blockNumber });
  const decoded = parseEventLogs({ abi: REMITSHEET_ABI, logs: receipt.logs });

  const emitters = [...new Set(decoded.map((l) => getAddress(l.address)))];
  const trusted = new Set<string>();
  const ignored: Hex[] = [];
  for (const e of emitters) {
    if ((await deploymentStatus(chain, e)) === "live") trusted.add(e.toLowerCase());
    else ignored.push(e);
  }

  const batches: Batch[] = [];
  let pending: { to: Hex; amount: bigint; token: Hex; ref: Hex }[] = [];
  let pendingEmitter = "";
  for (const log of decoded) {
    if (!trusted.has(log.address.toLowerCase())) continue;
    if (pendingEmitter && pendingEmitter !== log.address.toLowerCase()) pending = [];
    pendingEmitter = log.address.toLowerCase();
    if (log.eventName === "Paid") {
      pending.push({ to: getAddress(log.args.to), amount: log.args.amount, token: getAddress(log.args.token), ref: log.args.ref });
    } else if (log.eventName === "BatchPaid") {
      const { ref, sender, token, total, count } = log.args;
      const mine = pending.filter((p) => p.ref === ref && p.token.toLowerCase() === token.toLowerCase());
      const lines = mine.slice(-Number(count)).map((p, index) => ({ index, to: p.to, amount: p.amount, label: "" }));
      batches.push({
        emitter: getAddress(log.address),
        ref,
        refText: decodeRef(ref),
        sender: getAddress(sender),
        asset: await assetInfo(chain, getAddress(token)),
        total,
        count: Number(count),
        lines,
      });
      pending = [];
    }
  }

  // Labels never go on-chain. They come from this browser (saved when the batch was sent) or from a CSV.
  const saved = storageGet<string[] | null>(`remitsheet:labels:${hash.toLowerCase()}`, null);
  if (saved && batches.length === 1 && saved.length === batches[0].lines.length) {
    batches[0].lines.forEach((l, i) => (l.label = saved[i] ?? ""));
  }

  return {
    chain,
    hash,
    status: receipt.status,
    blockNumber: receipt.blockNumber,
    timestamp: Number(block.timestamp),
    from: getAddress(receipt.from),
    fee: receipt.gasUsed * receipt.effectiveGasPrice,
    batches,
    ignoredEmitters: ignored,
  };
}

/** Accounting export: one row per payment line plus one row for the network fee. */
export async function accountingCsv(data: ReceiptData, onlyTo?: string): Promise<{ csv: string; rateError?: string }> {
  const date = utcDate(data.timestamp);
  const time = utcTime(data.timestamp);
  let rate: EcbRate | undefined;
  let rateError: string | undefined;
  try {
    rate = await ecbUsdPerEur(date);
  } catch (err) {
    rateError = `Could not load the ECB reference rate (${(err as Error).message}). EUR columns are empty.`;
  }
  const header = [
    "type", "date_utc", "time_utc", "network", "chain_id", "tx_hash", "block", "batch_reference", "sender", "line",
    "recipient", "label", "asset", "amount", "eur_rate_date", "usd_per_eur", "eur_per_usd", "amount_eur", "eur_rate_source", "explorer_url",
  ];
  const rows: string[][] = [];
  const explorer = txUrl(data.chain, data.hash) ?? "";
  const usdEur = (amount: bigint, decimals: number) => (rate ? centsToString(usdToEurCents(amount, decimals, rate.usdPerEur)) : "");
  const rateCols = () => [rate?.rateDate ?? "", rate?.usdPerEur ?? "", rate ? eurPerUsd(rate.usdPerEur) : ""];
  for (const b of data.batches) {
    for (const l of b.lines) {
      if (onlyTo && l.to.toLowerCase() !== onlyTo.toLowerCase()) continue;
      let eur = "";
      let source = rate ? `${rate.source}; 1 USDC valued at 1 USD` : "unavailable";
      let cols = rateCols();
      if (b.asset.symbol === "EURC") {
        eur = centsToString(eurAtParCents(l.amount, b.asset.decimals));
        source = "EURC valued at par (1 EURC = 1 EUR)";
        cols = ["", "", ""];
      } else if (b.asset.native || b.asset.symbol === "USDC") {
        eur = usdEur(l.amount, b.asset.decimals);
      } else {
        source = "no EUR value for this token";
        cols = ["", "", ""];
      }
      rows.push([
        "payment", date, time, data.chain.label, String(data.chain.id), data.hash, String(data.blockNumber), b.refText, b.sender, String(l.index + 1),
        l.to, l.label, b.asset.symbol, plainAmount(l.amount, b.asset.decimals), ...cols, eur, source, explorer,
      ]);
    }
  }
  if (!onlyTo) {
    rows.push([
      "network_fee", date, time, data.chain.label, String(data.chain.id), data.hash, String(data.blockNumber), data.batches[0]?.refText ?? "", data.from, "",
      "", "Arc network fee (paid in USDC)", "USDC", plainAmount(data.fee, NATIVE_DECIMALS, 2), ...rateCols(), usdEur(data.fee, NATIVE_DECIMALS),
      rate ? `${rate.source}; 1 USDC valued at 1 USD` : "unavailable", explorer,
    ]);
  }
  const csv = [header, ...rows].map((r) => r.map((v) => escapeCsv(v)).join(",")).join("\r\n") + "\r\n";
  return { csv, rateError };
}

function chainFromParam(param: string | null): ChainConfig {
  const id = Number(param);
  return supportedChain(id) ?? CHAINS[DEFAULT_CHAIN];
}

export function renderReceipt(root: HTMLElement, params: URLSearchParams): () => void {
  const hash = (params.get("tx") ?? "").trim() as Hex;
  const chain = chainFromParam(params.get("chain"));
  const onlyTo = params.get("to") ?? undefined;
  let data: ReceiptData | null = null;

  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) {
    clear(root, h("section", { class: "card narrow" }, h("h1", {}, "Receipt"), h("p", { class: "notice notice-bad" }, icon("alert"), "That is not a valid transaction hash.")));
    return () => undefined;
  }

  const load = async () => {
    clear(root, h("section", { class: "card narrow loading" }, icon("spinner", "icon spin big"), h("p", {}, `Reading transaction from ${chain.label}…`)));
    try {
      data = await loadReceipt(chain, hash);
      draw(data);
    } catch (err) {
      const msg = String((err as Error)?.message || err);
      const notFound = /could not be found|not found|TransactionReceiptNotFound/i.test(msg);
      clear(
        root,
        h(
          "section",
          { class: "card narrow" },
          h("h1", {}, "Receipt"),
          h(
            "div",
            { class: "notice notice-bad" },
            icon("alert"),
            notFound
              ? `No transaction ${shortAddress(hash)} was found on ${chain.label}. Check the hash and the network.`
              : `Could not read the transaction from ${chain.label}. If you use an ad or privacy blocker, allow ${new URL(chain.rpcUrl).host}, or connect your wallet on ${chain.label} and retry.`,
          ),
          h("button", { class: "btn btn-secondary", onclick: () => void load() }, "Retry"),
        ),
      );
    }
  };

  function draw(d: ReceiptData) {
    const isAdvice = !!onlyTo;
    const batches = d.batches.map((b) => ({ ...b, lines: onlyTo ? b.lines.filter((l) => l.to.toLowerCase() === onlyTo.toLowerCase()) : b.lines }));
    const shown = batches.filter((b) => b.lines.length);
    const title = isAdvice ? "Payment advice" : "Payment receipt";
    const link = location.href;

    const meta = (label: string, value: Node | string) => h("div", { class: "meta-item" }, h("dt", {}, label), h("dd", {}, value));
    const statusNode =
      d.status === "success"
        ? h("span", { class: "status-ok" }, icon("check"), "Confirmed")
        : h("span", { class: "status-bad" }, icon("alert"), "Failed: nothing was paid");

    const actions = h(
      "div",
      { class: "row-actions receipt-actions no-print" },
      h("button", { class: "btn btn-primary", id: "print-btn", onclick: () => window.print() }, icon("printer"), "Print or save as PDF"),
      h(
        "button",
        {
          class: "btn btn-secondary",
          id: "export-btn",
          disabled: !d.batches.length,
          onclick: async (e: Event) => {
            const btn = e.currentTarget as HTMLButtonElement;
            btn.disabled = true;
            const { csv, rateError } = await accountingCsv(d, onlyTo);
            download(`remitsheet-${utcDate(d.timestamp)}-${d.hash.slice(2, 10)}${onlyTo ? "-" + onlyTo.slice(2, 8) : ""}.csv`, csv);
            btn.disabled = false;
            toast(rateError ?? "Accounting CSV downloaded");
          },
        },
        icon("download"),
        "Accounting CSV (EUR)",
      ),
      h("button", { class: "btn btn-ghost", onclick: () => void copyText(link, "Receipt link copied") }, icon("link"), "Copy link"),
      !isAdvice && d.batches.length === 1
        ? h("label", { class: "btn btn-ghost", for: "labels-file", title: "Match labels from your original CSV by address and amount" }, icon("upload"), "Add labels from CSV")
        : null,
      h("input", {
        type: "file",
        id: "labels-file",
        class: "visually-hidden",
        accept: ".csv,.tsv,.txt,text/csv",
        onchange: async (e: Event) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          if (!file || !data) return;
          attachLabels(data, await file.text());
          draw(data);
        },
      }),
    );

    clear(
      root,
      actions,
      h(
        "article",
        { class: "receipt card" },
        h(
          "header",
          { class: "receipt-head" },
          h("div", { class: "receipt-brand" }, h("img", { src: "logo.svg", alt: "", width: 32, height: 32 }), h("div", {}, h("h1", {}, title), h("span", { class: "muted" }, `Remitsheet · ${d.chain.label}`))),
          h("div", { class: "receipt-total" }, ...shown.map((b) => h("div", {}, h("strong", { class: "mono" }, formatAmount(b.lines.reduce((s, l) => s + l.amount, 0n), b.asset.decimals, 2, 6)), " ", b.asset.symbol))),
        ),
        d.ignoredEmitters.length
          ? h("div", { class: "notice notice-warn" }, icon("alert"), "This transaction also contains payment events from a contract that is not Remitsheet. They are not shown, because they cannot be verified.")
          : null,
        !d.batches.length && d.status === "success"
          ? h("div", { class: "notice notice-warn" }, icon("info"), "This transaction contains no Remitsheet payments.")
          : null,
        h(
          "dl",
          { class: "meta" },
          meta("Status", statusNode),
          meta("Date (UTC)", `${utcDate(d.timestamp)} ${utcTime(d.timestamp)}`),
          meta("From", extLink(addressUrl(d.chain, d.from), d.from, "mono")),
          ...shown.map((b) => meta("Reference", b.refText || "—")),
          ...shown.map((b) => meta(isAdvice ? "Paid to" : "Recipients", isAdvice ? extLink(addressUrl(d.chain, onlyTo!), getAddress(onlyTo!), "mono") : `${b.count}`)),
          !isAdvice ? meta("Network fee", `${formatAmount(d.fee, NATIVE_DECIMALS, 4, 6)} USDC`) : null,
          meta("Transaction", extLink(txUrl(d.chain, d.hash), h("span", { class: "mono break" }, d.hash))),
          meta("Block", String(d.blockNumber)),
          ...shown.map((b) => meta("Contract", extLink(addressUrl(d.chain, b.emitter), b.emitter, "mono"))),
        ),
        ...shown.map((b) =>
          h(
            "table",
            { class: "lines receipt-lines" },
            h("thead", {}, h("tr", {}, h("th", { class: "num" }, "#"), h("th", {}, "Recipient"), h("th", {}, "Label"), h("th", { class: "num" }, `Amount (${b.asset.symbol})`), h("th", { class: "no-print" }, ""))),
            h(
              "tbody",
              {},
              b.lines.map((l) =>
                h(
                  "tr",
                  {},
                  h("td", { class: "num muted" }, l.index + 1),
                  h("td", { class: "mono" }, extLink(addressUrl(d.chain, l.to), l.to)),
                  h("td", {}, l.label || h("span", { class: "muted" }, "—")),
                  h("td", { class: "num mono" }, formatAmount(l.amount, b.asset.decimals, 2, 6)),
                  h(
                    "td",
                    { class: "no-print" },
                    !isAdvice
                      ? h(
                          "button",
                          {
                            class: "link-btn",
                            title: "Copy a link that shows only this recipient's line",
                            onclick: () => {
                              const u = new URL(location.href);
                              u.searchParams.set("to", l.to);
                              void copyText(u.toString(), "Payment advice link copied");
                            },
                          },
                          "Advice link",
                        )
                      : null,
                  ),
                ),
              ),
            ),
            h("tfoot", {}, h("tr", {}, h("td", {}), h("td", { colspan: 2 }, "Total"), h("td", { class: "num mono" }, formatAmount(b.lines.reduce((s, l) => s + l.amount, 0n), b.asset.decimals, 2, 6)), h("td", { class: "no-print" }))),
          ),
        ),
        h(
          "footer",
          { class: "receipt-foot" },
          h(
            "p",
            {},
            `Generated from ${d.chain.label} transaction ${d.hash}. The amounts above are read directly from the blockchain and can be checked by anyone`,
            d.chain.explorer ? ` at ${txUrl(d.chain, d.hash)}` : "",
            ". Labels are added by the sender and are not stored on-chain.",
          ),
        ),
      ),
      isAdvice
        ? h("p", { class: "fine no-print" }, h("a", { href: location.pathname + location.search.replace(/[?&]to=[^&]*/, "").replace(/^&/, "?"), onclick: (e: Event) => { e.preventDefault(); const u = new URL(location.href); u.searchParams.delete("to"); navigate(u.pathname + u.search); } }, "Show the full receipt"))
        : null,
    );
  }

  void load();
  const off = onWalletChange(() => undefined);
  return () => off();
}

/** Matches labels from a CSV to receipt lines by address and amount (each CSV row used once). */
export function attachLabels(data: ReceiptData, csvText: string): number {
  const sheet = parseSheet(csvText, { maxRows: 100000 });
  const pool = sheet.rows.filter((r) => r.address && r.amount && r.label);
  let matched = 0;
  for (const b of data.batches) {
    const scale = b.asset.decimals >= TOKEN_DECIMALS ? 10n ** BigInt(b.asset.decimals - TOKEN_DECIMALS) : 1n;
    for (const l of b.lines) {
      const i = pool.findIndex((r) => r.address!.toLowerCase() === l.to.toLowerCase() && r.amount! * scale === l.amount);
      if (i >= 0) {
        l.label = pool[i].label;
        pool.splice(i, 1);
        matched++;
      }
    }
  }
  if (data.batches.length === 1) storageSet(`remitsheet:labels:${data.hash.toLowerCase()}`, data.batches[0].lines.map((l) => l.label));
  toast(`${matched} label${matched === 1 ? "" : "s"} matched`);
  return matched;
}

export function renderReceiptLookup(root: HTMLElement): () => void {
  const chains = [CHAINS[ARC_MAINNET], CHAINS[ARC_TESTNET], ...(devMode() ? [CHAINS[LOCAL_CHAIN]] : [])];
  const input = h("input", { class: "input mono", id: "tx-input", placeholder: "0x… transaction hash", "aria-label": "Transaction hash" }) as HTMLInputElement;
  const select = h("select", { class: "input", id: "chain-select", "aria-label": "Network" }, chains.map((c) => h("option", { value: String(c.id) }, c.label))) as HTMLSelectElement;
  const error = h("p", { class: "fine error" });
  const open = () => {
    const v = input.value.trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(v)) {
      error.textContent = "Enter a 66-character transaction hash starting with 0x.";
      return;
    }
    const dev = devMode() && new URLSearchParams(location.search).has("dev") ? "&dev=1" : "";
    navigate(`${location.pathname}?tx=${v}&chain=${select.value}${dev}`);
  };
  input.addEventListener("keydown", (e) => e.key === "Enter" && open());
  const recent = storageGet<RecentBatch[]>(RECENT_KEY, []);
  clear(
    root,
    h(
      "section",
      { class: "card narrow" },
      h("h1", {}, "Find a receipt"),
      h("p", { class: "muted" }, "Any Remitsheet batch can be turned into a receipt from its transaction hash. Nothing is stored on a server: the receipt is rebuilt from the blockchain each time."),
      h("div", { class: "lookup" }, input, select, h("button", { class: "btn btn-primary", onclick: open }, "Open receipt")),
      error,
    ),
    recent.length
      ? h(
          "section",
          { class: "card narrow" },
          h("h2", {}, "Sent from this browser"),
          h(
            "table",
            { class: "lines" },
            h("thead", {}, h("tr", {}, h("th", {}, "Date (UTC)"), h("th", {}, "Reference"), h("th", { class: "num" }, "Recipients"), h("th", { class: "num" }, "Total"), h("th", {}, ""))),
            h(
              "tbody",
              {},
              recent.map((r) => {
                const href = `${location.pathname}?tx=${r.hash}&chain=${r.chainId}${new URLSearchParams(location.search).has("dev") ? "&dev=1" : ""}`;
                return h(
                  "tr",
                  {},
                  h("td", {}, `${utcDate(r.timestamp)} ${utcTime(r.timestamp).slice(0, 5)}`),
                  h("td", {}, r.ref || "—"),
                  h("td", { class: "num" }, r.count),
                  h("td", { class: "num mono" }, `${r.total} ${r.asset}`),
                  h("td", {}, h("a", { href, onclick: (e: Event) => (e.preventDefault(), navigate(href)) }, "Receipt")),
                );
              }),
            ),
          ),
          h("p", { class: "fine" }, "This list lives only in this browser."),
        )
      : null,
  );
  return () => undefined;
}
