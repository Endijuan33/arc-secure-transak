/**
 * Core domain types shared across the application.
 *
 * Every value that crosses a trust boundary (RPC response, explorer API payload,
 * persisted storage record) is received as `unknown` and narrowed by an explicit
 * guard before it is admitted into one of these shapes.
 */

/** Supported asset classes. */
export type AssetKind = 'native' | 'erc20' | 'erc721' | 'erc1155';

/** A single JSON-RPC endpoint with an optional human label. */
export interface RpcEndpoint {
  readonly url: string;
  readonly label: string;
}

/** Block explorer descriptor used for links and the optional REST API. */
export interface ExplorerDescriptor {
  readonly name: string;
  readonly url: string;
  /** Blockscout-compatible REST base, e.g. `https://host/api/v2`. `null` disables API reads. */
  readonly apiBase: string | null;
}

/** Native currency metadata for a chain. */
export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

/**
 * A chain definition. Adding a new network requires only a new entry in
 * `src/config/chains.ts` — no code changes elsewhere.
 */
export interface ChainConfig {
  readonly id: number;
  readonly name: string;
  readonly network: string;
  readonly testnet: boolean;
  readonly nativeCurrency: NativeCurrency;
  readonly rpcEndpoints: readonly RpcEndpoint[];
  readonly explorer: ExplorerDescriptor;
  /** Curated ERC-20 tokens used as the RPC fallback list. */
  readonly knownTokens: readonly TokenMetadata[];
  /** Fallback gas price (wei) when the node reports neither EIP-1559 nor legacy fees. */
  readonly fallbackGasPriceWei: bigint;
  /** Native amount held back so the burner can always pay for its own sweep. */
  readonly gasSafetyBufferWei: bigint;
  /** True when the node accepts `eth_maxPriorityFeePerGas` / type-2 transactions. */
  readonly supportsEip1559: boolean;
}

/** Static token metadata, independent of any wallet. */
export interface TokenMetadata {
  readonly address: string;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logo: string | null;
}

/** A selectable asset with a resolved balance for the connected wallet. */
export interface TokenBalance {
  readonly kind: Extract<AssetKind, 'native' | 'erc20'>;
  /** `null` for the native asset. */
  readonly address: string | null;
  readonly symbol: string;
  readonly name: string;
  readonly decimals: number;
  readonly logo: string | null;
  readonly raw: bigint;
  readonly formatted: string;
}

/** An NFT owned by the connected wallet. */
export interface NftAsset {
  readonly kind: Extract<AssetKind, 'erc721' | 'erc1155'>;
  readonly contract: string;
  readonly tokenId: string;
  readonly name: string;
  readonly collection: string;
  readonly image: string | null;
  /** ERC-1155 balance; always `1n` for ERC-721. */
  readonly amount: bigint;
}

/** Discriminated union describing what the user asked to move. */
export type TransferRequest =
  | {
      readonly kind: 'native';
      readonly recipient: string;
      readonly amount: bigint;
      readonly decimals: number;
      readonly symbol: string;
    }
  | {
      readonly kind: 'erc20';
      readonly recipient: string;
      readonly amount: bigint;
      readonly decimals: number;
      readonly symbol: string;
      readonly token: string;
    }
  | {
      readonly kind: 'erc721';
      readonly recipient: string;
      readonly contract: string;
      readonly tokenId: bigint;
      readonly symbol: string;
    }
  | {
      readonly kind: 'erc1155';
      readonly recipient: string;
      readonly contract: string;
      readonly tokenId: bigint;
      readonly amount: bigint;
      readonly symbol: string;
    };

/** The ten named stages of the secure pipeline, in execution order. */
export type PipelineStepId =
  | 'verify-session'
  | 'validate-network'
  | 'create-burner'
  | 'estimate-gas'
  | 'preflight-balance'
  | 'fund-burner'
  | 'forward-asset'
  | 'dispatch-final'
  | 'sweep-refund'
  | 'destroy-session';

export type StepState = 'idle' | 'active' | 'done' | 'failed' | 'skipped';

