import { useMemo, useState } from 'react';
import type { TokenBalance } from '../types';
import { useDebouncedValue } from '../hooks/useDebounce';

interface Props {
  readonly assets: readonly TokenBalance[];
  readonly selected: TokenBalance | null;
  readonly isLoading: boolean;
  readonly onSelect: (asset: TokenBalance) => void;
}

function assetKey(asset: TokenBalance): string {
  return asset.address ?? 'native';
}

/** Show the search field only once the list is long enough to need one. */
const SEARCH_THRESHOLD = 6;

export function TokenSelector({
  assets,
  selected,
  isLoading,
  onSelect,
}: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('');
  // Debounced so filtering does not run on every keystroke while the token list
  // can be long enough for the pass to be noticeable on a low-end device.
  const debouncedQuery = useDebouncedValue(query);

  const filtered = useMemo(() => {
    const needle = debouncedQuery.trim().toLowerCase();
    if (needle.length === 0) return assets;
    return assets.filter(
      (asset) =>
        asset.symbol.toLowerCase().includes(needle) ||
        asset.name.toLowerCase().includes(needle) ||
        (asset.address !== null && asset.address.toLowerCase().includes(needle)),
    );
  }, [assets, debouncedQuery]);

  if (isLoading && assets.length === 0) {
    return (
      <div>
        <span className="label">Asset</span>
        <div className="row" style={{ gap: 'var(--space-2)' }}>
          <span className="skeleton" style={{ width: 96, height: 34 }} />
          <span className="skeleton" style={{ width: 96, height: 34 }} />
          <span className="skeleton" style={{ width: 96, height: 34 }} />
        </div>
      </div>
    );
  }

  if (assets.length === 0) return null;

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
        <span className="label" style={{ marginBottom: 0 }}>
          Asset
        </span>
        {assets.length >= SEARCH_THRESHOLD && (
          <input
            type="search"
            className="input"
            style={{ width: 180, padding: '6px 12px', fontSize: 12 }}
            placeholder="Search assets"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search assets"
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          No assets match “{debouncedQuery}”.
        </p>
      ) : (
        <div className="row" style={{ flexWrap: 'wrap', gap: 'var(--space-2)' }}>
          {filtered.map((asset) => {
            const isSelected = selected !== null && assetKey(selected) === assetKey(asset);
            return (
              <button
                key={assetKey(asset)}
                type="button"
                className={`token-chip${isSelected ? ' token-chip--selected' : ''}`}
                onClick={() => onSelect(asset)}
                aria-pressed={isSelected}
              >
                {asset.logo !== null && (
                  <img className="token-chip__logo" src={asset.logo} alt="" />
                )}
                <span>{asset.symbol}</span>
                <span style={{ fontSize: 11, opacity: 0.65 }}>({asset.formatted})</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
