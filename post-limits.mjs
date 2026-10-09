export const POST_LIMITS = {locations:25,boulders:50,problems:250};
export const limitMessage = type => `You already have the maximum ${POST_LIMITS[type]} ${type}. Remove one before creating another.`;
export function enforcePostLimits(before, after, userId) {
 const flatten=guide=>{
  const locations=guide.locations;
  const boulders=locations.flatMap(l=>l.boulders || []);
  return {locations,boulders,problems:boulders.flatMap(b=>b.problems || [])};
 };
 const old=flatten(before),next=flatten(after);
 for(const [type,limit] of Object.entries(POST_LIMITS)) {
  const oldIds=new Set(old[type].map(item=>item.id));
  const owned=next[type].filter(item=>item.createdBy===userId);
  if(owned.length>limit && owned.some(item=>!oldIds.has(item.id))) throw Object.assign(new Error(limitMessage(type)),{status:400});
 }
}
