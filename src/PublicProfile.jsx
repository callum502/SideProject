import Avatar from './Avatar';
import {useRef} from 'react';
import BackLink from './BackLink';
﻿import React,{useEffect,useState} from 'react';
export function CreatorLink({item}) {
 const name=item.createdByName || 'Climber';
 return item.createdBy ? <a className="creator-link" href={`#user=${encodeURIComponent(item.createdBy)}`}><Avatar id={item.createdBy} name={name}/>{name}</a> : <span>{name}</span>;
}
export default function PublicProfile({id,user,onLogsChange}) {
 const [profile,setProfile]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{const controller=new AbortController();setLoading(true);setError('');setProfile(null);
 fetch('/api/public-profile?id='+encodeURIComponent(id),{signal:controller.signal}).then(async response=>{const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not load profile.');return data;}).then(setProfile).catch(e=>{if(e.name!=='AbortError')setError(e.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});return()=>controller.abort();
 },[id]);
 const [uploading,setUploading]=useState(false),[photoVersion,setPhotoVersion]=useState(0);
 async function uploadPhoto(e) {
  const file=e.target.files?.[0];e.target.value='';if(!file)return;
  setError('');
  if(!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size>8*1024*1024){setError('Choose a JPEG, PNG or WebP image up to 8 MB.');return;}
  setUploading(true);
  try{
   const response=await fetch('/api/images',{method:'POST',headers:{'Content-Type':file.type},body:file});const data=await response.json();if(!response.ok)throw Error(data.error || 'Upload failed.');
   const saved=await fetch('/api/profile-photo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:data.url})});const result=await saved.json();if(!saved.ok)throw Error(result.error || 'Could not save photo.');
   setProfile(previous=>({...previous,hasPhoto:true}));
   setPhotoVersion(Date.now());
  }catch(e){setError(e.message);}finally{setUploading(false);}
 }
 const [removing,setRemoving]=useState(false);
 async function removePhoto() {
  if(uploading || removing)return;
  setRemoving(true);setError('');
  try {
   const response=await fetch('/api/profile-photo',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url:null})});
   const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not remove profile photo.');
   setProfile(previous=>({...previous,hasPhoto:false}));setPhotoVersion(Date.now());
  }catch(e){setError(e.message);}finally{setRemoving(false);}
 }
 const [removingEntry,setRemovingEntry]=useState(null);
 async function removeClimb(entry) {
  if(user?.id!==id || removingEntry)return;
  setRemovingEntry(entry.entry_id);setError('');
  try {
   const response=await fetch('/api/logbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({problemId:entry.problem_id || entry.entry_id,completed:false})});
   const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not remove climb.');
   const remaining=new Set(data.map(item=>item.entry_id));
   setProfile(previous=>({...previous,entries:previous.entries.filter(item=>remaining.has(item.entry_id))}));
   onLogsChange?.(data);
  }catch(e){setError(e.message);}finally{setRemovingEntry(null);}
 }
 const [deleteOpen,setDeleteOpen]=useState(false),[deleting,setDeleting]=useState(false),[deleteError,setDeleteError]=useState('');
 const deleteDialog=useRef(null);
 useEffect(()=>{if(deleteOpen)deleteDialog.current?.showModal();},[deleteOpen]);
 async function deleteAccount(e) {
  e.preventDefault();if(deleting)return;setDeleting(true);setDeleteError('');
  try{
   const confirmation=new FormData(e.currentTarget).get('confirmation');
   const response=await fetch('/api/account',{method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmation})});
   const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not delete account.');
   window.location.replace('/#login');
  }catch(e){setDeleteError(e.message);setDeleting(false);}
 }
 const inches=profile?.height ? Math.round(profile.height/2.54):null;
 return <main className="location-page"><article className="detail-panel logbook-page public-profile"><div className="detail-banner"><BackLink/><div className="eyebrow">CLIMBER PROFILE</div><div className="profile-identity">{profile && <Avatar id={id} name={profile.name} large version={photoVersion} hasPhoto={profile.hasPhoto}/>}<h1>{profile?.name || 'Profile'}</h1></div>{profile && <><dl className="profile-measurements"><div><dt>Height</dt><dd>{inches===null?'Not provided':`${Math.floor(inches/12)} ft ${inches%12} In`}</dd></div><div><dt>Ape index</dt><dd>{profile.apeIndex==null?'Not sure':`${profile.apeIndex>0?'+':''}${profile.apeIndex} In`}</dd></div></dl>{user?.id===id && <div className="profile-actions"><a className="logbook-back" href="#details">Edit profile</a><label className="logbook-back upload">{uploading ? 'Uploading...' : 'Upload profile photo'}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={uploading || removing} onChange={uploadPhoto}/></label>{profile.hasPhoto && <button className="logbook-back profile-photo-remove" disabled={uploading || removing} onClick={removePhoto}>{removing ? 'Removing...' : 'Remove profile photo'}</button>}</div>}</>}</div><div className="logbook-content">
 {loading && <p role="status">Loading profile...</p>}{error && <p className="error" role="alert">{error}</p>}
 {profile && <><div className="section-heading"><h2>Logged climbs <span className="count">{profile.entries.length}</span></h2></div>{!profile.entries.length ? <p>No climbs logged yet.</p> : <div className="problem-list">{profile.entries.map(entry=><div className="problem-row" key={entry.entry_id}><div>{entry.problem_id ? <a href={`#${new URLSearchParams({location:entry.location_id,boulder:entry.boulder_id,problem:entry.problem_id})}`}><strong>{entry.grade} - {entry.problem_name}</strong></a> : <strong>{entry.grade} - {entry.problem_name} (deleted)</strong>}<p>{entry.location_name} &middot; {entry.boulder_name}</p><small>Logged {new Date(entry.logged_at).toLocaleDateString('en-GB')}</small></div>{user?.id===id && <button className="secondary small" disabled={removingEntry!==null} onClick={()=>removeClimb(entry)} aria-label={`Remove ${entry.problem_name} from logged climbs`}>{removingEntry===entry.entry_id?'Removing...':'Remove'}</button>}</div>)}</div>}</>}
 {user?.id===id && <section className="account-delete-section"><button className="danger-button" onClick={()=>{setDeleteError('');setDeleteOpen(true);}}>Delete account</button></section>}
 </div></article>{deleteOpen && <dialog ref={deleteDialog} onCancel={e=>e.preventDefault()}><div className="modal-heading"><h2>Delete your account?</h2><button className="icon-button" disabled={deleting} aria-label="Close" onClick={()=>setDeleteOpen(false)}>&times;</button></div><p>This permanently deletes your account, profile, friends and logged climbs. This cannot be undone.</p><p>Your locations, boulders, problems and contributed photos/videos will remain, credited to Deleted User. Only admins will be able to edit or remove those submissions.</p><form onSubmit={deleteAccount}><label>Type DELETE to confirm<input name="confirmation" required pattern="DELETE" maxLength={6} autoComplete="off" disabled={deleting}/></label>{deleteError && <p className="error" role="alert">{deleteError}</p>}<div className="form-actions"><button type="button" className="secondary" disabled={deleting} onClick={()=>setDeleteOpen(false)}>Cancel</button><button className="danger-button" disabled={deleting}>{deleting?'Deleting...':'Permanently delete account'}</button></div></form></dialog>}</main>;
}
