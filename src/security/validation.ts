/**
 * Strict input validation.
 *
 * Every function here is total: it returns a discriminated result instead of
 * throwing, so callers are forced by the type system to handle rejection. No
 * value reaches a signer or an RPC call without passing through one of these.
 */

import { getAddress, isAddress, parseUnits } from 'ethers';
import type { ChainConfig } from '../types';

export type ValidationResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function ok<T>(value: T): ValidationResult<T> {
  return { ok: true, value };
}

function fail<T>(error: string): ValidationResult<T> {
  return { ok: false, error };
}

/** The zero address; a transfer here is an irrecoverable burn. */
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Addresses that must never receive a transfer.
 *
 * `0x…dEaD` is the conventional burn sink and the ERC-1820 / CREATE2 factory
 * entries are singleton contracts with no transfer semantics, so sending assets
 * to any of them destroys them.
 */
const BLOCKED_RECIPIENTS: ReadonlySet<string> = new Set(
  [
    ZERO_ADDRESS,
    '0x000000000000000000000000000000000000dEaD',
    '0x00000000219ab540356cBB839Cbe05303d7705Fa', // ETH2 deposit contract
    '0x4e59b44847b379578588920cA78FbF26c0B4956C', // deterministic CREATE2 deployer
    '0x1820a4B7618BdE71Dce8cdc73aAB6C95905faD24', // ERC-1820 registry
  ].map((entry) => entry.toLowerCase()),
);

/** Upper bound on a decimal amount string, to stop absurd or hostile input. */
const MAX_AMOUNT_DIGITS = 30;

/** Address-book tags are short, printable, and single-line. */
const MAX_TAG_LENGTH = 40;
const TAG_PATTERN = /^[\p{L}\p{N} ._'\-()]+$/u;

/** Only `-` is allowed as a separator so `1.2.3` and `1,2` are rejected outright. */
const DECIMAL_PATTERN = /^\d{1,30}(\.\d{1,36})?$/;

/**
 * A 20-byte hex address with a mandatory `0x` prefix.
 *
 * ethers' `isAddress` accepts an unprefixed 40-character hex string, which makes
 * a truncated paste or a copied transaction-data fragment look like a valid
 * address. Requiring the prefix removes that ambiguity before any other check
 * runs.
 */
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

/**
 * Reject any C0/C1 control character in a user-supplied label.
 *
 * Checked by code point rather than a regex: matching control characters
 * literally in a pattern is both unreadable and flagged by `no-control-regex`.
 */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0);
    if (code === undefined) continue;
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

/**
 * Validate and checksum a recipient address.
 *
 * `sender` and `burner` are rejected as recipients: sending to yourself wastes
 * gas, and sending to the burner would strand assets in a wallet that is about
 * to be destroyed.
 */
export function validateRecipient(
  input: unknown,
  context: { readonly sender?: string | undefined; readonly burner?: string | undefined } = {},
): ValidationResult<string> {
  if (typeof input !== 'string') {
    return fail('Recipient address must be a string.');
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return fail('Recipient address is required.');
  }
  if (!ADDRESS_PATTERN.test(trimmed)) {
    return fail('Recipient must be a 0x-prefixed, 40-character hex address.');
  }
  if (!isAddress(trimmed)) {
    return fail('Recipient is not a valid EVM address.');
  }

  let checksummed: string;
  try {
    checksummed = getAddress(trimmed);
  } catch {
    return fail('Recipient address failed checksum validation.');
  }

  const lower = checksummed.toLowerCase();
  if (BLOCKED_RECIPIENTS.has(lower)) {
    return fail('Recipient is a blocked burn or system address. Assets sent there are lost.');
  }
  if (context.sender !== undefined && lower === context.sender.toLowerCase()) {
    return fail('Recipient is your own wallet. Choose a different destination.');
  }
  if (context.burner !== undefined && lower === context.burner.toLowerCase()) {
    return fail('Recipient is the internal burner address and would strand your assets.');
  }
  return ok(checksummed);
}

/** Validate and checksum a contract address. */
export function validateContractAddress(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return fail('Contract address must be a string.');
  }
  const trimmed = input.trim();
  if (!ADDRESS_PATTERN.test(trimmed)) {
    return fail('Contract address must be a 0x-prefixed, 40-character hex address.');
  }
  if (!isAddress(trimmed)) {
    return fail('Contract address is not a valid EVM address.');
  }
  if (trimmed.toLowerCase() === ZERO_ADDRESS) {
    return fail('The zero address is not a token contract.');
  }
  try {
    return ok(getAddress(trimmed));
  } catch {
    return fail('Contract address failed checksum validation.');
  }
}

