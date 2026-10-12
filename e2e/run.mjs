// End-to-end test: local Anvil node + the built site (docs/) + an injected EIP-6963 test wallet.
// Deploys Remitsheet through the CREATE2 factory from the Deploy page, pays a 5-recipient USDC batch,
// opens and prints the receipt, exports the accounting CSV, pays an EURC batch (approve + pay),
// opens a per-recipient payment advice and checks that a failing recipient is caught before sending.
// Screenshots (1280x800) go to submission/screenshots/, other output to e2e/output/.
//
// Usage: npm run build && npm run test:e2e   (needs `anvil` on PATH or ANVIL=/path/to/anvil)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { chromium } from "playwright";
import { createPublicClient, createWalletClient, getAddress, http, keccak256, slice, toHex } from "viem";
import { foundry } from "viem/chains";
import { startServer } from "../scripts/serve.mjs";

const root = new URL("..", import.meta.url).pathname;
const out = `${root}e2e/output`;
const shots = `${root}submission/screenshots`;
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
mkdirSync(shots, { recursive: true });

const RPC = "http://127.0.0.1:8545";
const SITE = "http://127.0.0.1:4173";
const PAYER = getAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266"); // Anvil dev account 0
const FX = { amount: 1.0, base: "EUR", date: "2026-10-09", rates: { USD: 1.1206 } }; // published ECB rate for 9 Oct 2026

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
  if (!ok) throw new Error(`check failed: ${name} ${detail}`);
}

const addr = (seed) => getAddress(slice(keccak256(toHex(seed)), 12));
const artifact = (file, name) => JSON.parse(readFileSync(`${root}contracts/out/${file}/${name}.json`, "utf8"));

// ------------------------------------------------------------------ chain
const anvil = spawn(process.env.ANVIL || "anvil", ["--port", "8545", "--chain-id", "31337", "--silent"], { stdio: "inherit" });
const pc = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 100 });
const wc = createWalletClient({ chain: foundry, transport: http(RPC), account: PAYER });
for (let i = 0; ; i++) {
  try {
    await pc.getChainId();
    break;
  } catch {
    if (i > 50) throw new Error("anvil did not start");
    await new Promise((r) => setTimeout(r, 200));
  }
}

const mock = artifact("Mocks.sol", "MockERC20");
const eurcHash = await wc.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: ["Euro Coin (local test)", "EURC", 6] });
const eurc = (await pc.waitForTransactionReceipt({ hash: eurcHash })).contractAddress;
await pc.waitForTransactionReceipt({ hash: await wc.writeContract({ address: eurc, abi: mock.abi, functionName: "mint", args: [PAYER, 50_000n * 10n ** 6n] }) });
const rejecting = artifact("Mocks.sol", "RejectingRecipient");
const rejHash = await wc.deployContract({ abi: rejecting.abi, bytecode: rejecting.bytecode.object });
const rejectingAddress = (await pc.waitForTransactionReceipt({ hash: rejHash })).contractAddress;
const deployment = JSON.parse(readFileSync(`${root}contracts/deployment.json`, "utf8"));
check("Remitsheet not deployed before the test", (await pc.getCode({ address: deployment.address })) === undefined);

// ------------------------------------------------------------------ site + browser
const server = await startServer(`${root}docs`, 4173);
const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  acceptDownloads: true,
  recordVideo: { dir: `${out}/video`, size: { width: 1280, height: 800 } },
});
await context.exposeFunction("__e2eRpc", async (method, params) => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: params ?? [] }),
  });
  return res.json();
});
await context.addInitScript(({ account }) => {
  const listeners = {};
  const provider = {
    async request({ method, params }) {
      if (method === "eth_requestAccounts" || method === "eth_accounts") return [account];
      if (method === "wallet_switchEthereumChain") {
        if (params?.[0]?.chainId === "0x7a69") return null;
        throw Object.assign(new Error("Unrecognized chain ID"), { code: 4902 });
      }
      if (method === "wallet_addEthereumChain") throw Object.assign(new Error("Test wallet: local chain only"), { code: 4001 });
      const res = await window.__e2eRpc(method, params ?? []);
      if (res.error) throw Object.assign(new Error(res.error.message), { code: res.error.code, data: res.error.data });
      return res.result;
    },
    on(ev, fn) {
      (listeners[ev] ||= []).push(fn);
    },
    removeListener(ev, fn) {
      listeners[ev] = (listeners[ev] || []).filter((f) => f !== fn);
    },
  };
  const icon =
    "data:image/svg+xml;base64," +
    btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#334155"/><path d="M9 16h14M16 9v14" stroke="#fff" stroke-width="3" stroke-linecap="round"/></svg>');
  const info = { uuid: "4f1b2c3d-0000-4000-8000-00000000e2e0", name: "Test Wallet (local Anvil)", icon, rdns: "dev.remitsheet.testwallet" };
  const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info, provider }) }));
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
}, { account: PAYER });
await context.route("**/config.json", (route) => route.fulfill({ json: { chains: { 31337: { eurc } } } }));
let fxRequests = 0;
await context.route("https://api.frankfurter.dev/**", (route) => {
  fxRequests++;
  return route.fulfill({ json: FX, headers: { "access-control-allow-origin": "*" } });
});

