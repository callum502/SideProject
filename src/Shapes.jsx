import React from 'react';

// The marks drawn on a photo, in its 0–1000 coordinates. With onErase, each mark can be clicked to erase it.
export default function Shapes({ items, draft, onErase, ...props }) {
  function shape(s, hit = false) {
    const stroke = hit ? 'transparent' : s.color === 'green' ? '#35df79' : '#ff2929';
    const attrs = {
      stroke,
      ...(hit ? { strokeWidth: 18, pointerEvents: s.type === 'box' ? 'all' : 'stroke', fill: 'none' } : {}),
    };
    if (s.type === 'box')
      return (
        <rect
          {...attrs}
          x={Math.min(s.x, s.x2)}
          y={Math.min(s.y, s.y2)}
          width={Math.abs(s.x2 - s.x)}
          height={Math.abs(s.y2 - s.y)}
        />
      );
    if (s.type === 'arrow') {
      const angle = Math.atan2(s.y2 - s.y, s.x2 - s.x),
        size = Math.min(30, Math.hypot(s.x2 - s.x, s.y2 - s.y) / 2);
      return (
        <g {...attrs}>
          <line x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} />
          <polyline
            points={[
              [s.x2 - size * Math.cos(angle - 0.5), s.y2 - size * Math.sin(angle - 0.5)],
              [s.x2, s.y2],
              [s.x2 - size * Math.cos(angle + 0.5), s.y2 - size * Math.sin(angle + 0.5)],
            ]
              .map(p => p.join(','))
              .join(' ')}
          />
        </g>
      );
    }
    return s.type === 'line' ? (
      <line {...attrs} x1={s.x} y1={s.y} x2={s.x2} y2={s.y2} />
    ) : (
      <polyline {...attrs} points={s.points.map(p => p.join(',')).join(' ')} />
    );
  }
  return (
    <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" {...props}>
      <g opacity="0.5" pointerEvents={onErase ? 'none' : undefined}>
        {[...items, ...(draft ? [draft] : [])].map((s, i) => (
          <g key={i}>{shape(s)}</g>
        ))}
      </g>
      {onErase &&
        items.map((s, i) => (
          <g
            className="annotation-erase-target"
            key={i}
            onPointerDown={e => {
              if (e.button !== 0) return;
              e.preventDefault();
              e.stopPropagation();
              onErase(i);
            }}
          >
            {shape(s, true)}
          </g>
        ))}
    </svg>
  );
}
