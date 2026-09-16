import { useMemo, useState } from 'react';
import { MapPin, BookOpen, CheckCircle, XCircle, Plus, Trash2, Search } from 'lucide-react';
import type { AddressBookEntry } from '../types';
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
        <span className="row label" style={{ marginBottom: 0, gap: 6 }}>
          <MapPin size={12} aria-hidden="true" />
          Destination
        </span>
        <button
          type="button"
          className="btn btn--chip"
          onClick={() => setShowBook((open) => !open)}
          aria-expanded={showBook}
          style={{ gap: 4 }}
        >
          <BookOpen size={10} aria-hidden="true" />
          Bookmarks{addressBook.length > 0 && ` (${addressBook.length})`}
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
          <span className="row" style={{ fontSize: 12, color: 'var(--danger-text)', gap: 4 }}>
            <XCircle size={12} aria-hidden="true" />
            {validation.error}
          </span>
        )}
        {isValid && (
          <span className="row" style={{ fontSize: 12, color: 'var(--success-text)', gap: 4 }}>
            <CheckCircle size={12} aria-hidden="true" />
            Valid address
            {canBookmark && (
              <button
                type="button"
                className="btn btn--chip"
                onClick={() => setShowBook(true)}
                style={{ marginLeft: 'var(--space-2)', gap: 4 }}
              >
                <Plus size={10} aria-hidden="true" />
                Save
              </button>
            )}
          </span>
        )}
      </div>

      {showBook && (
        <div className="panel stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
          {addressBook.length > 0 && (
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
                style={{ padding: '8px 10px 8px 28px', fontSize: 13 }}
                placeholder="Search bookmarks"
                value={bookQuery}
                onChange={(event) => setBookQuery(event.target.value)}
                aria-label="Search bookmarks"
              />
            </div>
          )}

          {filteredBook.length === 0 ? (
            <p
              className="hint"
              style={{ margin: 0, textAlign: 'center', padding: 'var(--space-2) 0' }}
            >
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
                maxHeight: 200,
                overflowY: 'auto',
              }}
            >
              {filteredBook.map((entry) => (
                <li key={entry.id} className="row-between" style={{ gap: 'var(--space-2)' }}>
                  <button
                    type="button"
                    className="btn"
                    style={{
                      flex: 1,
                      textAlign: 'left',
                      background: 'var(--surface-muted)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--border)',
                      color: 'var(--ink)',
                      fontWeight: 400,
                      transition: 'background var(--transition-fast)',
                    }}
                    onClick={() => {
                      onChange(entry.address);
                      setShowBook(false);
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--ink)',
                      }}
                    >
                      {entry.tag}
                    </span>
                    <span
                      className="mono"
                      style={{
                        fontSize: 11,
                        color: 'var(--muted)',
                        display: 'block',
                        marginTop: 1,
                      }}
                    >
                      {entry.address.slice(0, 10)}…{entry.address.slice(-6)}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn btn--icon"
                    onClick={() => onRemoveBookmark(entry.id)}
                    aria-label={`Remove ${entry.tag}`}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="row" style={{ gap: 'var(--space-2)' }}>
            <input
              type="text"
              className="input"
              style={{ padding: '9px 12px', fontSize: 13, flex: 1 }}
              placeholder="Label for current address"
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
              style={{ gap: 4, flexShrink: 0 }}
            >
              <Plus size={12} aria-hidden="true" />
              Save
            </button>
          </div>
          {!isValid && (
            <p className="hint" style={{ margin: 0 }}>
              Enter a valid destination address above to save it as a bookmark.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
