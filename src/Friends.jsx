import React, {useEffect,useState} from 'react';
import {problemHref} from './Problems';
async function request(action,values={}) {
 const response=await fetch('/api/friends',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...values})});
 const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not update Friends.');return data;
}
export default function Friends() {
 const [people,setPeople]=useState([]),[results,setResults]=useState(null),[name,setName]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[friend,setFriend]=useState(null),[mutual,setMutual]=useState(false);
 useEffect(()=>{let active=true;request('list').then(data=>{if(active)setPeople(data);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 async function act(action,target) {
  setBusy(true);setError('');try {setPeople(await request(action,{target}));}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function view(person) {
  setBusy(true);setError('');try{setFriend(await request('logbook',{target:person.id}));setMutual(false);}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const accepted=people.filter(p=>p.status==='accepted'),incoming=people.filter(p=>p.status==='pending'&&p.incoming),outgoing=people.filter(p=>p.status==='pending'&&!p.incoming);
 const entries=friend?.entries.filter(e=>!mutual || e.mutual) || [];
 const disabled=busy || loading;
 return <main className="location-page"><article className="detail-panel logbook-page"><div className="detail-banner">
 {friend ? <button className="logbook-back" onClick={()=>setFriend(null)}><span aria-hidden="true">&larr;</span> Friends</button> : <a className="logbook-back" href="#explore"><span aria-hidden="true">&larr;</span> Find locations</a>}
 <div className="eyebrow">YOUR CLIMBING COMMUNITY</div><h1>{friend ? `${friend.name}'s logbook` : 'Friends'}</h1><p>{friend ? `${friend.entries.length} problems completed` : 'Connect with friends and compare your sends.'}</p></div>
 <div className="logbook-content friends-content">{error && <p className="error" role="alert">{error}</p>}
 {friend ? <><div className="friends-filters"><button className={!mutual?'primary':'secondary'} aria-pressed={!mutual} onClick={()=>setMutual(false)}>All sends</button><button className={mutual?'primary':'secondary'} aria-pressed={mutual} onClick={()=>setMutual(true)}>Mutual sends</button></div>{entries.length ? <div className="problem-list">{entries.map(e=><div className="problem-row" key={e.entry_id}><div>{e.problem_id ? <a href={problemHref(e.location_id,e.boulder_id,e.problem_id)}><strong>{e.grade} - {e.problem_name}</strong></a> : <strong>{e.grade} - {e.problem_name} (deleted)</strong>}{e.mutual && <span className="logged-badge">Both completed</span>}<p>{e.location_name} &middot; {e.boulder_name}</p><small>Logged {new Date(e.logged_at).toLocaleDateString('en-GB')}</small></div></div>)}</div> : <p>{mutual ? 'No mutual sends yet.' : 'No problems logged yet.'}</p>}</> : <>
 <section><h2>Add a friend</h2><p>Enter their full display name. Accepted friends can see each other's logbooks.</p><form className="friend-search" onSubmit={async e=>{e.preventDefault();setBusy(true);setError('');setResults(null);try{setResults(await request('search',{name}));}catch(e){setError(e.message);}finally{setBusy(false);}}}><label>Display name<input value={name} onChange={e=>{setName(e.target.value);setResults(null);}} required maxLength={120} placeholder="Your friend's display name"/></label><button className="primary" disabled={disabled}>Find climber</button></form>
 {results && <div aria-live="polite">{!results.length ? <p>No climbers found with that display name.</p> : <><p>{results.length>1 ? 'More than one climber uses this name. Ask your friend to use a distinctive display name if you are unsure which account is theirs.' : 'Send an invite to this climber.'}</p>{results.map(p=>{const existing=people.find(person=>person.id===p.id);return <div className="problem-row" key={p.id}><span><strong>{p.display_name}</strong>{results.length>1 && <small className="friend-account">Account {p.id.slice(0,8)}</small>}</span>{existing ? <span>{existing.status==='accepted'?'Friends':existing.incoming?'Invite received':'Invite sent'}</span> : <button className="secondary" disabled={disabled} onClick={()=>act('request',p.id)}>Send invite</button>}</div>;})}</>}</div>}</section>
 {loading ? <p role="status">Loading friends...</p> : <>
 <section><h2>Invites received {incoming.length>0 && <span className="count">{incoming.length}</span>}</h2>{incoming.length ? incoming.map(p=><div className="problem-row" key={p.id}><strong>{p.name}</strong><div className="friend-actions"><button className="primary" disabled={disabled} onClick={()=>act('accept',p.id)}>Accept</button><button className="secondary" disabled={disabled} onClick={()=>act('decline',p.id)}>Decline</button></div></div>) : <p>No pending invites.</p>}</section>
 <section><h2>Your friends</h2>{accepted.length ? accepted.map(p=><div className="problem-row" key={p.id}><button className="friend-name" disabled={disabled} onClick={()=>view(p)}>{p.name}<small>View logbook</small></button><button className="secondary small" disabled={disabled} onClick={()=>{if(window.confirm(`Remove ${p.name} as a friend? You will no longer share logbooks.`))act('remove',p.id);}}>Remove friend</button></div>) : <p>No friends yet. Send an invite to get started.</p>}</section>
 <section><h2>Invites sent</h2>{outgoing.length ? outgoing.map(p=><div className="problem-row" key={p.id}><strong>{p.name}</strong><button className="secondary small" disabled={disabled} onClick={()=>act('remove',p.id)}>Cancel invite</button></div>) : <p>No outstanding invites.</p>}</section></>}
 </>}
 </div></article></main>;
}
