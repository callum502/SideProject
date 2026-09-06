const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const embed = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load a photo for export. Please try again.');
  const blob = await response.blob();
  return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not export an image.')); reader.readAsDataURL(blob); });
};
export async function exportGuide(place) {
  const boulders = await Promise.all(place.boulders.map(async b => {
    const photos = await Promise.all(b.images.map(async image => {
      const source = await embed(image.url);
      const marks = image.annotations.map(s => s.type === 'box' ? `<rect x="${Math.min(s.x,s.x2)}" y="${Math.min(s.y,s.y2)}" width="${Math.abs(s.x2-s.x)}" height="${Math.abs(s.y2-s.y)}"/>` : s.type === 'line' ? `<line x1="${s.x}" y1="${s.y}" x2="${s.x2}" y2="${s.y2}"/>` : `<polyline points="${s.points.map(p => p.join(',')).join(' ')}"/>`).join('');
      return `<figure><div class="photo"><img src="${source}" alt="${escape(image.name)}"/><svg viewBox="0 0 1000 1000" preserveAspectRatio="none">${marks}</svg></div><figcaption>${escape(image.name)}</figcaption></figure>`;
    }));
    return `<article><h2>${escape(b.name)}</h2><h3>Finding the Boulder</h3><p>${escape(b.notes || 'No directions to this boulder added yet.')}</p>${photos.join('')}</article>`;
  }));
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(place.name)} — SideProj</title><style>body{font:16px/1.65 system-ui,sans-serif;color:#263e30;background:#f5f7f1;max-width:900px;margin:40px auto;padding:24px}header,article{padding:28px;background:white;border:1px solid #dce3d5;border-radius:12px;margin-bottom:24px}h1{font-size:40px;margin:8px 0}h2{font-size:28px}p{white-space:pre-wrap;overflow-wrap:anywhere}.brand{font-size:13px;letter-spacing:3px}figure{margin:24px 0}.photo{position:relative;line-height:0}img{width:100%;height:auto}svg{position:absolute;inset:0;width:100%;height:100%;fill:none;stroke:#ff2929;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}svg *{vector-effect:non-scaling-stroke}figcaption,footer{color:#637359;font-size:14px}a{color:#244c3b}</style><header><div class="brand">△ SideProj · SHARED FIELD GUIDE</div><h1>${escape(place.name)}</h1><p>${escape(place.region)}</p>${place.latitude ? `<h3>Coordinates</h3><a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.latitude+','+place.longitude)}">${escape(place.latitude)}, ${escape(place.longitude)} ↗</a>` : ''}<h3>Approach notes</h3><p>${escape(place.approach || 'No approach notes added.')}</p></header>${boulders.join('')}<footer>Exported ${new Date().toLocaleDateString('en-GB')} · Check current access conditions before visiting.</footer></html>`;
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const link = window.document.createElement('a');
  link.href = url; link.download = `${place.name.replace(/[^a-z0-9]+/gi, '-').slice(0, 80) || 'climbing-guide'}.html`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

