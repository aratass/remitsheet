import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  http,
  keccak256,
  type Chain,
  type PublicClient,
  type WalletClient,
} from "viem";
import { type ChainConfig, type Hex } from "./config";
import { CREATE2_FACTORY, REMITSHEET_RUNTIME_HASH } from "./generated/remitsheet";
import { wallet } from "./wallet";

export function viemChain(c: ChainConfig): Chain {
  return defineChain({
    id: c.id,
    name: c.name,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [c.rpcUrl] } },
    blockExplorers: c.explorer ? { default: { name: "Arc explorer", url: c.explorer } } : undefined,
  });
}

/** Reads through the connected wallet when it is on `c`, otherwise through the public RPC. */
export function readClient(c: ChainConfig): PublicClient {
  const transport = wallet.provider && wallet.chainId === c.id ? custom(wallet.provider) : http(c.rpcUrl, { retryCount: 2 });
  return createPublicClient({ chain: viemChain(c), transport, pollingInterval: 500 }) as PublicClient;
}

export function writeClient(c: ChainConfig): WalletClient {
  if (!wallet.provider || !wallet.account) throw new Error("Connect a wallet first.");
  return createWalletClient({ chain: viemChain(c), transport: custom(wallet.provider), account: wallet.account });
}

export type DeploymentStatus = "live" | "missing" | "foreign";

/** Checks that the code at `address` is exactly the Remitsheet runtime code. */
export async function deploymentStatus(c: ChainConfig, address: Hex = c.remitsheet): Promise<DeploymentStatus> {
  const code = await readClient(c).getCode({ address });
  if (!code || code === "0x") return "missing";
  return keccak256(code) === REMITSHEET_RUNTIME_HASH ? "live" : "foreign";
}

export async function factoryAvailable(c: ChainConfig): Promise<boolean> {
  const code = await readClient(c).getCode({ address: CREATE2_FACTORY });
  return !!code && code !== "0x";
}

const ERC20_ABI = [
  { type: "function", name: "symbol", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [{ type: "address" }, { type: "address" }],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [{ type: "bool" }],
  },
] as const;
export { ERC20_ABI };

export type ExplainedError = { message: string; row?: number };

/**
 * Turns wallet, RPC and contract errors into a sentence a person can act on. `rowLines` maps batch
 * indexes back to sheet line numbers so a failing recipient can be pointed at.
 */
export function explainError(err: unknown, rowLines: number[] = [], assetSymbol = "USDC"): ExplainedError {
  const e = err as { code?: number; shortMessage?: string; message?: string };
  if (e?.code === 4001 || /user (rejected|denied)|rejected the request/i.test(String(e?.message))) {
    return { message: "You cancelled the request in your wallet. Nothing was sent." };
  }
  if (err instanceof BaseError) {
    const revert = err.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data?.errorName) {
      const args = (revert.data.args ?? []) as readonly unknown[];
      const line = (i: unknown) => rowLines[Number(i)];
      switch (revert.data.errorName) {
        case "TransferFailed": {
          const l = line(args[0]);
          return {
            row: l,
            message:
              assetSymbol === "USDC"
                ? `Line ${l ?? Number(args[0]) + 1} (${String(args[1])}) cannot receive USDC. It may be a contract that rejects payments or a restricted address. Remove that line and try again. Nothing was sent.`
                : `The ${assetSymbol} transfer to line ${l ?? Number(args[0]) + 1} (${String(args[1])}) failed. Check your ${assetSymbol} balance and approval, or remove that line. Nothing was sent.`,
          };
        }
        case "ZeroAddress":
          return { row: line(args[0]), message: `Line ${line(args[0])} has the zero address.` };
        case "ZeroAmount":
          return { row: line(args[0]), message: `Line ${line(args[0])} has a zero amount.` };
        case "ValueMismatch":
          return { message: "The amount sent does not match the batch total. Reload the page and try again." };
        case "EmptyBatch":
          return { message: "The batch is empty." };
        case "LengthMismatch":
          return { message: "Internal error: recipients and amounts differ in length." };
        case "InvalidToken":
          return { message: `The ${assetSymbol} token address is not a contract on this network.` };
      }
    }
    const text = `${err.shortMessage} ${err.details ?? ""}`;
    if (/insufficient funds|exceeds balance|insufficient balance/i.test(text)) {
      return { message: "Your balance is too low to cover this batch plus the network fee (paid in USDC)." };
    }
    if (/exceeds (block|transaction) gas limit|gas limit too high|intrinsic gas too high/i.test(text)) {
      return { message: "This batch is too large for one transaction. Split the sheet into smaller batches." };
    }
    return { message: err.shortMessage || err.message };
  }
  return { message: e?.shortMessage || e?.message || String(err) };
}
