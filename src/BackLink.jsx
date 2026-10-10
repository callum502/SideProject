import React from 'react';
import {goBack} from './navigation.mjs';
export default function BackLink({fallback='#explore',className='logbook-back'}) {
 return <a className={className} href={fallback} aria-label="Back to previous page" onClick={e=>{
  if(e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)return;
  e.preventDefault();goBack(fallback);
 }}><span aria-hidden="true">&larr;</span> Back</a>;
}
