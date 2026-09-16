import { Suspense, lazy, useMemo, useState } from 'react';
import { formatUnits } from 'ethers';
import { SendHorizonal, StopCircle, Image as ImageIcon } from 'lucide-react';
import type { NftAsset, TokenBalance } from '../types';
import { useSessionStore } from '../store/sessionStore';
import { useTransferStore } from '../store/transferStore';
import { useWallet } from '../hooks/useWallet';
import { useBalances } from '../hooks/useBalances';
import { useGas } from '../hooks/useGas';
import { useHistory } from '../hooks/useHistory';
import { useNfts } from '../hooks/useNfts';
import { useTheme } from '../hooks/useTheme';
import { useBurnerWallet } from '../hooks/useBurnerWallet';
import { buildTransferRequest, useTransak, type TransferDraft } from '../hooks/useTransak';
import { Header } from '../components/Header';
import { AccountInfo } from '../components/AccountInfo';
import { TokenSelector } from '../components/TokenSelector';
import { DestinationInput } from '../components/DestinationInput';
import { AmountInput } from '../components/AmountInput';
import { PipelineProgress } from '../components/PipelineProgress';
import { TransactionStatusPanel } from '../components/TransactionStatusPanel';
import { TransactionReceipt } from '../components/TransactionReceipt';
import { ActivityLog } from '../components/ActivityLog';
import { BurnerRecoveryPanel } from '../components/BurnerRecoveryPanel';
import { Footer } from '../components/Footer';
import { notify } from '../store/notificationStore';

const NftSelector = lazy(async () => ({
  default: (await import('../components/NftSelector')).NftSelector,
}));
const TransactionHistory = lazy(async () => ({
  default: (await import('../components/TransactionHistory')).TransactionHistory,
}));
const AboutPanel = lazy(async () => ({
  default: (await import('../components/AboutPanel')).AboutPanel,
}));

type Mode = 'token' | 'nft';
type Tab = 'transfer' | 'history' | 'about';

const TABS: readonly { readonly id: Tab; readonly label: string }[] = [
  { id: 'transfer', label: 'Transfer' },
  { id: 'history', label: 'History' },
  { id: 'about', label: 'How it works' },
];

function assetKeyOf(asset: TokenBalance): string {
  return asset.address ?? 'native';
}

function nftKeyOf(nft: NftAsset): string {
  return `${nft.contract}:${nft.tokenId}`;
}

function LoadingBlock(): React.JSX.Element {
  return (
    <span
      className="skeleton"
      style={{ display: 'block', height: 80, borderRadius: 'var(--radius-lg)' }}
    />
  );
}

