import BackLink from './BackLink';
﻿import React,{useEffect,useState} from 'react';
export function CreatorLink({item}) {
 const name=item.createdByName || 'Climber';
 return item.createdBy ? <a href={`#user=${encodeURIComponent(item.createdBy)}`}>{name}</a> : <span>{name}</span>;
}
export default function PublicProfile({id,user}) {
 const [profile,setProfile]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setProfile(null);
 fetch('/api/public-profile?id='+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not load profile.');return data;}).then(setProfile).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[id]);
 const inches=profile?.height ? Math.round(profile.height/2.54):null;
 return <main className="location-page"><article className="detail-panel logbook-page public-profile"><div className="detail-banner"><BackLink/><div className="eyebrow">CLIMBER PROFILE</div><h1>{profile?.name || 'Profile'}</h1>{profile && <><dl className="profile-measurements"><div><dt>Height</dt><dd>{inches===null?'Not provided':`${Math.floor(inches/12)} ft ${inches%12} In`}</dd></div><div><dt>Ape index</dt><dd>{profile.apeIndex==null?'Not sure':`${profile.apeIndex>0?'+':''}${profile.apeIndex} In`}</dd></div></dl>{user?.id===id && <a className="logbook-back" href="#details">Edit profile</a>}</>}</div><div className="logbook-content">
 {loading && <p role="status">Loading profile...</p>}{error && <p className="error" role="alert">{error}</p>}
 {profile && <><div className="section-heading"><h2>Logged climbs <span className="count">{profile.entries.length}</span></h2>{user?.id===id && <a href="#logbook">Manage logbook</a>}</div>{!profile.entries.length ? <p>No climbs logged yet.</p> : <div className="problem-list">{profile.entries.map(entry=><div className="problem-row" key={entry.entry_id}><div>{entry.problem_id ? <a href={`#${new URLSearchParams({location:entry.location_id,boulder:entry.boulder_id,problem:entry.problem_id})}`}><strong>{entry.grade} - {entry.problem_name}</strong></a> : <strong>{entry.grade} - {entry.problem_name} (deleted)</strong>}<p>{entry.location_name} &middot; {entry.boulder_name}</p><small>Logged {new Date(entry.logged_at).toLocaleDateString('en-GB')}</small></div></div>)}</div>}</>}
 </div></article></main>;
}
