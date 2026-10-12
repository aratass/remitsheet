# DoraHacks BUIDL submission: Arc Microgrants

Copy each field into the BUIDL form at https://dorahacks.io/hackathon/arc-microgrants (button "Submit BUIDL"). All links below are filled in (contract deployed and first mainnet batch paid on 12 Oct 2026).

## Program checklist (from the published rules)

| Rule | How Remitsheet meets it |
|---|---|
| "Projects must be deployed and functional on the Arc Mainnet" | Contract deployed on Arc mainnet (chain 5042) and a real batch paid on mainnet (https://aratass.github.io/remitsheet/?tx=0xca6f87f27b3ea0b37e131143608ad471ce9e7cadeb8bcc6e67d901b68060e8e1&chain=5042) |
| "The project must have a genuine Arc component" | Native USDC gas and payouts, EURC on Arc, Arc network config, Arc-specific decimals and blocklist handling |
| "a deployable link and a public code repository" | `https://aratass.github.io/remitsheet/` and `https://github.com/aratass/remitsheet` |
| "Each project can have only one submission" | One BUIDL |
| "Applicants must have a compatible wallet to receive USDC on Arc" | Payout address `0x014B4B400e7Ff5dB666af4e16e6C91b8443b24E6` |
| "Projects already funded through a Circle or Arc program are not eligible" | Not funded by any program |

## Form fields

**BUIDL name**
Remitsheet

**Tagline** (96 characters)
Pay a whole spreadsheet in USDC or EURC with one Arc transaction, with receipts and EUR exports.

**Logo**
`submission/logo-512.png` (512 × 512)

**Cover / banner image**
`submission/cover-1280x720.png` (1280 × 720)

**Category / tags**
Payments, Stablecoins, Payroll, Developer tools, USDC, EURC, Arc

**Links**
- Live app: https://aratass.github.io/remitsheet/
- GitHub: https://github.com/aratass/remitsheet
- Contract on Arc mainnet: https://explorer.arc.io/address/0x015153204C9A1cBAefB959782490db74cD1a7DF5
- Example mainnet receipt: https://aratass.github.io/remitsheet/?tx=0xca6f87f27b3ea0b37e131143608ad471ce9e7cadeb8bcc6e67d901b68060e8e1&chain=5042
- Deployment transaction: https://explorer.arc.io/tx/0xd8244a7e07fba766ec2611acf51c133c925d42ce8d23a2d48043a48013157268

**Team**
Solo: Arminas Attas, software and data engineer.

**Payout wallet (USDC on Arc)**
0x014B4B400e7Ff5dB666af4e16e6C91b8443b24E6

**Is this project new?**
Yes, built for this program in October 2026. It has not received funding from Circle, Arc or any other program.

### Description (about 520 words)

Paying many people is still a chore in crypto. Teams that pay contractors, bounty winners, grant tranches or a monthly payroll in stablecoins end up sending dozens of transfers one by one. Then they rebuild the paperwork by hand, because a wallet history is not something an accountant can book.

Remitsheet turns that into three steps.

**1. Paste the sheet.** Export the payout tab of your spreadsheet (`address, amount, label`) and paste or upload it. Every line is checked before anything can be sent:
- address format and EIP-55 checksum, and the zero address;
- duplicate recipients, zero or negative amounts, and more than six decimals;
- amounts silently split by an unquoted thousands separator;
- addresses that are token or system contracts rather than people.

The batch is then simulated. If any recipient would reject the payment, the failing line is highlighted and the Pay button stays disabled.

**2. Pay in one transaction.** On Arc, USDC is the native currency, so a USDC batch is a single wallet confirmation: up to 300 recipients, final as soon as it is included. EURC, Circle's euro stablecoin on Arc, is paid through its token contract: one approval of the exact total, then one batch. Either every line is paid or nothing moves. The contract has no owner, no fees and no upgrade path, and it never holds funds between transactions.

**3. Keep the paperwork.** Every batch gets a receipt page rebuilt from the chain, so anyone with the link can verify it. It prints cleanly to PDF. Each recipient can be sent a payment advice link that shows only their own line. One click exports an accounting CSV: date and time in UTC, transaction hash, reference, recipient, label, amount, and the EUR value at the European Central Bank reference rate for that day, with the rate and its source in every row. Labels never go on-chain.

**Why Arc.**
- Gas is paid in USDC, so the payer needs nothing but the dollars being paid out. A 200-line batch costs about 0.05 to 0.15 USDC at the 20 gwei minimum base fee.
- Finality on inclusion means a receipt is a settled payment.
- Native EURC makes euro payroll and the EUR export natural for European teams.

Remitsheet handles Arc's specifics:
- 18-decimal native USDC versus the 6-decimal ERC-20 interface;
- reverts on blocklisted addresses and on the zero address, caught in simulation;
- network setup in the wallet.

**Trust and openness.** The contract is about 70 lines of Solidity with no dependencies. It has 32 Foundry tests: unit, fuzz at 10,000 runs, reentrancy by recipients and by tokens, tokens that return false or nothing, a return-data bomb, and gas for 200 recipients. It is deployed through the standard CREATE2 factory, so it has the same address on every chain. The app checks the code hash before trusting an address or a receipt.

The web app is static, with no backend, no accounts and no tracking, and it is tested end to end with Playwright against a local node. The code is MIT licensed.

**What's next:**
- EIP-2612 permit for single-signature EURC batches;
- Safe multisig proposals;
- recurring payroll templates;
- export presets for common accounting tools.

### How it uses Arc (short field, if asked)

- Contract: Remitsheet is deployed on Arc mainnet at `0x015153204C9A1cBAefB959782490db74cD1a7DF5`.
- USDC batches use native USDC (18 decimals) via `payNative`, in one transaction, with gas also paid in USDC.
- EURC batches use EURC on Arc (`0xbEf5…21c1`) via `payToken`.
- The app adds Arc mainnet (chain 5042) to the wallet, reads receipts from Arc's public RPC, and links every line to explorer.arc.io.

### Tech stack

- **Contract:** Solidity 0.8.30, tested with Foundry (forge, anvil).
- **Web app:** TypeScript, viem, plain DOM with no framework, bundled with esbuild, hosted on GitHub Pages.
- **Wallets:** EIP-6963 wallet discovery (Rabby, MetaMask).
- **Tests and data:** Playwright end-to-end tests against Anvil. ECB reference rates via Frankfurter, with the ECB Data Portal as a fallback.

### Demo video (if the form has a video field)

`submission/demo-local-chain.mp4`: 58 seconds, captioned, 1280 × 800. It shows deploy, validation, a 5-recipient USDC batch, the receipt, the CSV export, a payment advice, an EURC batch and a failing recipient caught before signing.
- It was recorded on a local test chain, and its first caption says so.
- The form usually wants a link, so upload it to YouTube as **Unlisted** and paste the link.

### Screenshots to upload (1280 × 800)

The first one is the real Arc mainnet receipt (12 Oct 2026). The others were taken by the end-to-end test on a local test chain; the network badge in them reads "Local test chain".

0. `submission/screenshots/00-mainnet-receipt.png`: the first mainnet batch, receipt rebuilt from Arc mainnet
1. `submission/screenshots/04-review.png`: sheet checked, fee estimate, ready to pay
2. `submission/screenshots/03-validation.png`: line-by-line validation
3. `submission/screenshots/05-paid.png`: one transaction, every line paid
4. `submission/screenshots/06-receipt.png`: receipt rebuilt from the chain
5. `submission/screenshots/09-failing-line.png`: a recipient that would reject the payment is caught before sending
6. `submission/screenshots/08-eurc-receipt.png`: EURC batch
7. `submission/screenshots/01-deploy.png`: one-click deterministic deployment

Also available: `submission/receipt-example.pdf` (printed receipt), `submission/accounting-example.csv` (export).

