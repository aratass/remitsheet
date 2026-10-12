import { REMITSHEET_ADDRESS } from "./generated/remitsheet";

export type Hex = `0x${string}`;

export type ChainConfig = {
  id: number;
  /** Name shown to the wallet when the network is added. */
  name: string;
  /** Short label for the UI. */
  label: string;
  rpcUrl: string;
  explorer: string;
  testnet: boolean;
  remitsheet: Hex;
  /** ERC-20 interface of native USDC (6 decimals). Not a payment option: native USDC is paid directly. */
  usdcErc20?: Hex;
  eurc?: Hex;
};

/** Native USDC on Arc uses 18 decimals; the USDC and EURC ERC-20 contracts use 6. */
export const NATIVE_DECIMALS = 18;
export const TOKEN_DECIMALS = 6;
/** Amounts in a sheet may have at most 6 decimals (USDC/EURC precision). */
export const MAX_INPUT_DECIMALS = 6;
/**
 * Upper bound on lines per batch. 300 new-account lines use about 11.3M gas on a standard EVM,
 * comfortably below the 16.7M per-transaction cap of the Osaka hard fork that Arc targets.
 */
export const MAX_ROWS = 300;

export const ARC_MAINNET = 5042;
export const ARC_TESTNET = 5042002;
export const LOCAL_CHAIN = 31337;

// Sources: https://docs.arc.io/arc/references/connect-to-arc , /rpc-endpoints , /contract-addresses
export const CHAINS: Record<number, ChainConfig> = {
  [ARC_MAINNET]: {
    id: ARC_MAINNET,
    name: "Arc",
    label: "Arc mainnet",
    rpcUrl: "https://rpc.mainnet.arc.io",
    explorer: "https://explorer.arc.io",
    testnet: false,
    remitsheet: REMITSHEET_ADDRESS,
    usdcErc20: "0x3600000000000000000000000000000000000000",
    eurc: "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1",
  },
  [ARC_TESTNET]: {
    id: ARC_TESTNET,
    name: "Arc Testnet",
    label: "Arc testnet",
    rpcUrl: "https://rpc.testnet.arc.io",
    explorer: "https://explorer.testnet.arc.io",
    testnet: true,
    remitsheet: REMITSHEET_ADDRESS,
    usdcErc20: "0x3600000000000000000000000000000000000000",
    eurc: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
  },
  [LOCAL_CHAIN]: {
    id: LOCAL_CHAIN,
    name: "Local test chain",
    label: "Local test chain",
    rpcUrl: "http://127.0.0.1:8545",
    explorer: "",
    testnet: true,
    remitsheet: REMITSHEET_ADDRESS,
  },
};

export const DEFAULT_CHAIN = ARC_MAINNET;
export const REPO_URL = "https://github.com/aratass/remitsheet";

/** The local development chain is only offered on localhost or with ?dev=1. */
export function devMode(): boolean {
  const host = location.hostname;
  return host === "localhost" || host === "127.0.0.1" || new URLSearchParams(location.search).has("dev");
}

export function supportedChain(id: number | null | undefined): ChainConfig | undefined {
  if (id == null) return undefined;
  if (id === LOCAL_CHAIN && !devMode()) return undefined;
  return CHAINS[id];
}

/** Optional runtime overrides from config.json next to index.html (e.g. a non-CREATE2 deployment). */
export async function loadRuntimeConfig(): Promise<void> {
  try {
    const res = await fetch("config.json", { cache: "no-store" });
    if (!res.ok) return;
    const json = (await res.json()) as { chains?: Record<string, Partial<ChainConfig>> };
    for (const [id, patch] of Object.entries(json.chains ?? {})) {
      const chain = CHAINS[Number(id)];
      if (chain) Object.assign(chain, patch);
    }
  } catch {
    // config.json is optional
  }
  // A per-browser override set on the Deploy page when the CREATE2 factory is unavailable.
  try {
    const local = JSON.parse(localStorage.getItem("remitsheet:overrides") || "{}") as Record<string, Hex>;
    for (const [id, address] of Object.entries(local)) {
      const chain = CHAINS[Number(id)];
      if (chain && /^0x[0-9a-fA-F]{40}$/.test(address)) chain.remitsheet = address;
    }
  } catch {
    // storage may be unavailable
  }
}

export function txUrl(chain: ChainConfig, hash: string): string | undefined {
  return chain.explorer ? `${chain.explorer}/tx/${hash}` : undefined;
}

export function addressUrl(chain: ChainConfig, address: string): string | undefined {
  return chain.explorer ? `${chain.explorer}/address/${address}` : undefined;
}
