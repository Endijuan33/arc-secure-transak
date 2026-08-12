import type { NftAsset } from '../types';
import { ICONS } from '../config/constants';
import type { NftsState } from '../hooks/useNfts';

interface Props {
  readonly nfts: NftsState;
  readonly selected: NftAsset | null;
  readonly amount: string;
  readonly onSelect: (nft: NftAsset | null) => void;
  readonly onAmountChange: (value: string) => void;
}

function nftKey(nft: NftAsset): string {
  return `${nft.contract}:${nft.tokenId}`;
}

/**
 * NFT picker.
 *
 * Lazy-loaded from `App`, so neither this component nor its image loading costs
 * anything for the majority of sessions that only move fungible assets.
 */
export function NftSelector({
  nfts,
  selected,
  amount,
  onSelect,
  onAmountChange,
}: Props): React.JSX.Element {
  if (!nfts.isSupported) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        NFT discovery needs an explorer API, which this network does not expose.
      </p>
    );
  }

  if (nfts.isLoading && nfts.items.length === 0) {
    return (
      <div className="row" style={{ gap: 'var(--space-2)' }}>
        <span className="skeleton" style={{ width: 110, height: 130 }} />
        <span className="skeleton" style={{ width: 110, height: 130 }} />
      </div>
    );
  }

  if (nfts.items.length === 0) {
    return (
      <div className="stack" style={{ gap: 'var(--space-2)' }}>
        <p className="hint" style={{ margin: 0 }}>
          No NFTs found for this wallet.
        </p>
        <button
          type="button"
          className="btn btn--chip"
          style={{ alignSelf: 'flex-start' }}
          onClick={nfts.refresh}
        >
          Refresh
        </button>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 'var(--space-3)' }}>
      <div className="row-between">
        <span className="label" style={{ marginBottom: 0 }}>
          {ICONS.nft} Select an NFT
        </span>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          {selected !== null && (
            <button type="button" className="btn btn--chip" onClick={() => onSelect(null)}>
              Clear
            </button>
          )}
          <button type="button" className="btn btn--chip" onClick={nfts.refresh}>
            Refresh
          </button>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))',
          gap: 'var(--space-2)',
        }}
      >
        {nfts.items.map((nft) => {
          const isSelected = selected !== null && nftKey(selected) === nftKey(nft);
          return (
            <button
              key={nftKey(nft)}
              type="button"
              onClick={() => onSelect(nft)}
              aria-pressed={isSelected}
              className="btn"
              style={{
                padding: 'var(--space-2)',
                borderRadius: 'var(--radius-md)',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border-subtle)'}`,
                background: isSelected ? 'var(--accent-soft)' : 'var(--bg-surface-sunken)',
                color: 'var(--text-primary)',
                textAlign: 'left',
                fontWeight: 400,
              }}
            >
              {nft.image !== null ? (
                <img
                  src={nft.image}
                  alt=""
                  loading="lazy"
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    objectFit: 'cover',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-raised)',
                  }}
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    aspectRatio: '1',
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 'var(--radius-sm)',
                    background: 'var(--bg-surface-raised)',
                    fontSize: 28,
                  }}
                  aria-hidden="true"
                >
                  {ICONS.nft}
                </div>
              )}
              <span
                style={{
                  display: 'block',
                  marginTop: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {nft.collection}
              </span>
              <span className="hint" style={{ fontSize: 11 }}>
                {nft.name}
                {nft.kind === 'erc1155' && ` · x${nft.amount.toString()}`}
              </span>
            </button>
          );
        })}
      </div>

      {selected !== null && selected.kind === 'erc1155' && (
        <div>
          <label className="label" htmlFor="nft-amount">
            Quantity to send (you hold {selected.amount.toString()})
          </label>
          <input
            id="nft-amount"
            type="text"
            inputMode="numeric"
            className="input input--mono"
            value={amount}
            onChange={(event) => onAmountChange(event.target.value.replace(/[^0-9]/g, ''))}
          />
        </div>
      )}
    </div>
  );
}
