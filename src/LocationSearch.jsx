import React, { useRef, useState } from 'react';

export default function LocationSearch({ locations, loaded }) {
  const [query, setQuery] = useState(''), [open, setOpen] = useState(false);
  const wrapper = useRef(null), input = useRef(null);
  const matches = locations.filter(l => `${l.name} ${l.region || ''}`.toLowerCase().includes(query.trim().toLowerCase()));
  function keys(e) {
    if (e.key === 'Escape') { setOpen(false); input.current.focus(); return; }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    if (!open) { setOpen(true); return; }
    const links = [...wrapper.current.querySelectorAll('.location-result')];
    if (!links.length) return;
    const current = links.indexOf(document.activeElement);
    const next = current < 0 ? (e.key === 'ArrowDown' ? 0 : links.length - 1) : (current + (e.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length;
    links[next].focus();
  }
  return <section className="location-search" ref={wrapper} onKeyDown={keys} onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }} aria-label="Find a climbing location">
    <label htmlFor="location-search-input">Find a location</label>
    <div className="location-search-input"><span aria-hidden="true">⌕</span><input ref={input} id="location-search-input" type="search" placeholder="Search by location or region..." autoComplete="off" value={query} aria-controls={open ? 'location-search-results' : undefined} onFocus={() => setOpen(true)} onChange={e => { setQuery(e.target.value); setOpen(true); }}/></div>
    {open && <div className="location-search-results" id="location-search-results">
      {!loaded ? <p role="status">Loading locations...</p> : matches.length ? <ul>{matches.map(l => <li key={l.id}><a className="location-result" href={`#${new URLSearchParams({ location: l.id })}`}><span><strong>{l.name}</strong>{l.region && <small>{l.region}</small>}</span><span aria-hidden="true">↗</span></a></li>)}</ul> : <p role="status">{locations.length ? 'No matching locations.' : 'No locations yet. Create a location to get started.'}</p>}
    </div>}
  </section>;
}
