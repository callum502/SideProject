import { loadEnv } from 'vite';
import { BUCKET, mediaReference, mediaUrl, MAX_VIDEO_BYTES } from './media-reference.mjs';
const fail = (message, status = 503) => Object.assign(new Error(message), { status });

export function createStorage({ env = { ...loadEnv('development', process.cwd(), ''), ...process.env }, fetchImpl = fetch } = {}) {
  const base = env.SUPABASE_URL?.replace(/\/$/,'');
  function objectPath(path) {
    if (!mediaReference('/media/'+path)) throw fail('Invalid Storage path.',400);
    return `${BUCKET}/${path}`;
  }
  async function request(route, token, options = {}) {
    if (!base || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Configure Supabase Storage first.');
    try { return await fetchImpl(base+'/storage/v1/'+route, { ...options, headers: { apikey:env.SUPABASE_PUBLISHABLE_KEY, Authorization:`Bearer ${token}`, ...options.headers }, signal:AbortSignal.timeout(180000) }); }
    catch { throw fail('Storage request could not be confirmed. You can retry; existing files are not overwritten.'); }
  }
  async function check(response) {
    if (response.ok) return;
    const detail=await response.json().catch(()=>null);
    if (JSON.stringify(detail).includes('10 GB upload allowance')) throw fail('This upload would exceed your 10 GB upload allowance.',400);
    if (response.status===413) throw fail('File exceeds the Supabase Storage size limit.',413);
    if (response.status===401 || response.status===403) throw fail('Storage access was denied. Check your login and the Storage migration.',403);
    throw fail('Storage request failed. Check the bucket, policies and file-size settings.');
  }
  async function usage(token) {
    if (!base || !env.SUPABASE_PUBLISHABLE_KEY) throw fail('Configure Supabase Storage first.');
    let response;
    try { response=await fetchImpl(base+'/rest/v1/rpc/my_storage_usage',{method:'POST',headers:{apikey:env.SUPABASE_PUBLISHABLE_KEY,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)}); }
    catch { throw fail('Could not check your upload allowance. Please try again.'); }
    const data=await response.json().catch(()=>null);
    if (!response.ok) throw fail(data?.code==='PGRST202' ? 'Apply the user storage limit SQL migration before uploading.' : 'Could not check your upload allowance. Please try again.');
    if (!Number.isSafeInteger(data?.usedBytes) || data.usedBytes<0 || data.limitBytes!==10000000000) throw fail('Could not verify your upload allowance.');
    return data;
  }
  const publicUrl = path => `${base}/storage/v1/object/public/${objectPath(path)}`;
  return {
    publicUrl,
    async download(path,signal) {
      const response=await fetchImpl(publicUrl(path),{signal:AbortSignal.any([signal,AbortSignal.timeout(180000)]),redirect:'error'});
      if(!response.ok || !response.body)throw fail('A photo or video could not be downloaded. Please retry the location download.');
      return response;
    },
    usage,
    async stat(path,token) {
      const r=await request('object/authenticated/'+objectPath(path),token,{method:'HEAD'});await check(r);
      const size=Number(r.headers.get('content-length'));
      if(!Number.isSafeInteger(size)||size<=0)throw fail('Could not verify the uploaded file size.');
      return { size, mime:r.headers.get('content-type')?.split(';')[0] };
    },
    async upload(path,bytes,mime,token) {
      const limit=mime.startsWith('image/')?8*1024*1024:MAX_VIDEO_BYTES;
      if(bytes.length>limit)throw fail(`File is too large (${mime.startsWith('image/')?'8':'100'} MB maximum).`,413);
      objectPath(path);
      const allowance=await usage(token);
      if(allowance.usedBytes+bytes.length>allowance.limitBytes) throw fail('This upload would exceed your 10 GB upload allowance.',400);
      const r=await request('object/'+objectPath(path),token,{method:'POST',headers:{'Content-Type':mime,'x-upsert':'false','Cache-Control':'max-age=3600'},body:bytes});
      await check(r);
      return {url:mediaUrl(BUCKET,path)};
    },
  };
}
