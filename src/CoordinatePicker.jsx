import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function CoordinatePicker({ initialLatitude = '', initialLongitude = '' }) {
  const [latitude, setLatitude] = useState(initialLatitude), [longitude, setLongitude] = useState(initialLongitude);
  const [tileError, setTileError] = useState(false);
  const container = useRef(null), map = useRef(null), marker = useRef(null), positioned = useRef(false);
  useEffect(() => {
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([20, 0], 2);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).addTo(instance);
    instance.on('click', e => {
      const point = e.latlng.wrap();
      positioned.current = true;
      setLatitude(Math.max(-90, Math.min(90, point.lat)).toFixed(6));
      setLongitude(point.lng.toFixed(6));
    });
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; marker.current = null; positioned.current = false; };
  }, []);

  useEffect(() => {
    const valid = String(latitude).trim() !== '' && String(longitude).trim() !== '' && Number.isFinite(+latitude) && Number.isFinite(+longitude) && Math.abs(+latitude) <= 90 && Math.abs(+longitude) <= 180;
    if (!valid) { marker.current?.remove(); marker.current = null; return; }
    const timer = setTimeout(() => {
      const point = [+latitude, +longitude];
      if (marker.current) marker.current.setLatLng(point);
      else marker.current = L.marker(point, {
        icon: L.divIcon({ className: 'location-blip selected', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: 'Selected location',
      }).addTo(map.current);
      if (!positioned.current) { map.current.setView(point, 13); positioned.current = true; }
      else map.current.panTo(point);
    }, 300);
    return () => clearTimeout(timer);
  }, [latitude, longitude]);

  return <div className="coordinate-picker"><div className="form-columns">
    <label>Latitude <span aria-hidden="true">*</span><input name="latitude" type="number" required step="any" min="-90" max="90" value={latitude} onChange={e => setLatitude(e.target.value)} placeholder="53.3470"/></label>
    <label>Longitude <span aria-hidden="true">*</span><input name="longitude" type="number" required step="any" min="-180" max="180" value={longitude} onChange={e => setLongitude(e.target.value)} placeholder="-1.6330"/></label>
    </div><p className="coordinate-help">Enter coordinates to preview the location, or click the map to choose a point.</p><div className="location-map coordinate-map" ref={container} aria-label="Choose location coordinates on the map"/>
    {tileError && <p className="coordinate-help" role="status">Map tiles could not load. You can still enter coordinates above.</p>}
  </div>;
}
