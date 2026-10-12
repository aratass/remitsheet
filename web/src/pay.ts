import { getAddress, keccak256, slice, toHex } from "viem";
import { CHAINS, DEFAULT_CHAIN, MAX_ROWS, NATIVE_DECIMALS, TOKEN_DECIMALS, supportedChain, txUrl, type ChainConfig, type Hex } from "./config";
import { ERC20_ABI, deploymentStatus, explainError, readClient, writeClient } from "./chain";
import { parseSheet, payableRows, type Sheet } from "./csv";
import { encodeRef, formatAmount, refByteLength, shortAddress, todayLabel } from "./format";
import { CREATE2_FACTORY, REMITSHEET_ABI } from "./generated/remitsheet";
import { navigate, openWalletPicker } from "./main";
import { RECENT_KEY, type RecentBatch } from "./receipt";
import { clear, download, extLink, h, icon, storageGet, storageSet } from "./ui";
import { onWalletChange, switchTo, wallet } from "./wallet";

type Asset = "USDC" | "EURC";
const DRAFT_KEY = "remitsheet:draft";
const SCALE = 10n ** BigInt(NATIVE_DECIMALS - TOKEN_DECIMALS); // 6-decimal sheet amounts -> 18-decimal native

/** Example rows use addresses nobody controls; they are blocked so they cannot be paid by mistake. */
const EXAMPLE_ADDRESSES = [1, 2, 3, 4, 5].map((i) => getAddress(slice(keccak256(toHex(`remitsheet example ${i}`)), 12)));
const EXAMPLE_LABELS = ["Ana Petrova · logo design", "Jonas K. · backend sprint 41", "Mia Rossi · translation DE", "Grant: docs bounty #12", "Leo Martin · QA October"];
const EXAMPLE_AMOUNTS = ["1200.00", "2450.50", "380.00", "500.00", "715.25"];
export const EXAMPLE_CSV =
  "address,amount,label\n" + EXAMPLE_ADDRESSES.map((a, i) => `${a},${EXAMPLE_AMOUNTS[i]},${EXAMPLE_LABELS[i]}`).join("\n") + "\n";

function blockedAddresses(chain: ChainConfig | undefined): Map<string, string> {
  const m = new Map<string, string>();
  const c = chain ?? CHAINS[DEFAULT_CHAIN];
  m.set(c.remitsheet.toLowerCase(), "This is the Remitsheet contract itself, not a recipient.");
  if (c.usdcErc20) m.set(c.usdcErc20.toLowerCase(), "This is the USDC token contract, not a person's wallet.");
  if (c.eurc) m.set(c.eurc.toLowerCase(), "This is the EURC token contract, not a person's wallet.");
  m.set(CREATE2_FACTORY.toLowerCase(), "This is a deployment contract, not a recipient.");
  m.set("0xfffffffffffffffffffffffffffffffffffffffe", "This is an Arc system address, not a recipient.");
  for (const a of EXAMPLE_ADDRESSES) m.set(a.toLowerCase(), "Example address: replace it with a real recipient.");
  return m;
}

type StepState = "todo" | "active" | "done" | "error";

