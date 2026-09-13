import React,{useState} from 'react';
import ProfileFields from './ProfileFields';
export default function CompleteProfile({user,onComplete}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 return <main className="login-page"><div className="login-layout"><section className="login-card"><div className="auth-heading"><h1>Complete your profile</h1><p>Choose your display name and add your height before continuing.</p></div><form onSubmit={async e=>{e.preventDefault();const values=Object.fromEntries(new FormData(e.currentTarget));setBusy(true);setError('');try{const response=await fetch('/api/profile',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(values)});const data=await response.json();if(!response.ok)throw Error(data.error || 'Could not save your profile.');onComplete(data.user);}catch(e){setError(e.message);}finally{setBusy(false);}}}><fieldset className="auth-fields" disabled={busy}><ProfileFields user={user}/>{error&&<p className="error" role="alert">{error}</p>}<button className="primary auth-submit">{busy?'Saving...':'Continue'}</button></fieldset></form></section></div></main>;
}
