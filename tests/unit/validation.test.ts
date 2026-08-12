import { describe, expect, it } from 'vitest';
import { getAddress } from 'ethers';
import {
  ZERO_ADDRESS,
  validateAmount,
  validateChainId,
  validateContractAddress,
  validateRecipient,
  validateTag,
  validateTokenId,
  validateTxHash,
} from '../../src/security/validation';
import { DEFAULT_CHAIN } from '../../src/config/chains';

const ALICE = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const BOB = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

describe('validateRecipient', () => {
  it('accepts a valid address and returns it checksummed', () => {
    const result = validateRecipient(ALICE.toLowerCase());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(getAddress(ALICE));
  });

  it('trims surrounding whitespace', () => {
    const result = validateRecipient(`  ${ALICE}  `);
    expect(result.ok).toBe(true);
  });

  it.each([
    ['empty string', ''],
    ['too short', '0x1234'],
    ['not hex', '0xZZZZ7970C51812dc3A010C7d01b50e0d17dc79C8'],
    ['missing prefix', '70997970C51812dc3A010C7d01b50e0d17dc79C8'],
  ])('rejects %s', (_label, input) => {
    expect(validateRecipient(input).ok).toBe(false);
  });

  it.each([[null], [undefined], [42], [{}], [[]]])('rejects non-string input %s', (input) => {
    expect(validateRecipient(input).ok).toBe(false);
  });

  it('rejects a mixed-case address whose checksum is wrong', () => {
    // Flipping one character's case breaks EIP-55 without changing the value.
    const broken = `0x70997970c51812DC3A010C7d01b50e0d17dc79C8`;
    expect(validateRecipient(broken).ok).toBe(false);
  });

  it('rejects the zero address', () => {
    const result = validateRecipient(ZERO_ADDRESS);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/blocked burn or system address/i);
  });

  it('rejects the conventional burn address', () => {
    expect(validateRecipient('0x000000000000000000000000000000000000dEaD').ok).toBe(false);
  });

  it('rejects sending to yourself', () => {
    const result = validateRecipient(ALICE, { sender: ALICE });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/your own wallet/i);
  });

  it('compares the sender case-insensitively', () => {
    expect(validateRecipient(ALICE.toLowerCase(), { sender: ALICE.toUpperCase() }).ok).toBe(false);
  });

  it('rejects sending to the internal burner', () => {
    const result = validateRecipient(BOB, { burner: BOB });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/burner/i);
  });

  it('allows a different address when a sender is supplied', () => {
    expect(validateRecipient(BOB, { sender: ALICE }).ok).toBe(true);
  });
});

describe('validateContractAddress', () => {
  it('accepts and checksums a contract address', () => {
    const result = validateContractAddress(BOB.toLowerCase());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(getAddress(BOB));
  });

  it('rejects the zero address', () => {
    expect(validateContractAddress(ZERO_ADDRESS).ok).toBe(false);
  });

  it('rejects non-addresses', () => {
    expect(validateContractAddress('not-an-address').ok).toBe(false);
  });
});

describe('validateAmount', () => {
  it('parses a whole number at 18 decimals', () => {
    const result = validateAmount('1', 18);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(10n ** 18n);
  });

  it('parses a fractional value at 6 decimals', () => {
    const result = validateAmount('12.5', 6);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(12_500_000n);
  });

  it('accepts a numeric input', () => {
    const result = validateAmount(1.5, 18);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(1_500_000_000_000_000_000n);
  });

  it('accepts exactly the decimal precision the asset supports', () => {
    expect(validateAmount('0.000001', 6).ok).toBe(true);
  });

  it('rejects more decimals than the asset supports', () => {
    const result = validateAmount('0.0000001', 6);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at most 6 decimal places/i);
  });

  it('rejects zero by default', () => {
    expect(validateAmount('0', 18).ok).toBe(false);
  });

  it('accepts zero when explicitly allowed', () => {
    const result = validateAmount('0', 18, { allowZero: true });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it.each([
    ['negative', '-1'],
    ['exponent notation', '1e18'],
    ['thousands separator', '1,000'],
    ['double dot', '1.2.3'],
    ['NaN text', 'NaN'],
    ['Infinity text', 'Infinity'],
    ['hex', '0x10'],
    ['trailing dot', '1.'],
    ['leading dot', '.5'],
    ['empty', ''],
    ['whitespace only', '   '],
    ['letters', 'abc'],
  ])('rejects %s', (_label, input) => {
    expect(validateAmount(input, 18).ok).toBe(false);
  });

  it('rejects a value above the maximum', () => {
    const result = validateAmount('2', 18, { max: 10n ** 18n });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/exceeds your available balance/i);
  });

  it('accepts a value exactly at the maximum', () => {
    expect(validateAmount('1', 18, { max: 10n ** 18n }).ok).toBe(true);
  });

  it('rejects unsupported decimal counts', () => {
    expect(validateAmount('1', -1).ok).toBe(false);
    expect(validateAmount('1', 99).ok).toBe(false);
  });

  it('rejects an unreasonably long input', () => {
    expect(validateAmount('9'.repeat(200), 18).ok).toBe(false);
  });

  it('rejects non-string, non-number input', () => {
    expect(validateAmount(null, 18).ok).toBe(false);
    expect(validateAmount({ value: 1 }, 18).ok).toBe(false);
  });
});

