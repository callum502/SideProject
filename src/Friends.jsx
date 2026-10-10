import Avatar from './Avatar';
import BackLink from './BackLink';
﻿import React, {useEffect,useState} from 'react';
import {problemHref} from './Problems';
async function request(action,values={},signal) {
 const response=await fetch('/api/friends',{signal,method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,...values})});
 const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not update Friends.');return data;
}
export default function Friends() {
 const [people,setPeople]=useState([]),[notice,setNotice]=useState(''),[name,setName]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[friend,setFriend]=useState(null),[mutual,setMutual]=useState(false);
 useEffect(()=>{let active=true;request('list').then(data=>{if(active)setPeople(data);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[]);
 const [suggestions,setSuggestions]=useState([]),[searching,setSearching]=useState(false),[searchError,setSearchError]=useState('');
 useEffect(()=>{
  setSuggestions([]);setSearchError('');
  if(!name.trim() || friend){setSearching(false);return;}
  const controller=new AbortController();let active=true;setSearching(true);
  const timer=setTimeout(()=>request('suggest',{name:name.trim()},controller.signal).then(data=>{if(active)setSuggestions(data);}).catch(e=>{if(active && e.name!=='AbortError')setSearchError(e.message);}).finally(()=>{if(active)setSearching(false);}),300);
  return()=>{active=false;clearTimeout(timer);controller.abort();};
 },[name,friend]);
 async function act(action,target) {
  setBusy(true);setError('');try {setPeople(await request(action,{target}));}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function view(person) {
  setBusy(true);setError('');try{setFriend(await request('logbook',{target:person.id}));setMutual(false);}catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function invite(e) {
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');setNotice('');
  try {
   const matches=await request('search',{name:name.trim()});
   if(!matches.length){setNotice('No user with that name.');return;}
   if(matches.length!==1)throw Error('More than one account has that name. Please ask your friend to choose a unique display name.');
   const target=matches[0];
   const updated=await request('request',{target:target.id});setPeople(updated);
   const relationship=updated.find(person=>person.id===target.id);
   setNotice(relationship?.status==='accepted' ? 'You are already friends.' : relationship?.incoming ? 'This climber has already invited you. Accept their invite below.' : 'Invite sent.');
   setName('');
  } catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const accepted=people.filter(p=>p.status==='accepted'),incoming=people.filter(p=>p.status==='pending'&&p.incoming),outgoing=people.filter(p=>p.status==='pending'&&!p.incoming);
 const entries=friend?.entries.filter(e=>!mutual || e.mutual) || [];
 const disabled=busy || loading;
 return <main className="location-page"><article className="detail-panel logbook-page"><div className="detail-banner">
 {friend ? <button className="logbook-back" onClick={()=>setFriend(null)}><span aria-hidden="true">&larr;</span> Friends</button> : <BackLink/>}
 <div className="eyebrow">YOUR CLIMBING COMMUNITY</div><h1>{friend ? `${friend.name}'s logbook` : 'Friends'}</h1><p>{friend ? `${friend.entries.length} problems completed` : 'Connect with friends and compare your sends.'}</p></div>
 <div className="logbook-content friends-content">{error && <p className="error" role="alert">{error}</p>}
 {friend ? <><div className="friends-filters"><button className={!mutual?'primary':'secondary'} aria-pressed={!mutual} onClick={()=>setMutual(false)}>All sends</button><button className={mutual?'primary':'secondary'} aria-pressed={mutual} onClick={()=>setMutual(true)}>Mutual sends</button></div>{entries.length ? <div className="problem-list">{entries.map(e=><div className="problem-row" key={e.entry_id}><div>{e.problem_id ? <a href={problemHref(e.location_id,e.boulder_id,e.problem_id)}><strong>{e.grade} - {e.problem_name}</strong></a> : <strong>{e.grade} - {e.problem_name} (deleted)</strong>}{e.mutual && <span className="logged-badge">Both completed</span>}<p>{e.location_name} &middot; {e.boulder_name}</p><small>Logged {new Date(e.logged_at).toLocaleDateString('en-GB')}</small></div></div>)}</div> : <p>{mutual ? 'No mutual sends yet.' : 'No problems logged yet.'}</p>}</> : <>
 <section><h2>Add a friend</h2><p>Start typing a display name to find your friend.</p><form className="friend-search" onSubmit={invite}><label>Display name<input value={name} disabled={disabled} onChange={e=>{setName(e.target.value);setNotice('');}} required maxLength={120} placeholder="Your friend's display name"/></label><button className="primary" disabled={disabled}>Send invite</button></form>
 {name.trim() && <div className="friend-suggestions" aria-label="Matching climbers" aria-busy={searching}>
 {searching ? <p role="status">Searching...</p> : searchError ? <p className="error" role="alert">{searchError}</p> : suggestions.length ? <ul>{suggestions.map(person=>{
 const relationship=people.find(p=>p.id===person.id);
 return <li key={person.id}><a className="friend-identity" href={`#user=${encodeURIComponent(person.id)}`}><Avatar id={person.id} name={person.display_name}/><strong>{person.display_name}</strong></a>{relationship ? <span>{relationship.status==='accepted'?'Friends':relationship.incoming?'Invite received':'Invite sent'}</span> : <button className="secondary small" disabled={disabled} onClick={()=>act('request',person.id)}>Send invite<span className="sr-only"> to {person.display_name}</span></button>}</li>;
 })}</ul> : <p role="status">No user with that name.</p>}
 </div>}
 {notice && <p role="status">{notice}</p>}</section>
 {loading ? <p role="status">Loading friends...</p> : <>
 <section><h2>Invites received {incoming.length>0 && <span className="count">{incoming.length}</span>}</h2>{incoming.length ? incoming.map(p=><div className="problem-row" key={p.id}><a className="friend-identity" href={`#user=${encodeURIComponent(p.id)}`}><Avatar id={p.id} name={p.name}/><strong>{p.name}</strong></a><div className="friend-actions"><button className="primary" disabled={disabled} onClick={()=>act('accept',p.id)}>Accept</button><button className="secondary" disabled={disabled} onClick={()=>act('decline',p.id)}>Decline</button></div></div>) : <p>No pending invites.</p>}</section>
 <section><h2>Your friends</h2>{accepted.length ? accepted.map(p=><div className="problem-row" key={p.id}><a className="friend-identity" href={`#user=${encodeURIComponent(p.id)}`}><Avatar id={p.id} name={p.name}/><strong>{p.name}</strong></a><div className="friend-actions"><button className="secondary small" disabled={disabled} onClick={()=>view(p)}>View logbook</button><button className="secondary small friend-remove" disabled={disabled} onClick={()=>{if(window.confirm(`Remove ${p.name} as a friend? They will be removed from your friends list.`))act('remove',p.id);}}>Remove friend</button></div></div>) : <p>No friends yet. Send an invite to get started.</p>}</section>
 <section><h2>Invites sent</h2>{outgoing.length ? outgoing.map(p=><div className="problem-row" key={p.id}><a className="friend-identity" href={`#user=${encodeURIComponent(p.id)}`}><Avatar id={p.id} name={p.name}/><strong>{p.name}</strong></a><button className="secondary small" disabled={disabled} onClick={()=>act('remove',p.id)}>Cancel invite</button></div>) : <p>No outstanding invites.</p>}</section></>}
 </>}
 </div></article></main>;
}