export function TransferPage(): React.JSX.Element {
  const chain = useSessionStore((state) => state.chain);
  const gasSpeed = useSessionStore((state) => state.gasSpeed);
  const setChain = useSessionStore((state) => state.setChain);
  const setGasSpeed = useSessionStore((state) => state.setGasSpeed);
  const addressBook = useSessionStore((state) => state.addressBook);
  const addBookmark = useSessionStore((state) => state.addBookmark);
  const removeBookmark = useSessionStore((state) => state.removeBookmark);

  const { theme, toggle: toggleTheme } = useTheme();
  const wallet = useWallet();
  const recovery = useBurnerWallet();

  const steps = useTransferStore((state) => state.steps);
  const isRunning = useTransferStore((state) => state.isRunning);
  const status = useTransferStore((state) => state.status);
  const statusMessage = useTransferStore((state) => state.statusMessage);
  const log = useTransferStore((state) => state.log);
  const result = useTransferStore((state) => state.result);

  const [tab, setTab] = useState<Tab>('transfer');
  const [mode, setMode] = useState<Mode>('token');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [selectedAssetKey, setSelectedAssetKey] = useState<string | null>(null);
  const [selectedNftKey, setSelectedNftKey] = useState<string | null>(null);
  const [nftAmount, setNftAmount] = useState('1');

  const balances = useBalances(chain, wallet.address, { paused: isRunning });
  const nfts = useNfts(chain, wallet.address, { enabled: mode === 'nft' });
  const history = useHistory(chain.id, wallet.address);

  const selectedAsset = useMemo((): TokenBalance | null => {
    if (balances.all.length === 0) return null;
    if (selectedAssetKey !== null) {
      const match = balances.all.find((asset) => assetKeyOf(asset) === selectedAssetKey);
      if (match !== undefined) return match;
    }
    return balances.all.find((asset) => asset.raw > 0n) ?? balances.all[0] ?? null;
  }, [balances.all, selectedAssetKey]);

  const selectedNft = useMemo((): NftAsset | null => {
    if (selectedNftKey === null) return null;
    return nfts.items.find((nft) => nftKeyOf(nft) === selectedNftKey) ?? null;
  }, [nfts.items, selectedNftKey]);

  const draft: TransferDraft = useMemo(
    () => ({
      recipient,
      amount,
      asset: mode === 'token' ? selectedAsset : null,
      nft: mode === 'nft' ? selectedNft : null,
      nftAmount,
    }),
    [recipient, amount, mode, selectedAsset, selectedNft, nftAmount],
  );

  const transak = useTransak(chain, wallet, draft);

  const quotableRequest = useMemo(() => {
    const built = buildTransferRequest(draft, wallet.address);
    return built.ok ? built.request : null;
  }, [draft, wallet.address]);

  const gas = useGas(chain, quotableRequest, wallet.address, gasSpeed, { paused: isRunning });

  const handleMax = (): void => {
    if (selectedAsset === null) return;
    if (selectedAsset.raw === 0n) {
      notify.warning('Nothing to send', `Your ${selectedAsset.symbol} balance is zero.`);
      return;
    }
    if (selectedAsset.kind === 'native') {
      const funding = gas.fundingWei;
      if (funding === null) {
        notify.info(
          'Estimating fees',
          'Wait for the fee estimate before using MAX for native sends.',
        );
        return;
      }
      if (selectedAsset.raw <= funding) {
        notify.warning(
          'Balance too low',
          `You need more than the reserved fee amount to send ${selectedAsset.symbol}.`,
        );
        return;
      }
      const sendable = selectedAsset.raw - funding;
      setAmount(formatUnits(sendable, selectedAsset.decimals));
      return;
    }
    setAmount(selectedAsset.formatted);
  };

  const receiptRequest = transak.validation.ok ? transak.validation.request : null;
  const receiptSymbol = result === null ? '' : (receiptRequest?.symbol ?? '');
  const receiptAmount =
    result === null
      ? ''
      : receiptRequest === null
        ? ''
        : receiptRequest.kind === 'erc721'
          ? '1'
          : receiptRequest.kind === 'erc1155'
            ? nftAmount
            : amount;

  const onSubmit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void transak.submit();
  };

  const isSecureContext = typeof window !== 'undefined' && window.isSecureContext;

  return (
    <div className="app-shell">
      <div className="app-card">
        <Header
          isConnected={wallet.isConnected}
          address={wallet.address}
          chain={chain}
          theme={theme}
          isSecureContext={isSecureContext}
          onOpenWallet={wallet.openWalletModal}
          onSelectChain={setChain}
          onToggleTheme={toggleTheme}
        />

        {!isSecureContext && (
          <div className="callout callout--error" style={{ marginBottom: 'var(--space-5)' }}>
            <span className="callout__icon">
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
                <path d="M12 9v4" />
                <path d="M12 17h.01" />
              </svg>
            </span>
            <div>
              <strong style={{ display: 'block', marginBottom: 2 }}>Insecure origin</strong>
              <span style={{ fontSize: 13, lineHeight: 1.55 }}>
                This page is not served over HTTPS or localhost, so the browser withholds Web
                Crypto. Burner keys cannot be encrypted and transfers will be refused. Reopen the
                app on a secure origin.
              </span>
            </div>
          </div>
        )}

        <AccountInfo
          isConnected={wallet.isConnected}
          chain={chain}
          native={balances.native}
          isLoading={balances.isLoading}
          isWrongNetwork={wallet.isWrongNetwork}
          onSwitchNetwork={() => void wallet.switchToSelectedChain()}
        />

        <BurnerRecoveryPanel chain={chain} recovery={recovery} />

        <nav className="tabs" role="tablist" aria-label="Sections">
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              id={`tab-${entry.id}`}
              aria-selected={tab === entry.id}
              aria-controls={`panel-${entry.id}`}
              className={`tabs__tab${tab === entry.id ? ' tabs__tab--active' : ''}`}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {entry.id === 'history' && history.total > 0 && (
                <span className="tabs__count">{history.total}</span>
              )}
            </button>
          ))}
        </nav>

        {tab === 'about' && (
          <div role="tabpanel" id="panel-about" aria-labelledby="tab-about">
            <Suspense fallback={<LoadingBlock />}>
              <AboutPanel chain={chain} />
            </Suspense>
          </div>
        )}

        {tab === 'history' && (
          <div role="tabpanel" id="panel-history" aria-labelledby="tab-history">
            <Suspense fallback={<LoadingBlock />}>
              <TransactionHistory chain={chain} history={history} />
            </Suspense>
          </div>
        )}

        <div
          role="tabpanel"
          id="panel-transfer"
          aria-labelledby="tab-transfer"
          hidden={tab !== 'transfer'}
        >
          <form className="stack" onSubmit={onSubmit} style={{ gap: 'var(--space-5)' }}>
            {/* Asset type selector */}
            {wallet.isConnected && (
              <div className="segmented" role="group" aria-label="Asset type">
                <button
                  type="button"
                  className={`segmented__option${mode === 'token' ? ' segmented__option--active' : ''}`}
                  onClick={() => setMode('token')}
                  aria-pressed={mode === 'token'}
                >
                  Tokens
                </button>
                <button
                  type="button"
                  className={`segmented__option${mode === 'nft' ? ' segmented__option--active' : ''}`}
                  onClick={() => setMode('nft')}
                  aria-pressed={mode === 'nft'}
                  style={{ gap: 4 }}
                >
                  <ImageIcon size={12} aria-hidden="true" />
                  NFTs
                </button>
              </div>
            )}

            {wallet.isConnected && mode === 'token' && (
              <TokenSelector
                assets={balances.all}
                selected={selectedAsset}
                isLoading={balances.isLoading}
                onSelect={(asset) => setSelectedAssetKey(assetKeyOf(asset))}
              />
            )}

            {wallet.isConnected && mode === 'nft' && (
              <Suspense fallback={<LoadingBlock />}>
                <NftSelector
                  nfts={nfts}
                  selected={selectedNft}
                  amount={nftAmount}
                  onSelect={(nft) => setSelectedNftKey(nft === null ? null : nftKeyOf(nft))}
                  onAmountChange={setNftAmount}
                />
              </Suspense>
            )}

            <DestinationInput
              recipient={recipient}
              sender={wallet.address}
              addressBook={addressBook}
              onChange={setRecipient}
              onAddBookmark={(address, tag) => {
                const outcome = addBookmark(address, tag);
                if (outcome.ok) {
                  notify.success('Bookmark saved', tag);
                } else {
                  notify.error('Could not save bookmark', outcome.error ?? '');
                }
              }}
              onRemoveBookmark={(id) => {
                removeBookmark(id);
                notify.info('Bookmark removed');
              }}
            />

            {mode === 'token' && (
              <AmountInput
                asset={selectedAsset}
                amount={amount}
                chain={chain}
                gasSpeed={gasSpeed}
                gas={gas}
                onAmountChange={setAmount}
                onGasSpeedChange={setGasSpeed}
                onMax={() => void handleMax()}
              />
            )}

            {/* Primary CTA */}
            {isRunning ? (
              <button
                type="button"
                className="btn btn--danger"
                onClick={transak.abort}
                style={{ gap: 8 }}
              >
                <StopCircle size={16} aria-hidden="true" />
                Abort and recover funds
              </button>
            ) : (
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!transak.canSubmit}
                style={{ gap: 8 }}
              >
                <SendHorizonal size={16} aria-hidden="true" />
                Send securely
              </button>
            )}

            {transak.blockedReason !== null && !isRunning && (
              <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
                {transak.blockedReason}
              </p>
            )}
          </form>

          {/* Post-submit panels */}
          <div className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
            <TransactionStatusPanel status={status} message={statusMessage} isRunning={isRunning} />

            <TransactionReceipt
              status={status}
              chain={chain}
              result={result}
              amount={receiptAmount}
              symbol={receiptSymbol}
              recipient={recipient}
            />

            <PipelineProgress steps={steps} isRunning={isRunning} chain={chain} />

            <ActivityLog entries={log} isRunning={isRunning} />
          </div>
        </div>

        <Footer chain={chain} />
      </div>
    </div>
  );
}