describe('validateTokenId', () => {
  it('accepts a numeric string', () => {
    const result = validateTokenId('42');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(42n);
  });

  it('accepts zero', () => {
    const result = validateTokenId('0');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(0n);
  });

  it('accepts a bigint', () => {
    expect(validateTokenId(7n).ok).toBe(true);
  });

  it('accepts the maximum uint256', () => {
    const max = (2n ** 256n - 1n).toString();
    const result = validateTokenId(max);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(2n ** 256n - 1n);
  });

  it.each([['-1'], ['1.5'], ['abc'], [''], ['0x1']])('rejects %s', (input) => {
    expect(validateTokenId(input).ok).toBe(false);
  });

  it('rejects a value above uint256', () => {
    expect(validateTokenId((2n ** 256n).toString()).ok).toBe(false);
  });
});

describe('validateTag', () => {
  it('accepts a simple label', () => {
    const result = validateTag('Alice');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Alice');
  });

  it('collapses internal whitespace', () => {
    const result = validateTag('  Cold   Storage  ');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe('Cold Storage');
  });

  it('accepts non-Latin letters', () => {
    expect(validateTag('冷钱包').ok).toBe(true);
  });

  it('rejects an empty tag', () => {
    expect(validateTag('   ').ok).toBe(false);
  });

  it('rejects an over-long tag', () => {
    expect(validateTag('a'.repeat(41)).ok).toBe(false);
  });

  it('rejects control and markup characters', () => {
    expect(validateTag('<script>').ok).toBe(false);
    expect(validateTag('bad\nnewline').ok).toBe(false);
  });
});

describe('validateChainId', () => {
  it('accepts a matching numeric chain id', () => {
    expect(validateChainId(DEFAULT_CHAIN.id, DEFAULT_CHAIN).ok).toBe(true);
  });

  it('accepts a matching bigint chain id', () => {
    expect(validateChainId(BigInt(DEFAULT_CHAIN.id), DEFAULT_CHAIN).ok).toBe(true);
  });

  it('accepts a matching numeric string', () => {
    expect(validateChainId(String(DEFAULT_CHAIN.id), DEFAULT_CHAIN).ok).toBe(true);
  });

  it('rejects a different chain', () => {
    const result = validateChainId(1, DEFAULT_CHAIN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/wrong network/i);
  });

  it('rejects an unparseable chain id', () => {
    expect(validateChainId('mainnet', DEFAULT_CHAIN).ok).toBe(false);
    expect(validateChainId(null, DEFAULT_CHAIN).ok).toBe(false);
  });
});

describe('validateTxHash', () => {
  const hash = `0x${'ab'.repeat(32)}`;

  it('accepts a 32-byte hash and lowercases it', () => {
    const result = validateTxHash(hash.toUpperCase().replace('0X', '0x'));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toBe(hash);
  });

  it.each([['0x1234'], [`0x${'ab'.repeat(33)}`], ['not-a-hash'], ['']])('rejects %s', (input) => {
    expect(validateTxHash(input).ok).toBe(false);
  });
});
