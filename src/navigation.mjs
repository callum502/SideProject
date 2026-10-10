// Tag this tab's app history so Back never unexpectedly leaves the site.
const key='sideprojNavigationIndex';
let index=Number.isInteger(window.history.state?.[key]) ? window.history.state[key] : 0;
function stamp() { window.history.replaceState({...window.history.state,[key]:index},''); }
stamp();
function track() {
 const stored=window.history.state?.[key];
 if(Number.isInteger(stored)) index=stored;
 else { index++;stamp(); }
}
window.addEventListener('popstate',track);
window.addEventListener('hashchange',track);
export function goBack(fallback='#explore') {
 if(index>0) { window.history.back();return; }
 const oldURL=window.location.href;
 window.history.replaceState({...window.history.state,[key]:0},'',fallback);
 window.dispatchEvent(new HashChangeEvent('hashchange',{oldURL,newURL:window.location.href}));
}