/** Progress record for one pipeline stage. */
export interface PipelineStep {
  readonly id: PipelineStepId;
  readonly index: number;
  readonly label: string;
  readonly state: StepState;
  readonly detail: string | null;
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

export type TransactionStatus = 'pending' | 'confirmed' | 'failed' | 'aborted';

/** A persisted transaction record. `id` is monotonic and drives cursor pagination. */
export interface TransactionRecord {
  readonly id: number;
  readonly hash: string;
  readonly chainId: number;
  readonly kind: AssetKind;
  readonly symbol: string;
  /** Human-readable amount; `"1"` for a single ERC-721. */
  readonly amount: string;
  readonly recipient: string;
  readonly sender: string;
  readonly burner: string;
  readonly tokenId: string | null;
  readonly status: TransactionStatus;
  readonly timestamp: number;
  readonly blockNumber: number | null;
  readonly gasUsed: string | null;
  readonly errorMessage: string | null;
}

/** Fields a caller supplies when creating a record; `id` is assigned by the store. */
export type NewTransactionRecord = Omit<TransactionRecord, 'id'>;

/** One page of history, addressed by an opaque cursor. */
export interface HistoryPage {
  readonly items: readonly TransactionRecord[];
  /** Pass back to fetch the next page. `null` when the end has been reached. */
  readonly nextCursor: number | null;
  readonly total: number;
}

/** A saved recipient. */
export interface AddressBookEntry {
  readonly id: string;
  readonly address: string;
  readonly tag: string;
  readonly chainId: number | null;
  readonly createdAt: number;
}

export type NotificationLevel = 'success' | 'error' | 'warning' | 'info';

/**
 * One entry in the user-facing activity log.
 *
 * Structured rather than a formatted string so the UI can group, filter, and
 * time entries without re-parsing text. The previous `string[]` forced the view
 * to display a raw dump, which read like debug output rather than a record of
 * what the application did on the user's behalf.
 */
export interface ActivityLogEntry {
  readonly id: number;
  readonly at: number;
  readonly step: PipelineStepId;
  readonly stepLabel: string;
  readonly phase: 'start' | 'progress' | 'done' | 'skipped' | 'failed';
  readonly level: NotificationLevel;
  readonly message: string;
  /** Milliseconds since the run began, for a relative timeline. */
  readonly elapsedMs: number;
}

export interface AppNotification {
  readonly id: string;
  readonly level: NotificationLevel;
  readonly title: string;
  readonly message: string;
  readonly createdAt: number;
  readonly durationMs: number;
}

export type GasSpeed = 'standard' | 'fast' | 'instant';

/** Normalized fee parameters. Exactly one of the EIP-1559 pair or `gasPrice` is set. */
export interface FeeQuote {
  readonly maxFeePerGas: bigint | null;
  readonly maxPriorityFeePerGas: bigint | null;
  readonly gasPrice: bigint | null;
  /**
   * Per-gas ceiling. What a transaction could cost at worst, so it is the right
   * figure for provisioning funds.
   */
  readonly effectiveGasPrice: bigint;
  /**
   * Best estimate of what a transaction will *actually* be charged per gas.
   *
   * Under EIP-1559 a sender pays `baseFee + tip`, not `maxFeePerGas`; the
   * difference is refunded. Reserving at the ceiling therefore leaves the
   * refunded remainder stranded in a wallet that is about to be discarded, which
   * is why the sweep reserves against this value instead.
   */
  readonly expectedGasPrice: bigint;
  /** Base fee of the block the quote was read from. `null` on legacy chains. */
  readonly baseFeePerGas: bigint | null;
}

/** Result of gas estimation for one leg of the pipeline. */
export interface GasEstimate {
  readonly gasLimit: bigint;
  readonly fee: FeeQuote;
  readonly totalCostWei: bigint;
  /** True when the node rejected simulation and a conservative default was used. */
  readonly simulated: boolean;
}

export type ThemeMode = 'dark' | 'light';

/** Callback used by services to report human-readable progress. */
export type ProgressReporter = (step: PipelineStepId, detail: string) => void;
