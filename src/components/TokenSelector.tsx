import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
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

const SEARCH_THRESHOLD = 6;

export function TokenSelector({
  assets,
  selected,
  isLoading,
  onSelect,
}: Props): React.JSX.Element | null {
  const [query, setQuery] = useState('');
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
          <span className="skeleton" style={{ width: 88, height: 36, borderRadius: 'var(--radius-pill)' }} />
          <span className="skeleton" style={{ width: 88, height: 36, borderRadius: 'var(--radius-pill)' }} />
          <span className="skeleton" style={{ width: 88, height: 36, borderRadius: 'var(--radius-pill)' }} />
        </div>
      </div>
    );
  }

  if (assets.length === 0) return null;

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
        <span className="label" style={{ marginBottom: 0 }}>Asset</span>
        {assets.length >= SEARCH_THRESHOLD && (
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
            <Search
              size={12}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 10,
                color: 'var(--muted)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="search"
              className="input"
              style={{ width: 160, padding: '6px 10px 6px 28px', fontSize: 12 }}
              placeholder="Search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              aria-label="Search assets"
            />
          </div>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="hint" style={{ margin: 0 }}>
          No assets match &ldquo;{debouncedQuery}&rdquo;.
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
                  <img className="token-chip__logo" src={asset.logo} alt="" aria-hidden="true" />
                )}
                <span style={{ fontWeight: 600 }}>{asset.symbol}</span>
                <span style={{ fontSize: 11, color: isSelected ? 'var(--accent-text)' : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {asset.formatted}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