const page = await context.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const blockedHere = []; // public Arc RPC calls made before the test wallet connects; this sandbox has no route to arc.io
page.on("requestfailed", (r) => {
  if (new URL(r.url()).hostname.endsWith(".arc.io")) blockedHere.push(new URL(r.url()).hostname);
  else pageErrors.push(`request failed: ${r.url()}`);
});
page.on("console", (m) => m.type() === "error" && !/ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED/.test(m.text()) && pageErrors.push(m.text()));
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });

try {
  // ---------------------------------------------------------------- 1. deploy
  await page.goto(`${SITE}/?dev=1#/deploy`);
  await page.click("#connect-btn");
  await page.click("text=Test Wallet (local Anvil)");
  await page.waitForSelector("#deploy-btn");
  await page.waitForFunction(() => /USDC/.test(document.querySelector("#deploy-fee")?.textContent || ""));
  await shot("01-deploy");
  await page.click("#deploy-btn");
  await page.waitForSelector("#deploy-live", { timeout: 30000 });
  await shot("02-deployed");
  const code = await pc.getCode({ address: deployment.address });
  check("contract deployed at the predicted CREATE2 address", keccak256(code) === deployment.runtimeCodeHash, deployment.address);

  // ---------------------------------------------------------------- 2. validation
  await page.click("a.nav-link:has-text('Pay')");
  const bad = [
    "address,amount,label",
    `${addr("r1")},120.00,Ana Petrova - logo design`,
    `0x${addr("r2").slice(2).replace(/[a-fA-F]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()))},50,Typo in address`,
    `${addr("r1")},10,Same person twice`,
    `${addr("r3")},0,Nothing`,
    `${addr("r4")},12.1234567,Too precise`,
    `0x0000000000000000000000000000000000000000,5,Zero address`,
  ].join("\n");
  await page.fill("#sheet-input", bad);
  await page.waitForSelector(".chip-error");
  await page.evaluate(() => window.scrollTo(0, 560));
  await shot("03-validation");
  const errorRows = await page.locator("tr.bad:not(.msg-row)").count();
  check("validation flags bad lines", errorRows === 4, `${errorRows} error rows`);

  // ---------------------------------------------------------------- 3. USDC batch of 5
  const usdcRows = [
    [addr("alice"), "1200.00", "Ana Petrova · logo design"],
    [addr("bob"), "2450.50", "Jonas K. · backend sprint 41"],
    [addr("carol"), "380.00", "Mia Rossi · translation DE"],
    [addr("dave"), "500.00", "Docs bounty #12"],
    [addr("erin"), "715.25", "Leo Martin · QA October"],
  ];
  await page.fill("#sheet-input", "address,amount,label\n" + usdcRows.map((r) => r.join(",")).join("\n"));
  await page.fill("#ref-input", "October contractors");
  await page.waitForFunction(() => /≈/.test(document.querySelector("#fee-estimate")?.textContent || ""));
  await page.evaluate(() => window.scrollTo(0, 560));
  await shot("04-review");
  await page.click("#pay-btn");
  await page.waitForSelector("#pay-success", { timeout: 30000 });
  await shot("05-paid");
  for (const [a, amount] of usdcRows) {
    const bal = await pc.getBalance({ address: a });
    const expected = BigInt(Math.round(Number(amount) * 100)) * 10n ** 16n;
    check(`USDC recipient ${a.slice(0, 8)} received ${amount}`, bal === expected, String(bal));
  }
  check("contract holds no funds", (await pc.getBalance({ address: deployment.address })) === 0n);

  // ---------------------------------------------------------------- 4. receipt, PDF, CSV
  await page.click("#open-receipt");
  await page.waitForSelector(".receipt-lines tbody tr");
  const receiptUrl = page.url();
  const txHash = new URL(receiptUrl).searchParams.get("tx");
  const rc = await pc.getTransactionReceipt({ hash: txHash });
  console.log(`USDC batch of 5: gasUsed ${rc.gasUsed}`);
  check("receipt shows 5 lines", (await page.locator(".receipt-lines tbody tr").count()) === 5);
  check("receipt shows labels saved at payment time", (await page.textContent(".receipt-lines")).includes("Mia Rossi"));
  check("receipt shows the batch reference", (await page.textContent(".meta")).includes("October contractors"));
  await shot("06-receipt");
  await page.emulateMedia({ media: "print" });
  await page.pdf({ path: `${root}submission/receipt-example.pdf`, format: "A4", printBackground: true });
  await page.emulateMedia({ media: "screen" });
  const [download] = await Promise.all([page.waitForEvent("download"), page.click("#export-btn")]);
  const csvPath = `${out}/accounting.csv`;
  await download.saveAs(csvPath);
  const csv = readFileSync(csvPath, "utf8").trim().split(/\r?\n/);
  writeFileSync(`${root}submission/accounting-example.csv`, csv.join("\r\n") + "\r\n");
  check("CSV has header + 5 payments + 1 fee row", csv.length === 7, `${csv.length} lines`);
  check("CSV converts 1200 USDC at ECB 1.1206 to 1070.85 EUR", csv[1].includes(",1070.85,"), csv[1]);
  check("CSV names the rate source and date", csv[1].includes("2026-10-09") && csv[1].includes("ECB euro reference rate"));
  check("CSV fee row present", csv[6].startsWith("network_fee,"));
  check("FX source was requested", fxRequests > 0);

  // ---------------------------------------------------------------- 5. payment advice for one recipient
  await page.goto(`${receiptUrl}&to=${usdcRows[2][0]}`);
  await page.waitForSelector(".receipt-lines tbody tr");
  check("advice shows a single line", (await page.locator(".receipt-lines tbody tr").count()) === 1);
  await shot("07-advice");

  // ---------------------------------------------------------------- 6. EURC batch (approve + pay)
  await page.goto(`${SITE}/?dev=1`);
  await page.click("button.seg:has-text('EURC')");
  const eurcRows = [
    [addr("eu1"), "900.00", "Studio Berlin · invoice 2026-118"],
    [addr("eu2"), "1350.00", "Lisbon Dev Lda · sprint 7"],
    [addr("eu3"), "275.40", "Translation FR"],
  ];
  await page.fill("#sheet-input", "address,amount,label\n" + eurcRows.map((r) => r.join(",")).join("\n"));
  await page.fill("#ref-input", "EU contractors Oct");
  await page.waitForFunction(() => /USDC/.test(document.querySelector("#fee-estimate")?.textContent || ""));
  await page.click("#pay-btn");
  await page.waitForSelector("#pay-success", { timeout: 30000 });
  for (const [a, amount] of eurcRows) {
    const bal = await pc.readContract({ address: eurc, abi: mock.abi, functionName: "balanceOf", args: [a] });
    check(`EURC recipient ${a.slice(0, 8)} received ${amount}`, bal === BigInt(Math.round(Number(amount) * 1e6)), String(bal));
  }
  const allowanceLeft = await pc.readContract({ address: eurc, abi: mock.abi, functionName: "allowance", args: [PAYER, deployment.address] });
  check("EURC approval was exact (nothing left over)", allowanceLeft === 0n);
  await page.click("#open-receipt");
  await page.waitForSelector(".receipt-lines tbody tr");
  await shot("08-eurc-receipt");

  // ---------------------------------------------------------------- 7. failing recipient is caught before sending
  await page.goto(`${SITE}/?dev=1`);
  const failing = [
    [addr("f1"), "10", "OK"],
    [addr("f2"), "20", "OK"],
    [rejectingAddress, "30", "Contract that refuses payments"],
  ];
  await page.fill("#sheet-input", "address,amount,label\n" + failing.map((r) => r.join(",")).join("\n"));
  await page.waitForSelector("#quote-error", { timeout: 15000 });
  await page.evaluate(() => window.scrollTo(0, 560));
  const quoteError = await page.textContent("#quote-error");
  check("simulation points at the failing line", /Line 4/.test(quoteError), quoteError);
  check("failing line is marked in the table", (await page.locator("tr.msg-row.bad").count()) === 1);
  check("Pay is disabled while a line would fail", await page.isDisabled("#pay-btn"));
  const before = await pc.getBalance({ address: addr("f1") });
  check("nothing was sent to the other lines", before === 0n);
  await shot("09-failing-line");

  check("no page errors", pageErrors.length === 0, pageErrors.join(" | "));
  if (blockedHere.length) console.log(`info: ${blockedHere.length} request(s) to ${[...new Set(blockedHere)].join(", ")} were blocked by this test environment (expected)`);
} finally {
  writeFileSync(`${out}/results.json`, JSON.stringify(results, null, 2));
  await context.close();
  await browser.close();
  server.close();
  anvil.kill();
}
console.log(`\n${results.filter((r) => r.ok).length}/${results.length} checks passed`);
