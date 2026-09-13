import React from 'react';
import {problemHref} from './Problems';
export default function Logbook({entries,loading,error,busy,remove}) {
 return <main className="location-page"><article className="detail-panel logbook-page"><div className="detail-banner"><a className="logbook-back" href="#explore"><span aria-hidden="true">&larr;</span> Find locations</a><div className="eyebrow">YOUR CLIMBING</div><h1>Logbook</h1><p>{entries.length} {entries.length===1?'problem':'problems'} completed</p></div><div className="logbook-content">
 {error && <p className="error" role="alert">{error}</p>}
 {loading ? <p role="status">Loading your logbook...</p> : !entries.length && !error ? <p>No problems logged yet. Open a problem and select “Log problem” to mark it as done.</p> : <div className="problem-list">{entries.map(entry=><div className="problem-row" key={entry.entry_id}><div>{entry.problem_id ? <a href={problemHref(entry.location_id,entry.boulder_id,entry.problem_id)}><strong>{entry.grade} - {entry.problem_name}</strong></a> : <strong>{entry.grade} - {entry.problem_name} (deleted)</strong>}<p>{entry.location_name} · {entry.boulder_name}</p><small>Logged {new Date(entry.logged_at).toLocaleDateString('en-GB')}</small></div><button className="secondary small" disabled={busy} onClick={()=>remove(entry.problem_id || entry.entry_id)} aria-label={`Remove ${entry.problem_name} from logbook`}>Remove</button></div>)}</div>}
 </div></article></main>;
}
