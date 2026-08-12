import { describe, expect, it } from 'vitest';
import { parseUnits } from 'ethers';
import {
  applyFeeOverrides,
  composeEstimate,
  computeBurnerFunding,
  quoteFee,
  sweepReserve,
  withGasHeadroom,
} from '../../src/services/gas.service';
import { DEFAULT_CHAIN } from '../../src/config/chains';
import {
  GAS_LIMIT_HEADROOM_PERCENT,
  GAS_SPEED_MULTIPLIER,
  NATIVE_TRANSFER_GAS,
} from '../../src/config/constants';
import type { ChainConfig } from '../../src/types';

const GWEI = 1_000_000_000n;

const LEGACY_CHAIN: ChainConfig = { ...DEFAULT_CHAIN, supportsEip1559: false };

describe('quoteFee', () => {
  it('scales the EIP-1559 pair by the speed multiplier', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      { maxFeePerGas: 100n * GWEI, maxPriorityFeePerGas: 2n * GWEI },
      'standard',
    );

    expect(quote.maxFeePerGas).toBe((100n * GWEI * GAS_SPEED_MULTIPLIER.standard) / 100n);
    expect(quote.maxPriorityFeePerGas).toBe((2n * GWEI * GAS_SPEED_MULTIPLIER.standard) / 100n);
    expect(quote.gasPrice).toBeNull();
    expect(quote.effectiveGasPrice).toBe(quote.maxFeePerGas);
  });

  it('produces a higher ceiling for each faster speed', () => {
    const raw = { maxFeePerGas: 100n * GWEI, maxPriorityFeePerGas: 2n * GWEI };
    const standard = quoteFee(DEFAULT_CHAIN, raw, 'standard');
    const fast = quoteFee(DEFAULT_CHAIN, raw, 'fast');
    const instant = quoteFee(DEFAULT_CHAIN, raw, 'instant');

    expect(fast.effectiveGasPrice).toBeGreaterThan(standard.effectiveGasPrice);
    expect(instant.effectiveGasPrice).toBeGreaterThan(fast.effectiveGasPrice);
  });

  it('never lets the priority tip exceed the max fee', () => {
    // A node reporting a tip above the ceiling would otherwise produce a
    // transaction most clients reject outright.
    const quote = quoteFee(
      DEFAULT_CHAIN,
      { maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 50n * GWEI },
      'instant',
    );
    expect(quote.maxPriorityFeePerGas).toBe(quote.maxFeePerGas);
  });

  it('raises a zero priority tip to a non-zero minimum', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      { maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: 0n },
      'standard',
    );
    expect(quote.maxPriorityFeePerGas).toBeGreaterThan(0n);
  });

  it('falls back to legacy gasPrice when the chain has no EIP-1559', () => {
    const quote = quoteFee(
      LEGACY_CHAIN,
      { maxFeePerGas: 100n * GWEI, maxPriorityFeePerGas: 2n * GWEI, gasPrice: 20n * GWEI },
      'standard',
    );

    expect(quote.maxFeePerGas).toBeNull();
    expect(quote.maxPriorityFeePerGas).toBeNull();
    expect(quote.gasPrice).toBe((20n * GWEI * GAS_SPEED_MULTIPLIER.standard) / 100n);
    expect(quote.effectiveGasPrice).toBe(quote.gasPrice);
  });

  it('uses legacy gasPrice when the node reports no 1559 data', () => {
    const quote = quoteFee(DEFAULT_CHAIN, { gasPrice: 7n * GWEI }, 'standard');
    expect(quote.gasPrice).toBe((7n * GWEI * GAS_SPEED_MULTIPLIER.standard) / 100n);
  });

  it('falls back to the chain default when the node reports nothing', () => {
    const quote = quoteFee(DEFAULT_CHAIN, {}, 'standard');
    const expected = (DEFAULT_CHAIN.fallbackGasPriceWei * GAS_SPEED_MULTIPLIER.standard) / 100n;
    expect(quote.gasPrice).toBe(expected);
    expect(quote.effectiveGasPrice).toBe(expected);
  });

  it('falls back to the chain default when the node reports zeros', () => {
    const quote = quoteFee(DEFAULT_CHAIN, { gasPrice: 0n, maxFeePerGas: 0n }, 'standard');
    expect(quote.effectiveGasPrice).toBeGreaterThan(0n);
  });

  it('treats null fee fields as absent', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      { maxFeePerGas: null, maxPriorityFeePerGas: null, gasPrice: null },
      'fast',
    );
    expect(quote.effectiveGasPrice).toBeGreaterThan(0n);
  });
});

