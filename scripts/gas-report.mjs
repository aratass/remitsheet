// Measures full transaction gas (intrinsic + calldata + execution) for batches of 10, 50 and 200
// recipients on a local Anvil node, and prices it at Arc's 20 gwei minimum base fee.
// Usage: npm run contracts:build && node scripts/gas-report.mjs   (needs `anvil`, or ANVIL=/path/to/anvil)
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { concat, createPublicClient, createWalletClient, getAddress, http, keccak256, maxUint256, slice, toHex } from "viem";
import { foundry } from "viem/chains";

const root = new URL("..", import.meta.url).pathname;
const RPC = "http://127.0.0.1:8547";
const PAYER = getAddress("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266");
const anvil = spawn(process.env.ANVIL || "anvil", ["--port", "8547", "--silent", "--gas-limit", "100000000"], { stdio: "inherit" });
const pc = createPublicClient({ chain: foundry, transport: http(RPC), pollingInterval: 50 });
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
const wait = async (hash) => pc.waitForTransactionReceipt({ hash });

const dep = JSON.parse(readFileSync(`${root}contracts/deployment.json`, "utf8"));
const rs = JSON.parse(readFileSync(`${root}contracts/out/Remitsheet.sol/Remitsheet.json`, "utf8"));
const deployRc = await wait(await wc.sendTransaction({ to: dep.create2Factory, data: concat([dep.salt, rs.bytecode.object]) }));
const mock = JSON.parse(readFileSync(`${root}contracts/out/Mocks.sol/MockERC20.json`, "utf8"));
const token = (await wait(await wc.deployContract({ abi: mock.abi, bytecode: mock.bytecode.object, args: ["EURC", "EURC", 6] }))).contractAddress;
await wait(await wc.writeContract({ address: token, abi: mock.abi, functionName: "mint", args: [PAYER, 10n ** 30n] }));
await wait(await wc.writeContract({ address: token, abi: mock.abi, functionName: "approve", args: [dep.address, maxUint256] }));

let seed = 0;
const recipients = (n) => Array.from({ length: n }, () => getAddress(slice(keccak256(toHex(`gas ${seed++}`)), 12)));
const GWEI20 = 20n * 10n ** 9n;
const usdc = (gas) => (Number(gas * GWEI20) / 1e18).toFixed(4);

const rows = [];
for (const n of [10, 50, 200]) {
  for (const existing of [false, true]) {
    // native
    let to = recipients(n);
    if (existing) for (const a of to) await wait(await wc.sendTransaction({ to: a, value: 1n }));
    const amounts = to.map((_, i) => BigInt(i + 1) * 10n ** 16n);
    const value = amounts.reduce((a, b) => a + b, 0n);
    const native = await wait(await wc.writeContract({ address: dep.address, abi: rs.abi, functionName: "payNative", args: [to, amounts, toHex("gas", { size: 32 })], value, gas: 30_000_000n }));
    // token
    to = recipients(n);
    if (existing) for (const a of to) await wait(await wc.writeContract({ address: token, abi: mock.abi, functionName: "transfer", args: [a, 1n] }));
    const tAmounts = to.map((_, i) => BigInt(i + 1) * 10n ** 4n);
    const tok = await wait(await wc.writeContract({ address: dep.address, abi: rs.abi, functionName: "payToken", args: [token, to, tAmounts, toHex("gas", { size: 32 })], gas: 30_000_000n }));
    rows.push({ n, existing, native: native.gasUsed, token: tok.gasUsed });
  }
}
anvil.kill();

console.log(`Deployment through the CREATE2 factory: ${deployRc.gasUsed} gas (${usdc(deployRc.gasUsed)} USDC at 20 gwei)\n`);
console.log("| Recipients | Recipient accounts | Native USDC: gas (per line) | USDC fee at 20 gwei | ERC-20 (EURC): gas (per line) | USDC fee at 20 gwei |");
console.log("|---:|---|---:|---:|---:|---:|");
for (const r of rows) {
  console.log(
    `| ${r.n} | ${r.existing ? "already funded" : "new"} | ${r.native.toLocaleString("en-US")} (${(r.native / BigInt(r.n)).toLocaleString("en-US")}) | ${usdc(r.native)} | ${r.token.toLocaleString("en-US")} (${(r.token / BigInt(r.n)).toLocaleString("en-US")}) | ${usdc(r.token)} |`,
  );
}