/**
 * Parse a decimal amount string into base units, bounded by `max` when given.
 *
 * Rejects `NaN`, `Infinity`, exponent notation, negatives, thousands
 * separators, and more fractional digits than the asset supports — all of which
 * `parseUnits` would either throw on or silently accept in a surprising way.
 */
export function validateAmount(
  input: unknown,
  decimals: number,
  options: { readonly max?: bigint | undefined; readonly allowZero?: boolean } = {},
): ValidationResult<bigint> {
  if (typeof input !== 'string' && typeof input !== 'number') {
    return fail('Amount must be a string or number.');
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    return fail('Token decimals are out of the supported range (0-36).');
  }

  const raw = String(input).trim();
  if (raw.length === 0) {
    return fail('Amount is required.');
  }
  if (raw.length > MAX_AMOUNT_DIGITS + 40) {
    return fail('Amount string is unreasonably long.');
  }
  if (!DECIMAL_PATTERN.test(raw)) {
    return fail('Amount must be a plain decimal number, e.g. 12.5 (no commas or exponents).');
  }

  const [, fraction = ''] = raw.split('.');
  if (fraction.length > decimals) {
    return fail(`This asset supports at most ${decimals} decimal places.`);
  }

  let parsed: bigint;
  try {
    parsed = parseUnits(raw, decimals);
  } catch {
    return fail('Amount could not be converted to base units.');
  }

  if (parsed < 0n) {
    return fail('Amount cannot be negative.');
  }
  if (parsed === 0n && options.allowZero !== true) {
    return fail('Amount must be greater than zero.');
  }
  if (options.max !== undefined && parsed > options.max) {
    return fail('Amount exceeds your available balance.');
  }
  return ok(parsed);
}

/** Validate an ERC-721 / ERC-1155 token id (an unsigned 256-bit integer). */
export function validateTokenId(input: unknown): ValidationResult<bigint> {
  if (typeof input !== 'string' && typeof input !== 'number' && typeof input !== 'bigint') {
    return fail('Token ID must be a string, number, or bigint.');
  }
  const raw = String(input).trim();
  if (!/^\d{1,78}$/.test(raw)) {
    return fail('Token ID must be a non-negative integer.');
  }
  let parsed: bigint;
  try {
    parsed = BigInt(raw);
  } catch {
    return fail('Token ID could not be parsed.');
  }
  if (parsed < 0n || parsed > 2n ** 256n - 1n) {
    return fail('Token ID is outside the uint256 range.');
  }
  return ok(parsed);
}

/** Validate an address-book tag. */
export function validateTag(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return fail('Tag must be a string.');
  }
  // Control characters are rejected before whitespace is collapsed: `\n` and
  // `\t` are whitespace, so collapsing first would silently accept a label
  // containing them.
  if (hasControlCharacter(input)) {
    return fail('Tag contains unsupported characters.');
  }
  const trimmed = input.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0) {
    return fail('Tag is required.');
  }
  if (trimmed.length > MAX_TAG_LENGTH) {
    return fail(`Tag must be ${MAX_TAG_LENGTH} characters or fewer.`);
  }
  if (!TAG_PATTERN.test(trimmed)) {
    return fail('Tag contains unsupported characters.');
  }
  return ok(trimmed);
}

/** Confirm the connected chain id matches the selected chain. */
export function validateChainId(actual: unknown, expected: ChainConfig): ValidationResult<number> {
  const numeric =
    typeof actual === 'bigint'
      ? Number(actual)
      : typeof actual === 'number'
        ? actual
        : typeof actual === 'string' && /^\d+$/.test(actual)
          ? Number(actual)
          : Number.NaN;

  if (!Number.isSafeInteger(numeric) || numeric <= 0) {
    return fail('Could not determine the connected chain ID.');
  }
  if (numeric !== expected.id) {
    return fail(
      `Wrong network. Connect your wallet to ${expected.name} (chain ID ${expected.id}).`,
    );
  }
  return ok(numeric);
}

/**
 * Verify that a transaction hash looks like a 32-byte hash.
 *
 * Guards against a malformed RPC response being fed into an explorer URL.
 */
export function validateTxHash(input: unknown): ValidationResult<string> {
  if (typeof input !== 'string') {
    return fail('Transaction hash must be a string.');
  }
  const trimmed = input.trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(trimmed)) {
    return fail('Transaction hash is malformed.');
  }
  return ok(trimmed.toLowerCase());
}
