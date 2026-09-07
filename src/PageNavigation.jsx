import React from 'react';
import { problemHref } from './Problems';

export default function PageNavigation({ place, boulder, problem, problemId }) {
  const trail = [{ name: 'Find locations', kind: 'Explore', href: '#' }];
  if (place) trail.push({ name: place.name, kind: 'Location', href: `#${new URLSearchParams({ location: place.id })}` });
  if (boulder) trail.push({ name: boulder.name, kind: 'Boulder', href: problemHref(place.id, boulder.id) });
  if (problemId && boulder) trail.push({ name: problem?.name || 'Problem not found', kind: 'Problem', href: problemHref(place.id, boulder.id, problemId) });
  const parent = trail[Math.max(0, trail.length - 2)];
  return <div className="page-navigation">
    <a className="parent-link" href={parent.href} aria-label={`Back to ${parent.name}`}><span className="parent-arrow" aria-hidden="true">←</span><span><small>BACK TO {parent.kind === 'Explore' ? 'SEARCH' : parent.kind.toUpperCase()}</small><strong>{parent.name}</strong></span></a>
    <nav aria-label="Breadcrumb" className="page-trail"><ol>{trail.map((step, index) => <li key={step.kind}>{index > 0 && <span className="trail-chevron" aria-hidden="true">›</span>}{index === trail.length - 1 ? <span className="trail-step current" aria-current="page"><small>{step.kind}</small><strong>{step.name}</strong></span> : <a className="trail-step" href={step.href}><small>{step.kind}</small><span>{step.name}</span></a>}</li>)}</ol></nav>
  </div>;
}
