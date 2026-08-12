/**
 * Typed access to ethers `Contract` methods.
 *
 * `contract.someMethod` goes through an index signature, which under
 * `noUncheckedIndexedAccess` is `T | undefined` and under `no-unsafe-call` is
 * untyped. `getFunction` is the checked equivalent: it throws for a name absent
 * from the ABI, and the wrappers here give the call and its `estimateGas`
 * companion concrete signatures.
 */

import type { Contract, ContractTransactionResponse, Overrides } from 'ethers';

type CallArgs = readonly unknown[];

/** Invoke a read-only method and return its decoded result. */
export async function callRead<T>(
  contract: Contract,
  method: string,
  args: CallArgs = [],
): Promise<T> {
  const fn = contract.getFunction(method);
  return (await fn(...args)) as T;
}

/** Simulate a state-changing method and return the gas it would consume. */
export async function callEstimateGas(
  contract: Contract,
  method: string,
  args: CallArgs = [],
  overrides: Overrides = {},
): Promise<bigint> {
  const fn = contract.getFunction(method);
  return fn.estimateGas(...args, overrides);
}

/** Send a state-changing method and return the pending transaction. */
export async function callWrite(
  contract: Contract,
  method: string,
  args: CallArgs = [],
  overrides: Overrides = {},
): Promise<ContractTransactionResponse> {
  const fn = contract.getFunction(method);
  return (await fn(...args, overrides)) as ContractTransactionResponse;
}