describe('applyFeeOverrides', () => {
  it('emits a type-2 request for an EIP-1559 quote', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      { maxFeePerGas: 10n * GWEI, maxPriorityFeePerGas: GWEI },
      'standard',
    );
    const overrides = applyFeeOverrides(quote, { gasLimit: 21_000n, nonce: 4 });

    expect(overrides.type).toBe(2);
    expect(overrides.maxFeePerGas).toBe(quote.maxFeePerGas);
    expect(overrides.maxPriorityFeePerGas).toBe(quote.maxPriorityFeePerGas);
    expect(overrides.gasLimit).toBe(21_000n);
    expect(overrides.nonce).toBe(4);
    expect(overrides.gasPrice).toBeUndefined();
  });

  it('emits a type-0 request for a legacy quote', () => {
    const quote = quoteFee(LEGACY_CHAIN, { gasPrice: 5n * GWEI }, 'standard');
    const overrides = applyFeeOverrides(quote);

    expect(overrides.type).toBe(0);
    expect(overrides.gasPrice).toBe(quote.gasPrice);
    expect(overrides.maxFeePerGas).toBeUndefined();
  });

  it('omits gasLimit and nonce when they are not supplied', () => {
    const quote = quoteFee(DEFAULT_CHAIN, { gasPrice: GWEI }, 'standard');
    const overrides = applyFeeOverrides(quote);
    expect('gasLimit' in overrides).toBe(false);
    expect('nonce' in overrides).toBe(false);
  });

  it('preserves nonce zero', () => {
    const quote = quoteFee(DEFAULT_CHAIN, { gasPrice: GWEI }, 'standard');
    const overrides = applyFeeOverrides(quote, { nonce: 0 });
    expect(overrides.nonce).toBe(0);
  });
});

describe('withGasHeadroom', () => {
  it('applies the configured headroom percentage', () => {
    expect(withGasHeadroom(100_000n)).toBe((100_000n * GAS_LIMIT_HEADROOM_PERCENT) / 100n);
  });

  it('always increases the limit', () => {
    expect(withGasHeadroom(21_000n)).toBeGreaterThan(21_000n);
  });
});

describe('composeEstimate', () => {
  it('multiplies the limit by the effective per-gas price', () => {
    const fee = quoteFee(DEFAULT_CHAIN, { gasPrice: 10n * GWEI }, 'standard');
    const estimate = composeEstimate(50_000n, fee, true);

    expect(estimate.gasLimit).toBe(50_000n);
    expect(estimate.totalCostWei).toBe(50_000n * fee.effectiveGasPrice);
    expect(estimate.simulated).toBe(true);
  });

  it('records when the figure came from a fallback', () => {
    const fee = quoteFee(DEFAULT_CHAIN, { gasPrice: GWEI }, 'standard');
    expect(composeEstimate(21_000n, fee, false).simulated).toBe(false);
  });
});