export function renderPay(root: HTMLElement): () => void {
  let text = storageGet<string>(DRAFT_KEY, "");
  let asset: Asset = "USDC";
  let reference = `Payout ${todayLabel()}`;
  let allowDuplicates = false;
  let sheet: Sheet = parseSheet(text, { blocked: blockedAddresses(supportedChain(wallet.chainId)) });
  let busy = false;
  let quoteSeq = 0;
  let steps: { label: string; state: StepState; detail?: string }[] = [];
  let failure: { message: string; row?: number } | null = null;
  let success: { hash: Hex; chain: ChainConfig; count: number; total: bigint; asset: Asset } | null = null;
  let quote: { fee?: bigint; feeApprox?: boolean; balance?: bigint; gasBalance?: bigint; contract?: string; error?: string; errorRow?: number } = {};

  // ------------------------------------------------------------------ layout
  const textarea = h("textarea", {
    id: "sheet-input",
    class: "sheet-input mono",
    spellcheck: "false",
    placeholder: "address,amount,label\n0x1234…abcd,120.00,Ana · October invoice\n0x5678…ef01,80.50,Jonas · bug bounty",
    "aria-label": "Payment sheet (CSV)",
  }) as HTMLTextAreaElement;
  textarea.value = text;
  textarea.addEventListener("input", () => setText(textarea.value, false));

  const fileInput = h("input", { type: "file", accept: ".csv,.tsv,.txt,text/csv", class: "visually-hidden", id: "csv-file" }) as HTMLInputElement;
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 2_000_000) {
      failure = { message: "That file is larger than 2 MB. A payment sheet should be much smaller." };
      updatePanel();
      return;
    }
    setText(await file.text(), true);
    fileInput.value = "";
  });

  const summary = h("div", { class: "summary", id: "sheet-summary" });
  const tableWrap = h("div", { class: "table-wrap", id: "preview" });
  const panel = h("aside", { class: "card pay-panel", id: "pay-panel" });

  clear(
    root,
    h(
      "section",
      { class: "hero" },
      h("h1", {}, "Pay a whole spreadsheet in one Arc transaction"),
      h(
        "p",
        { class: "lead" },
        "Paste or upload a list of addresses and amounts. Remitsheet checks every line, pays everyone at once in USDC or EURC, and gives you a receipt and an accounting export with EUR values.",
      ),
    ),
    h(
      "div",
      { class: "pay-grid" },
      h(
        "div",
        { class: "pay-main" },
        h(
          "section",
          { class: "card" },
          h("div", { class: "card-head" }, h("h2", {}, h("span", { class: "step-no" }, "1"), "Recipients"), h("span", { class: "hint" }, "CSV: address, amount, optional label")),
          textarea,
          h(
            "div",
            { class: "row-actions" },
            h("label", { class: "btn btn-secondary", for: "csv-file" }, icon("upload"), "Upload CSV"),
            fileInput,
            h("button", { class: "btn btn-ghost", onclick: () => setText(EXAMPLE_CSV, true) }, icon("sheet"), "Load example"),
            h("button", { class: "btn btn-ghost", onclick: () => download("remitsheet-template.csv", "address,amount,label\n") }, icon("download"), "Template"),
            h("button", { class: "btn btn-ghost", id: "clear-btn", onclick: () => setText("", true) }, "Clear"),
          ),
          h(
            "p",
            { class: "fine" },
            `Amounts use a dot for decimals (up to 6 places), no thousands separators. Comma, semicolon or tab separated; a header row is optional. Up to ${MAX_ROWS} recipients per batch.`,
          ),
        ),
        h(
          "section",
          { class: "card" },
          h("div", { class: "card-head" }, h("h2", {}, h("span", { class: "step-no" }, "2"), "Review"), summary),
          tableWrap,
        ),
      ),
      panel,
    ),
  );

  // ------------------------------------------------------------------ behaviour
  function setText(value: string, replaceTextarea: boolean) {
    text = value;
    if (replaceTextarea) textarea.value = value;
    storageSet(DRAFT_KEY, value);
    success = null;
    failure = null;
    reparse();
  }

  function reparse() {
    sheet = parseSheet(text, { blocked: blockedAddresses(supportedChain(wallet.chainId)) });
    updateTable();
    updatePanel();
    void refreshQuote();
  }

  function updateTable() {
    const total = formatAmount(sheet.total, TOKEN_DECIMALS);
    const rows = sheet.rows;
    clear(
      summary,
      h("span", { class: "chip" }, `${payableRows(sheet).length} recipient${payableRows(sheet).length === 1 ? "" : "s"}`),
      h("span", { class: "chip" }, `${total} ${asset}`),
      sheet.errorCount ? h("span", { class: "chip chip-error" }, `${sheet.errorCount} with errors`) : null,
      sheet.warningCount ? h("span", { class: "chip chip-warn" }, `${sheet.warningCount} warnings`) : null,
    );
    if (!rows.length) {
      clear(tableWrap, h("div", { class: "empty" }, icon("sheet", "icon big"), h("p", {}, "Your recipients will appear here for review."), h("p", { class: "fine" }, "Tip: export the payout tab of your spreadsheet as CSV and drop it in above.")));
      return;
    }
    const highlight = failure?.row ?? quote.errorRow;
    clear(
      tableWrap,
      h(
        "table",
        { class: "lines" },
        h("thead", {}, h("tr", {}, h("th", { class: "num" }, "Line"), h("th", {}, "Recipient"), h("th", {}, "Label"), h("th", { class: "num" }, `Amount (${asset})`), h("th", { class: "center" }, "Check"))),
        h(
          "tbody",
          {},
          rows.map((r) => {
            const simFailure = highlight === r.line && !r.errors.length ? (failure?.message ?? quote.error ?? "") : "";
            const state = r.errors.length || simFailure ? "bad" : r.warnings.length ? "warn" : "";
            const main = h(
              "tr",
              { class: state, "data-line": r.line, ...(highlight === r.line ? { id: "failing-row" } : {}) },
              h("td", { class: "num muted" }, r.line),
              h("td", { class: "mono addr", title: r.address ?? r.addressText }, r.address ? r.address : r.addressText || "—"),
              h("td", { class: "label-cell" }, r.label || h("span", { class: "muted" }, "—")),
              h("td", { class: "num mono" }, r.amount ? formatAmount(r.amount, TOKEN_DECIMALS) : r.amountText || "—"),
              h(
                "td",
                { class: "center" },
                r.errors.length || simFailure
                  ? h("span", { class: "status-bad", title: "Error" }, icon("alert"))
                  : r.warnings.length
                    ? h("span", { class: "status-warn", title: "Warning" }, icon("info"))
                    : h("span", { class: "status-ok", title: "OK" }, icon("check")),
              ),
            );
            if (!state) return main;
            const messages = [...r.errors, ...(simFailure ? [simFailure] : []), ...r.warnings].join(" ");
            return [main, h("tr", { class: `msg-row ${state}` }, h("td", {}), h("td", { colspan: 4 }, messages))];
          }),
        ),
        h(
          "tfoot",
          {},
          h("tr", {}, h("td", {}), h("td", { colspan: 2 }, "Total"), h("td", { class: "num mono" }, formatAmount(sheet.total, TOKEN_DECIMALS)), h("td", {})),
        ),
      ),
    );
    document.getElementById("failing-row")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function removeErrorLines() {
    const bad = new Set(sheet.rows.filter((r) => r.errors.length).map((r) => r.line));
    const lines = text.replace(/\r/g, "").split("\n");
    setText(lines.filter((_, i) => !bad.has(i + 1)).join("\n"), true);
  }

  function hasDuplicates() {
    return sheet.rows.some((r) => r.warnings.some((w) => /more than once/.test(w)));
  }

  function refBytesOk() {
    return refByteLength(reference.trim()) <= 32;
  }

  async function refreshQuote() {
    const seq = ++quoteSeq;
    const chain = supportedChain(wallet.chainId);
    const rows = payableRows(sheet);
    if (!wallet.account || !chain) {
      quote = {};
      updatePanel();
      return;
    }
    const pc = readClient(chain);
    const next: typeof quote = {};
    try {
      const status = await deploymentStatus(chain);
      next.contract = status;
      next.gasBalance = await pc.getBalance({ address: wallet.account });
      if (asset === "USDC") next.balance = next.gasBalance;
      else if (chain.eurc) next.balance = (await pc.readContract({ address: chain.eurc, abi: ERC20_ABI, functionName: "balanceOf", args: [wallet.account] })) as bigint;

      if (status === "live" && rows.length && !sheet.errorCount) {
        const gasPrice = await pc.getGasPrice();
        const to = rows.map((r) => r.address);
        const ref = encodeRef(refBytesOk() ? reference : "");
        if (asset === "USDC") {
          const amounts = rows.map((r) => r.amount * SCALE);
          const value = amounts.reduce((a, b) => a + b, 0n);
          const gas = await pc.estimateContractGas({ address: chain.remitsheet, abi: REMITSHEET_ABI, functionName: "payNative", args: [to, amounts, ref], value, account: wallet.account });
          next.fee = gas * gasPrice;
        } else if (chain.eurc) {
          const amounts = rows.map((r) => r.amount);
          const total = amounts.reduce((a, b) => a + b, 0n);
          const allowance = (await pc.readContract({ address: chain.eurc, abi: ERC20_ABI, functionName: "allowance", args: [wallet.account, chain.remitsheet] })) as bigint;
          if (allowance >= total) {
            const gas = await pc.estimateContractGas({ address: chain.remitsheet, abi: REMITSHEET_ABI, functionName: "payToken", args: [chain.eurc, to, amounts, ref], account: wallet.account });
            next.fee = gas * gasPrice;
          } else {
            // Before approval the batch cannot be simulated; use a conservative upper bound.
            next.fee = (60_000n + 40_000n + 32_000n * BigInt(rows.length)) * gasPrice;
            next.feeApprox = true;
          }
        }
      }
    } catch (err) {
      const explained = explainError(err, rows.map((r) => r.line), asset);
      next.error = explained.message;
      next.errorRow = explained.row;
    }
    if (seq !== quoteSeq) return;
    const rowChanged = quote.errorRow !== next.errorRow;
    quote = next;
    if (rowChanged) updateTable();
    updatePanel();
  }

  function stepList() {
    return h(
      "ol",
      { class: "steps" },
      steps.map((s) =>
        h(
          "li",
          { class: `step step-${s.state}` },
          s.state === "active" ? icon("spinner", "icon spin") : s.state === "done" ? icon("check") : s.state === "error" ? icon("alert") : h("span", { class: "step-dot" }),
          h("span", {}, s.label, s.detail ? h("span", { class: "step-detail" }, s.detail) : null),
        ),
      ),
    );
  }

  function updatePanel() {
    const chain = supportedChain(wallet.chainId);
    const rows = payableRows(sheet);
    const eurcAvailable = !!(chain ?? CHAINS[DEFAULT_CHAIN]).eurc;
    const assetButtons = h(
      "div",
      { class: "segmented", role: "radiogroup", "aria-label": "Asset" },
      (["USDC", "EURC"] as Asset[]).map((a) =>
        h(
          "button",
          {
            class: asset === a ? "seg active" : "seg",
            role: "radio",
            "aria-checked": String(asset === a),
            disabled: busy || (a === "EURC" && !eurcAvailable),
            onclick: () => {
              asset = a;
              success = null;
              failure = null;
              updateTable();
              updatePanel();
              void refreshQuote();
            },
          },
          h("strong", {}, a),
          h("small", {}, a === "USDC" ? "1 transaction" : "approve + pay"),
        ),
      ),
    );
    const refInput = h("input", { id: "ref-input", class: "input", value: reference, maxlength: 64, disabled: busy, "aria-label": "Batch reference" }) as HTMLInputElement;
    const refCounter = h("span", { class: refBytesOk() ? "fine" : "fine error" }, `${refByteLength(reference.trim())}/32 bytes · stored on-chain with the batch`);
    refInput.addEventListener("input", () => {
      reference = refInput.value;
      refCounter.textContent = `${refByteLength(reference.trim())}/32 bytes · stored on-chain with the batch`;
      refCounter.className = refBytesOk() ? "fine" : "fine error";
      payBtn.toggleAttribute("disabled", !canPay());
    });

    const dupBox = hasDuplicates()
      ? h(
          "label",
          { class: "check" },
          h("input", {
            type: "checkbox",
            checked: allowDuplicates,
            disabled: busy,
            onchange: (e: Event) => {
              allowDuplicates = (e.target as HTMLInputElement).checked;
              payBtn.toggleAttribute("disabled", !canPay());
            },
          }),
          "Some addresses appear more than once. Pay each line anyway.",
        )
      : null;

    const total = sheet.total;
    const lines: (HTMLElement | null)[] = [
      h("div", { class: "kv" }, h("span", {}, "Recipients"), h("strong", {}, String(rows.length))),
      h("div", { class: "kv" }, h("span", {}, "Total"), h("strong", { class: "mono", id: "total-amount" }, `${formatAmount(total, TOKEN_DECIMALS)} ${asset}`)),
      h(
        "div",
        { class: "kv" },
        h("span", {}, "Network fee"),
        h("span", { class: "mono", id: "fee-estimate" }, quote.fee !== undefined ? `${quote.feeApprox ? "≤ " : "≈ "}${formatAmount(quote.fee, NATIVE_DECIMALS, 4, 6)} USDC` : wallet.account ? "—" : "connect to estimate"),
      ),
      wallet.account && quote.balance !== undefined
        ? h("div", { class: "kv" }, h("span", {}, `Your ${asset} balance`), h("span", { class: "mono" }, `${formatAmount(quote.balance, asset === "USDC" ? NATIVE_DECIMALS : TOKEN_DECIMALS, 2, 6)} ${asset}`))
        : null,
    ];

    const needed = asset === "USDC" ? total * SCALE + (quote.fee ?? 0n) : total;
    const short =
      !success && quote.balance !== undefined && total > 0n && quote.balance < needed
        ? `Not enough ${asset}: you need ${formatAmount(needed, asset === "USDC" ? NATIVE_DECIMALS : TOKEN_DECIMALS, 2, 6)}${asset === "USDC" ? " including the fee" : ""}.`
        : asset === "EURC" && quote.gasBalance !== undefined && quote.fee !== undefined && quote.gasBalance < quote.fee
          ? "You also need a little USDC on Arc to pay the network fee."
          : null;

    const payBtn = h(
      "button",
      { class: "btn btn-primary btn-lg", id: "pay-btn", disabled: !canPay(), onclick: () => void execute() },
      busy ? icon("spinner", "icon spin") : icon("check"),
      rows.length ? `Pay ${rows.length} recipient${rows.length === 1 ? "" : "s"}` : "Pay",
    );

    let action: HTMLElement;
    if (!wallet.account) {
      action = h("button", { class: "btn btn-primary btn-lg", onclick: () => openWalletPicker() }, icon("wallet"), "Connect wallet to pay");
    } else if (!chain) {
      action = h("button", { class: "btn btn-warn btn-lg", onclick: () => void switchTo(CHAINS[DEFAULT_CHAIN]).catch(() => undefined) }, icon("alert"), "Switch wallet to Arc");
    } else if (quote.contract === "missing") {
      action = h(
        "div",
        { class: "notice notice-warn" },
        icon("info"),
        h("span", {}, `Remitsheet is not deployed on ${chain.label} yet. `, h("a", { href: "#/deploy" }, "Deploy it in one click"), "."),
      );
    } else if (quote.contract === "foreign") {
      action = h("div", { class: "notice notice-bad" }, icon("alert"), "The contract at the configured address is not Remitsheet. Payments are disabled.");
    } else {
      action = payBtn;
    }

    const focused = document.activeElement as HTMLInputElement | null;
    const keepFocus = focused?.id === "ref-input" ? { start: focused.selectionStart, end: focused.selectionEnd } : null;
    clear(
      panel,
      h("h2", {}, h("span", { class: "step-no" }, "3"), "Pay"),
      h("label", { class: "field-label" }, "Asset"),
      assetButtons,
      h("label", { class: "field-label", for: "ref-input" }, "Reference"),
      refInput,
      refCounter,
      h("div", { class: "kvs" }, lines),
      sheet.errorCount
        ? h(
            "div",
            { class: "notice notice-bad" },
            icon("alert"),
            h("span", {}, `${sheet.errorCount} line${sheet.errorCount === 1 ? " has" : "s have"} errors. Fix ${sheet.errorCount === 1 ? "it" : "them"} or `, h("button", { class: "link-btn", onclick: removeErrorLines }, "remove those lines"), "."),
          )
        : null,
      short ? h("div", { class: "notice notice-warn" }, icon("alert"), short) : null,
      quote.error && !failure && !success ? h("div", { class: "notice notice-warn", id: "quote-error" }, icon("info"), quote.error) : null,
      dupBox,
      steps.length ? stepList() : null,
      failure ? h("div", { class: "notice notice-bad", id: "pay-error" }, icon("alert"), failure.message) : null,
      success ? successBox(success) : action,
      h(
        "p",
        { class: "fine" },
        icon("shield"),
        asset === "USDC"
          ? "All-or-nothing: either every line is paid in this one transaction, or nothing moves. Remitsheet never holds your funds."
          : "EURC needs an approval of the exact total first, then the batch. All-or-nothing; tokens move straight from your wallet to each recipient.",
      ),
    );
    if (keepFocus) {
      refInput.focus();
      refInput.setSelectionRange(keepFocus.start, keepFocus.end);
    }
  }

  function successBox(s: NonNullable<typeof success>) {
    const dev = new URLSearchParams(location.search).has("dev") ? "&dev=1" : "";
    const receiptHref = `${location.pathname}?tx=${s.hash}&chain=${s.chain.id}${dev}`;
    return h(
      "div",
      { class: "success", id: "pay-success" },
      h("div", { class: "success-head" }, icon("check", "icon big"), h("div", {}, h("strong", {}, `Paid ${s.count} recipient${s.count === 1 ? "" : "s"}`), h("span", {}, `${formatAmount(s.total, TOKEN_DECIMALS)} ${s.asset} · confirmed on ${s.chain.label}`))),
      h(
        "div",
        { class: "row-actions" },
        h("a", { class: "btn btn-primary", id: "open-receipt", href: receiptHref, onclick: (e: Event) => (e.preventDefault(), navigate(receiptHref)) }, "Open receipt"),
        txUrl(s.chain, s.hash) ? extLink(txUrl(s.chain, s.hash), h("span", {}, "Explorer ", icon("external")), "btn btn-secondary") : null,
      ),
      h("p", { class: "fine mono break" }, s.hash),
    );
  }

  function canPay() {
    return (
      !busy &&
      !!wallet.account &&
      !!supportedChain(wallet.chainId) &&
      quote.contract === "live" &&
      quote.errorRow === undefined &&
      payableRows(sheet).length > 0 &&
      sheet.errorCount === 0 &&
      refBytesOk() &&
      (!hasDuplicates() || allowDuplicates)
    );
  }

  function setStep(i: number, state: StepState, detail?: string) {
    steps[i] = { ...steps[i], state, detail };
    updatePanel();
  }

  async function execute() {
    const chain = supportedChain(wallet.chainId);
    if (!chain || !wallet.account || !canPay()) return;
    const rows = payableRows(sheet);
    const lines = rows.map((r) => r.line);
    const to = rows.map((r) => r.address);
    const labels = rows.map((r) => r.label);
    const ref = encodeRef(reference);
    const pc = readClient(chain);
    const wc = writeClient(chain);
    const account = wallet.account;
    busy = true;
    failure = null;
    success = null;
    steps =
      asset === "USDC"
        ? [{ label: "Check every line", state: "todo" }, { label: "Confirm in your wallet", state: "todo" }, { label: `Settle on ${chain.label}`, state: "todo" }]
        : [{ label: "Approve EURC (exact total)", state: "todo" }, { label: "Check every line", state: "todo" }, { label: "Confirm in your wallet", state: "todo" }, { label: `Settle on ${chain.label}`, state: "todo" }];
    updatePanel();
    let i = 0;
    try {
      let hash: Hex;
      if (asset === "USDC") {
        const amounts = rows.map((r) => r.amount * SCALE);
        const value = amounts.reduce((a, b) => a + b, 0n);
        setStep(i, "active");
        const { request } = await pc.simulateContract({ address: chain.remitsheet, abi: REMITSHEET_ABI, functionName: "payNative", args: [to, amounts, ref], value, account });
        setStep(i++, "done");
        setStep(i, "active");
        hash = await wc.writeContract({ ...request, account, chain: wc.chain });
      } else {
        const token = chain.eurc!;
        const amounts = rows.map((r) => r.amount);
        const total = amounts.reduce((a, b) => a + b, 0n);
        setStep(i, "active");
        const allowance = (await pc.readContract({ address: token, abi: ERC20_ABI, functionName: "allowance", args: [account, chain.remitsheet] })) as bigint;
        if (allowance < total) {
          const approveHash = await wc.writeContract({ address: token, abi: ERC20_ABI, functionName: "approve", args: [chain.remitsheet, total], account, chain: wc.chain });
          setStep(i, "active", "waiting for confirmation");
          const r = await pc.waitForTransactionReceipt({ hash: approveHash });
          if (r.status !== "success") throw new Error("The EURC approval failed on-chain.");
          setStep(i++, "done", "approved");
        } else {
          setStep(i++, "done", "already approved");
        }
        setStep(i, "active");
        const { request } = await pc.simulateContract({ address: chain.remitsheet, abi: REMITSHEET_ABI, functionName: "payToken", args: [token, to, amounts, ref], account });
        setStep(i++, "done");
        setStep(i, "active");
        hash = await wc.writeContract({ ...request, account, chain: wc.chain });
      }
      setStep(i++, "done");
      setStep(i, "active", shortAddress(hash));
      storageSet(`remitsheet:labels:${hash.toLowerCase()}`, labels);
      const receipt = await pc.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The transaction was included but reverted, so nothing was paid. Only the network fee was charged.");
      setStep(i, "done", `block ${receipt.blockNumber}`);
      success = { hash, chain, count: rows.length, total: sheet.total, asset };
      storageSet(DRAFT_KEY, "");
      const recent = storageGet<RecentBatch[]>(RECENT_KEY, []).filter((r) => r.hash !== hash);
      recent.unshift({ hash, chainId: chain.id, timestamp: Math.floor(Date.now() / 1000), count: rows.length, total: formatAmount(sheet.total, TOKEN_DECIMALS), asset, ref: reference.trim() });
      storageSet(RECENT_KEY, recent.slice(0, 50));
    } catch (err) {
      const explained = explainError(err, lines, asset);
      failure = explained;
      const active = steps.findIndex((s) => s.state === "active");
      if (active >= 0) steps[active] = { ...steps[active], state: "error" };
      if (explained.row) updateTable();
    } finally {
      busy = false;
      updatePanel();
      if (!success) void refreshQuote();
    }
  }

  updateTable();
  updatePanel();
  void refreshQuote();
  const off = onWalletChange(() => {
    reparse();
  });
  return () => off();
}
