import React,{useState,useEffect} from 'react';
export default function Avatar({id,name='',large=false,version=0,hasPhoto=true}) {
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[id,version]);
 return <span className={'avatar'+(large?' avatar-large':'')} aria-hidden="true">{id && hasPhoto && !failed ? <img src={`/api/profile-photo?id=${encodeURIComponent(id)}&v=${version}`} alt="" onError={()=>setFailed(true)}/> : <span>{name.trim().slice(0,1).toUpperCase() || '?'}</span>}</span>;
}