describe('expectedGasPrice and sweepReserve', () => {
  /**
   * Regression: the sweep reserved `21000 x maxFeePerGas`, but EIP-1559 charges
   * `baseFee + tip` and refunds the difference — to the burner, which is
   * discarded moments later. Measured on Arc Testnet the stranded remainder was
   * 0.000588 native per transfer, exactly the over-reservation.
   */
  it('predicts the charged price, not the ceiling', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      {
        maxFeePerGas: 41n * GWEI,
        maxPriorityFeePerGas: GWEI,
        gasPrice: 21n * GWEI,
        baseFeePerGas: 20n * GWEI,
      },
      'standard',
    );

    expect(quote.expectedGasPrice).toBeLessThan(quote.effectiveGasPrice);
    expect(quote.baseFeePerGas).toBe(20n * GWEI);
  });

  it('allows exactly one block of base-fee growth', () => {
    const baseFee = 20n * GWEI;
    const tip = GWEI;
    const quote = quoteFee(
      DEFAULT_CHAIN,
      {
        maxFeePerGas: baseFee * 2n + tip,
        maxPriorityFeePerGas: tip,
        gasPrice: baseFee + tip,
        baseFeePerGas: baseFee,
      },
      'standard',
    );

    // 12.5% is the EIP-1559 per-block cap, so the reservation covers the next
    // block without over-reserving beyond it.
    const scaledTip = (tip * GAS_SPEED_MULTIPLIER.standard) / 100n;
    expect(quote.expectedGasPrice).toBe((baseFee * 1125n) / 1000n + scaledTip);
  });

  it('never predicts above the ceiling', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      {
        maxFeePerGas: 10n * GWEI,
        maxPriorityFeePerGas: 50n * GWEI,
        baseFeePerGas: 9n * GWEI,
      },
      'instant',
    );
    expect(quote.expectedGasPrice).toBeLessThanOrEqual(quote.effectiveGasPrice);
  });

  it('equals the ceiling on a legacy chain, where nothing is refunded', () => {
    const quote = quoteFee(LEGACY_CHAIN, { gasPrice: 20n * GWEI }, 'standard');
    expect(quote.expectedGasPrice).toBe(quote.effectiveGasPrice);
    expect(quote.baseFeePerGas).toBeNull();
  });

  /**
   * The node admits a transaction only when
   * `value + gasLimit * maxFeePerGas` fits inside the sender's balance; the
   * EIP-1559 refund lands afterwards and cannot be spent in advance.
   *
   * Reserving against the expected charge instead stranded 0.0081 native on Arc
   * Testnet, so this asserts the reservation is exactly the ceiling.
   */
  it('reserves the full ceiling, as the admission rule requires', () => {
    const quote = quoteFee(
      DEFAULT_CHAIN,
      {
        maxFeePerGas: 41n * GWEI,
        maxPriorityFeePerGas: GWEI,
        gasPrice: 21n * GWEI,
        baseFeePerGas: 20n * GWEI,
      },
      'standard',
    );

    expect(sweepReserve(quote)).toBe(NATIVE_TRANSFER_GAS * quote.maxFeePerGas!);
  });

  it('never reserves less than the ceiling, whatever the speed', () => {
    for (const speed of ['standard', 'fast', 'instant'] as const) {
      const quote = quoteFee(
        DEFAULT_CHAIN,
        {
          maxFeePerGas: 41n * GWEI,
          maxPriorityFeePerGas: GWEI,
          gasPrice: 21n * GWEI,
          baseFeePerGas: 20n * GWEI,
        },
        speed,
      );
      // Under-reserving by any amount gets the sweep rejected outright.
      expect(sweepReserve(quote)).toBeGreaterThanOrEqual(
        NATIVE_TRANSFER_GAS * quote.effectiveGasPrice,
      );
    }
  });

  it('still reserves enough to pay for the sweep', () => {
    const baseFee = 20n * GWEI;
    const tip = GWEI;
    const quote = quoteFee(
      DEFAULT_CHAIN,
      {
        maxFeePerGas: baseFee * 2n + tip,
        maxPriorityFeePerGas: tip,
        gasPrice: baseFee + tip,
        baseFeePerGas: baseFee,
      },
      'standard',
    );

    // Worst case: the sweep lands one maximum base-fee increase later.
    const worstCaseCharge = NATIVE_TRANSFER_GAS * ((baseFee * 1125n) / 1000n + tip);
    expect(sweepReserve(quote)).toBeGreaterThanOrEqual(worstCaseCharge);
  });
});

describe('computeBurnerFunding', () => {
  it('budgets for the transfer, the sweep, and the safety buffer', () => {
    const fee = quoteFee(DEFAULT_CHAIN, { gasPrice: 10n * GWEI }, 'standard');
    const estimate = composeEstimate(100_000n, fee, true);

    const funding = computeBurnerFunding(DEFAULT_CHAIN, estimate);
    const sweepCost = NATIVE_TRANSFER_GAS * fee.effectiveGasPrice;

    expect(funding).toBe(estimate.totalCostWei + sweepCost + DEFAULT_CHAIN.gasSafetyBufferWei);
  });

  it('always exceeds the transfer cost alone', () => {
    // Under-funding here is the single most likely way to strand assets: the
    // burner must be able to pay for its own sweep after the transfer.
    const fee = quoteFee(DEFAULT_CHAIN, { gasPrice: 10n * GWEI }, 'standard');
    const estimate = composeEstimate(100_000n, fee, true);
    expect(computeBurnerFunding(DEFAULT_CHAIN, estimate)).toBeGreaterThan(estimate.totalCostWei);
  });

  it('scales with the fee level', () => {
    const cheap = composeEstimate(
      100_000n,
      quoteFee(DEFAULT_CHAIN, { gasPrice: GWEI }, 'standard'),
      true,
    );
    const pricey = composeEstimate(
      100_000n,
      quoteFee(DEFAULT_CHAIN, { gasPrice: 100n * GWEI }, 'standard'),
      true,
    );

    expect(computeBurnerFunding(DEFAULT_CHAIN, pricey)).toBeGreaterThan(
      computeBurnerFunding(DEFAULT_CHAIN, cheap),
    );
  });

  it('stays below a plausible testnet balance for a normal transfer', () => {
    // Sanity bound: a routine transfer must not demand an absurd deposit.
    const fee = quoteFee(DEFAULT_CHAIN, { gasPrice: 2n * GWEI }, 'standard');
    const estimate = composeEstimate(120_000n, fee, true);
    expect(computeBurnerFunding(DEFAULT_CHAIN, estimate)).toBeLessThan(parseUnits('0.1', 18));
  });
});
