// Calls the app's API and returns the parsed JSON reply. Every error that reaches the UI is readable: a dropped
// connection or a non-JSON reply (such as a proxy's HTML error page while the server restarts) would otherwise show
// the browser's raw "Failed to fetch" or a JSON parse error. Cancelled requests still throw an AbortError.
// fallback is the message for an error reply that doesn't explain itself.
export async function api(path, options, fallback = 'Something went wrong. Please try again.') {
  let response;
  try { response = await fetch(path, options); }
  catch (e) { if (e.name === 'AbortError') throw e; throw new Error("Couldn't reach SideProj. Check your connection and try again."); }
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || (response.status >= 500 ? 'SideProj is having trouble right now. Please try again in a moment.' : fallback));
  if (data === null) throw new Error('Something went wrong. Please try again.');
  return data;
}
