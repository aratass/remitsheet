import { CHAINS, DEFAULT_CHAIN, MAX_ROWS, REPO_URL, addressUrl } from "./config";
import { clear, extLink, h, icon } from "./ui";

export function renderAbout(root: HTMLElement): () => void {
  const chain = CHAINS[DEFAULT_CHAIN];
  const section = (title: string, ...body: (Node | string | null)[]) => h("section", { class: "card narrow prose" }, h("h2", {}, title), ...body);
  clear(
    root,
    h(
      "section",
      { class: "hero narrow" },
      h("h1", {}, "How Remitsheet works"),
      h("p", { class: "lead" }, "Contractor invoices, bounty winners, grant tranches, payroll: when you owe many people, you usually end up making dozens of transfers and rebuilding the paperwork by hand. Remitsheet pays the whole list in one transaction and turns it into documents an accountant can use."),
    ),
    h(
      "div",
      { class: "how-steps narrow" },
      [
        ["sheet", "1. Paste your sheet", "address, amount, label. Every line is checked: address format and checksum, duplicates, zero or negative amounts, decimals, known contract addresses."],
        ["check", "2. Pay in one transaction", "Approve once in your wallet. Every recipient is paid in the same Arc transaction, or nobody is. The contract never holds your money."],
        ["printer", "3. Keep the paperwork", "A receipt page rebuilt from the chain, printable as PDF, a per-recipient payment advice link, and a CSV with EUR values at the ECB reference rate."],
      ].map(([i, t, d]) => h("div", { class: "how-step card" }, icon(i as "sheet", "icon big"), h("h3", {}, t), h("p", {}, d))),
    ),
    section(
      "Why Arc",
      h(
        "ul",
        {},
        h("li", {}, h("strong", {}, "Fees in USDC. "), "Arc uses USDC as its gas token, so the sender needs nothing but the dollars they are paying out. A 200-line batch costs cents."),
        h("li", {}, h("strong", {}, "Final on inclusion. "), "Arc blocks are final as soon as they are included (about every half second), so a receipt is a settled payment, not a pending one."),
        h("li", {}, h("strong", {}, "Dollars and euros. "), "USDC is paid natively; EURC (Circle's euro stablecoin) is paid through its token contract, which suits European teams and contractors."),
      ),
    ),
    section(
      "Safety",
      h(
        "ul",
        {},
        h("li", {}, h("strong", {}, "No custody. "), "Native USDC is forwarded within the same call; EURC moves directly from your wallet to each recipient. The contract has no balance, no owner, no admin keys, no fees and no upgrades."),
        h("li", {}, h("strong", {}, "All-or-nothing. "), "If any single line fails (for example an address that refuses payments), the whole transaction reverts and nothing is sent. The app simulates the batch first and points at the failing line."),
        h("li", {}, h("strong", {}, "Exact approvals. "), "For EURC the app asks you to approve exactly the batch total, never an unlimited amount."),
        h("li", {}, h("strong", {}, "Check your addresses. "), "Blockchain payments cannot be reversed. Mixed-case addresses are checked against their checksum, but a valid address of the wrong person cannot be detected."),
        h("li", {}, h("strong", {}, "Verified receipts. "), "Receipts only show events emitted by code whose hash matches Remitsheet, so a look-alike contract cannot fake a receipt."),
      ),
      h("p", { class: "fine" }, "The contract is open source with unit, fuzz and reentrancy tests, but it has not had a professional audit."),
    ),
    section(
      "The accounting export",
      h("p", {}, "One row per payment line plus one row for the network fee: date and time (UTC), transaction hash, block, batch reference, sender, recipient, label, asset, amount, and the EUR value."),
      h(
        "p",
        {},
        "USDC is valued at 1 USD and converted with the ECB euro foreign exchange reference rate for the transaction date (or the latest earlier rate on days without one), loaded in your browser from ",
        extLink("https://frankfurter.dev", "Frankfurter"),
        ", with the ECB Data Portal as a fallback. EURC is valued at par. The rate, its date and its source are written into every row.",
      ),
    ),
    section(
      "Limits and fees",
      h(
        "ul",
        {},
        h("li", {}, `Up to ${MAX_ROWS} recipients per batch, so a batch always fits in one transaction.`),
        h("li", {}, "Amounts have at most 6 decimals, the precision of USDC and EURC."),
        h("li", {}, "Remitsheet charges nothing. You pay only Arc's network fee, in USDC, shown before you confirm."),
        h("li", {}, "Labels stay in your browser and in your files; only addresses, amounts and the reference are on-chain, and they are public."),
      ),
    ),
    section(
      "Open source",
      h("p", {}, "MIT licensed. No backend, no accounts, no tracking: the site is static files talking to your wallet and to Arc's public RPC."),
      h("p", {}, extLink(REPO_URL, "Source code and tests"), " · ", extLink(addressUrl(chain, chain.remitsheet), "Contract on the Arc explorer")),
    ),
  );
  return () => undefined;
}
