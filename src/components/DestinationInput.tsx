import { useMemo, useState } from 'react';
import type { AddressBookEntry } from '../types';
import { ICONS } from '../config/constants';
import { validateRecipient } from '../security/validation';
import { searchAddressBook } from '../services/addressBook.service';
import { useDebouncedValue } from '../hooks/useDebounce';

interface Props {
  readonly recipient: string;
  readonly sender: string | null;
  readonly addressBook: readonly AddressBookEntry[];
  readonly onChange: (value: string) => void;
  readonly onAddBookmark: (address: string, tag: string) => void;
  readonly onRemoveBookmark: (id: string) => void;
}

export function DestinationInput({
  recipient,
  sender,
  addressBook,
  onChange,
  onAddBookmark,
  onRemoveBookmark,
}: Props): React.JSX.Element {
  const [showBook, setShowBook] = useState(false);
  const [bookQuery, setBookQuery] = useState('');
  const [newTag, setNewTag] = useState('');

  const debouncedRecipient = useDebouncedValue(recipient);
  const debouncedQuery = useDebouncedValue(bookQuery);

  // Validation runs on the debounced value so the field does not flash an error
  // while the user is still part-way through pasting an address.
  const validation = useMemo(() => {
    if (debouncedRecipient.trim().length === 0) return null;
    return validateRecipient(debouncedRecipient, { sender: sender ?? undefined });
  }, [debouncedRecipient, sender]);

  const isValid = validation !== null && validation.ok;
  const filteredBook = useMemo(
    () => searchAddressBook(addressBook, debouncedQuery),
    [addressBook, debouncedQuery],
  );

  const canBookmark =
    isValid &&
    !addressBook.some((entry) => entry.address.toLowerCase() === recipient.trim().toLowerCase());

  return (
    <div>
      <div className="row-between" style={{ marginBottom: 'var(--space-2)' }}>
        <span className="label" style={{ marginBottom: 0 }}>
          {ICONS.address} Destination
        </span>
        <button
          type="button"
          className="btn btn--chip"
          onClick={() => setShowBook((open) => !open)}
          aria-expanded={showBook}
        >
          {ICONS.addressBook} Bookmarks ({addressBook.length})
        </button>
      </div>

      <input
        type="text"
        className={`input input--mono${validation !== null && !validation.ok ? ' input--invalid' : ''}`}
        placeholder="0x… recipient address"
        value={recipient}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        autoComplete="off"
        aria-invalid={validation !== null && !validation.ok}
        aria-describedby="recipient-feedback"
      />

      <div id="recipient-feedback" style={{ marginTop: 'var(--space-2)', minHeight: 18 }}>
        {validation !== null && !validation.ok && (
          <span style={{ fontSize: 12, color: 'var(--danger-text)' }}>{validation.error}</span>
        )}
        {isValid && (
          <span className="row" style={{ fontSize: 12, color: 'var(--success-text)' }}>
            {ICONS.check} Valid address
            {canBookmark && (
              <button
                type="button"
                className="btn btn--chip"
                onClick={() => setShowBook(true)}
                style={{ marginLeft: 'var(--space-2)' }}
              >
                {ICONS.add} Save
              </button>
            )}
          </span>
        )}
      </div>

      {showBook && (
        <div className="panel stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          {addressBook.length > 0 && (
            <input
              type="search"
              className="input"
              style={{ padding: '8px 12px', fontSize: 13 }}
              placeholder="Search bookmarks"
              value={bookQuery}
              onChange={(event) => setBookQuery(event.target.value)}
              aria-label="Search bookmarks"
            />
          )}

          {filteredBook.length === 0 ? (
            <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
              {addressBook.length === 0 ? 'No bookmarks yet.' : 'No bookmarks match your search.'}
            </p>
          ) : (
            <ul
              style={{
                listStyle: 'none',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-1)',
                maxHeight: 180,
                overflowY: 'auto',
              }}
            >
              {filteredBook.map((entry) => (
                <li key={entry.id} className="row-between">
                  <button
                    type="button"
                    className="btn"
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'transparent',
                      padding: 'var(--space-2)',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--text-primary)',
                      fontWeight: 400,
                    }}
                    onClick={() => {
                      onChange(entry.address);
                      setShowBook(false);
                    }}
                  >
                    <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>
                      {entry.tag}
                    </span>
                    <span className="mono" style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {entry.address.slice(0, 10)}…{entry.address.slice(-6)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--icon"
                    onClick={() => onRemoveBookmark(entry.id)}
                    aria-label={`Remove ${entry.tag}`}
                  >
                    {ICONS.delete}
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <input
              type="text"
              className="input"
              style={{ padding: '8px 12px', fontSize: 13 }}
              placeholder="Label for the current address"
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              aria-label="Bookmark label"
            />
            <button
              type="button"
              className="btn btn--accent"
              disabled={!isValid || newTag.trim().length === 0}
              onClick={() => {
                onAddBookmark(recipient.trim(), newTag);
                setNewTag('');
              }}
            >
              {ICONS.add} Add
            </button>
          </div>
          {!isValid && (
            <p className="hint" style={{ margin: 0 }}>
              Enter a valid destination address above to save it here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
