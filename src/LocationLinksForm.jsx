import React, { useState } from 'react';
import { uid } from './ui';

// The form for a location's additional links (labels and URLs).
export default function LocationLinksForm({ links, busy, error, cancel, save }) {
  const [items, setItems] = useState(links.map(link => ({ ...link, key: uid() })));
  const update = (key, field, value) =>
    setItems(old => old.map(item => (item.key === key ? { ...item, [field]: value } : item)));
  return (
    <form
      onSubmit={e => {
        e.preventDefault();
        save(items.map(({ label, url }) => ({ label: label.trim(), url: url.trim() })));
      }}
    >
      <p>Link to UKC, a local tide chart, YouTube beta, a relevant book or any other useful resources.</p>
      {items.map(item => (
        <fieldset className="media-picker" key={item.key} disabled={busy}>
          <label>
            Label
            <input
              required
              maxLength={120}
              value={item.label}
              onChange={e => update(item.key, 'label', e.target.value)}
              placeholder="e.g. Local tide times"
            />
          </label>
          <label>
            URL
            <input
              required
              type="url"
              maxLength={2048}
              value={item.url}
              onChange={e => update(item.key, 'url', e.target.value)}
              placeholder="https://..."
            />
          </label>
          <button
            type="button"
            className="text-button"
            onClick={() => setItems(old => old.filter(link => link.key !== item.key))}
          >
            Remove link
          </button>
        </fieldset>
      ))}
      <button
        type="button"
        className="secondary small"
        disabled={busy || items.length >= 50}
        onClick={() => setItems(old => [...old, { key: uid(), label: '', url: '' }])}
      >
        + Add link
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="secondary" disabled={busy} onClick={cancel}>
          Cancel
        </button>
        <button className="primary" disabled={busy}>
          {busy ? 'Saving...' : 'Save links'}
        </button>
      </div>
    </form>
  );
}
