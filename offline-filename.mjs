export function offlineFilename(name) {
 let safe=String(name || '').normalize('NFKD').replace(/[^a-zA-Z0-9 _-]/g,'').trim().slice(0,80).trim() || 'Location';
 if(/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(safe))safe='Location '+safe;
 return safe+'.html';
}
