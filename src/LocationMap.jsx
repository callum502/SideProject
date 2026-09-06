import React, { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export default function LocationMap({ locations, selectedId, onSelect }) {
  const container = useRef(null), map = useRef(null), markers = useRef([]);
  const select = useRef(onSelect);
  select.current = onSelect;
  const [tileError, setTileError] = useState(false);
  const points = useMemo(() => locations.filter(l =>
    l.latitude !== null && l.longitude !== null &&
    String(l.latitude ?? '').trim() !== '' && String(l.longitude ?? '').trim() !== '' &&
    Number.isFinite(Number(l.latitude)) && Number.isFinite(Number(l.longitude)) &&
    Math.abs(Number(l.latitude)) <= 90 && Math.abs(Number(l.longitude)) <= 180
  ), [locations]);

  useEffect(() => {
    const instance = L.map(container.current, { scrollWheelZoom: false }).setView([20, 0], 2);
    map.current = instance;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).on('tileerror', () => setTileError(true)).addTo(instance);
    const observer = new ResizeObserver(() => instance.invalidateSize());
    observer.observe(container.current);
    return () => { observer.disconnect(); instance.remove(); map.current = null; };
  }, []);

  useEffect(() => {
    const instance = map.current;
    const layer = L.layerGroup().addTo(instance);
    markers.current = points.map(place => {
      const label = document.createElement('span'); label.textContent = place.name;
      const marker = L.marker([Number(place.latitude), Number(place.longitude)], {
        icon: L.divIcon({ className: 'location-blip', html: '<span></span>', iconSize: [30, 30], iconAnchor: [15, 15] }),
        title: place.name, alt: `Open ${place.name}`, keyboard: true,
      }).bindTooltip(label, { direction: 'top', offset: [0, -12] })
        .on('click', () => select.current(place.id)).addTo(layer);
      return { id: place.id, marker };
    });
    if (points.length) instance.fitBounds(points.map(l => [Number(l.latitude), Number(l.longitude)]), { padding: [40, 40], maxZoom: 13 });
    else instance.setView([20, 0], 2);
    return () => { layer.remove(); markers.current = []; };
  }, [points]);

  useEffect(() => {
    for (const { id, marker } of markers.current) {
      const active = id === selectedId;
      marker.getElement()?.classList.toggle('selected', active);
      marker.setZIndexOffset(active ? 1000 : 0);
      if (active) map.current.panInside(marker.getLatLng(), { padding: [35, 35] });
    }
  }, [selectedId, points]);

  return <section className="location-map-section" aria-labelledby="map-heading">
    <div className="section-heading"><div><h2 id="map-heading">Locations map</h2><p>Click a marker to explore a location.</p></div><span className="count">{points.length} mapped</span></div>
    <div ref={container} className="location-map" aria-label="Map of climbing locations" />
    {!points.length && <p className="map-note">Add coordinates to a location to place it on the map.</p>}
    {locations.length > points.length && points.length > 0 && <p className="map-note">{locations.length - points.length} locations need coordinates to appear on the map.</p>}
    {tileError && <p className="map-note" role="status">Map tiles could not load. Check your connection; you can still select locations using the search above.</p>}
  </section>;
}
