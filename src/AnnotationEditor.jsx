import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './ui';
import Shapes from './Shapes';

// The dialog for marking a problem's holds or line on a photo.
export default function AnnotationEditor({ image, close, save, busy, error }) {
  const [items, setItems] = useState(image.annotations),
    [draft, setDraft] = useState(null),
    [tool, setTool] = useState('start');
  const drawing = useRef(null),
    history = useRef([]),
    stage = useRef(null),
    activePointer = useRef(null);
  // Closing (Cancel, ✕ or Escape) with unsaved changes asks first, so a stray Escape can't throw away a drawing.
  // Undoing back to the saved annotations counts as no change. Nothing closes while saving.
  const unsaved = JSON.stringify(items) !== JSON.stringify(image.annotations);
  const tryClose = () => {
    if (!busy && (!unsaved || window.confirm('Discard your unsaved annotations?'))) close();
  };
  useEffect(() => {
    const element = stage.current;
    // Native, non-passive handlers keep iOS Safari from treating a drawing as scrolling.
    const preventScroll = e => {
      if (e.cancelable) e.preventDefault();
    };
    element.addEventListener('touchstart', preventScroll, { passive: false });
    element.addEventListener('touchmove', preventScroll, { passive: false });
    return () => {
      element.removeEventListener('touchstart', preventScroll);
      element.removeEventListener('touchmove', preventScroll);
    };
  }, []);
  function cancelDrawing(e) {
    if (activePointer.current !== e.pointerId) return;
    drawing.current = null;
    activePointer.current = null;
    setDraft(null);
  }

  function changeItems(next) {
    history.current.push(items);
    setItems(next);
  }
  function undo() {
    if (history.current.length) setItems(history.current.pop());
  }

  const point = e => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(1000, ((e.clientX - r.left) / r.width) * 1000)),
      Math.max(0, Math.min(1000, ((e.clientY - r.top) / r.height) * 1000)),
    ];
  };
  function start(e) {
    if (busy || tool === 'erase' || e.button !== 0 || activePointer.current !== null) return;
    e.preventDefault();
    activePointer.current = e.pointerId;
    e.currentTarget.setPointerCapture(e.pointerId);
    const [x, y] = point(e);
    drawing.current = {
      type: tool === 'start' ? 'box' : tool,
      color: tool === 'start' ? 'green' : 'red',
      x,
      y,
      x2: x,
      y2: y,
      points: [[x, y]],
    };
    setDraft(drawing.current);
  }
  function move(e) {
    if (!drawing.current || activePointer.current !== e.pointerId) return;
    e.preventDefault();
    const [x2, y2] = point(e);
    drawing.current = { ...drawing.current, x2, y2, points: [...drawing.current.points, [x2, y2]] };
    setDraft(drawing.current);
  }
  function finish(e) {
    if (!drawing.current || activePointer.current !== e.pointerId) return;
    e.preventDefault();
    move(e);
    const s = drawing.current;
    if (Math.abs(s.x2 - s.x) + Math.abs(s.y2 - s.y) > 2 || s.points.length > 3) changeItems([...items, s]);
    drawing.current = null;
    activePointer.current = null;
    setDraft(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  }
  return (
    <Modal title="Annotate photo" close={tryClose}>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="annotation-toolbar" role="group" aria-label="Drawing tools">
        {[
          ['start', '□ Start holds · green'],
          ['box', '□ Other holds · red'],
          ['arrow', '↗ Arrow'],
          ['line', '╱ Line'],
          ['freehand', '〰 Freehand'],
          ['erase', 'Erase'],
        ].map(([key, label]) => (
          <button
            key={key}
            className={'tool annotation-tool annotation-tool-' + key + (tool === key ? ' active' : '')}
            aria-pressed={tool === key}
            disabled={busy}
            onClick={() => setTool(key)}
          >
            {label}
          </button>
        ))}
        <button className="tool" disabled={busy || !history.current.length} onClick={undo}>
          ↶ Undo
        </button>
        <button className="tool" disabled={busy || !items.length} onClick={() => changeItems([])}>
          Clear
        </button>
      </div>
      <p className="annotation-help">Mark the holds or line for this problem</p>
      <div className="annotation-stage" ref={stage}>
        <img src={image.url} alt={image.name} draggable="false" />
        <Shapes
          items={items}
          draft={draft}
          className={tool === 'erase' ? 'annotation-erasing' : undefined}
          onErase={tool === 'erase' && !busy ? index => changeItems(items.filter((_, i) => i !== index)) : undefined}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={cancelDrawing}
          onLostPointerCapture={cancelDrawing}
          aria-label="Photo annotation canvas"
        />
      </div>
      <div className="form-actions">
        <button className="secondary" disabled={busy} onClick={tryClose}>
          Cancel
        </button>
        <button className="primary" disabled={busy} onClick={() => save(items)}>
          {busy ? 'Saving…' : 'Save annotations'}
        </button>
      </div>
    </Modal>
  );
}
