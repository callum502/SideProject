import React, { useEffect, useRef } from 'react';

export const uid = () => crypto.randomUUID();
export const countLabel = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;
const symbols = { pin: '◎', mountain: '△', plus: '+', arrow: '↗', photo: '▧' };
export function Icon({ name }) {
  return (
    <span aria-hidden="true" className="icon">
      {symbols[name]}
    </span>
  );
}
// A native <dialog> shown modally. The page behind it is locked in place while open, and its scroll position is
// restored on close unless the dialog navigated somewhere else.
export function Modal({ title, children, close }) {
  const ref = useRef();
  useEffect(() => {
    const dialog = ref.current,
      body = document.body,
      root = document.documentElement;
    const scrollX = window.scrollX,
      scrollY = window.scrollY,
      hash = location.hash;
    const properties = ['position', 'top', 'left', 'width', 'overflow'];
    const previous = Object.fromEntries(properties.map(key => [key, body.style[key]]));
    const overflow = root.style.overflow;
    body.style.position = 'fixed';
    body.style.top = -scrollY + 'px';
    body.style.left = -scrollX + 'px';
    body.style.width = '100%';
    body.style.overflow = 'hidden';
    root.style.overflow = 'hidden';
    dialog.showModal();
    return () => {
      dialog.close();
      Object.assign(body.style, previous);
      root.style.overflow = overflow;
      if (location.hash === hash) window.scrollTo(scrollX, scrollY);
    };
  }, []);
  // Escape does what the ✕ button does, through the dialog's own close handler (which stays open while saving),
  // instead of letting the browser close the <dialog> behind React's back.
  return (
    <dialog
      ref={ref}
      onCancel={e => {
        e.preventDefault();
        close();
      }}
    >
      <div className="modal-heading">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="Close" onClick={close}>
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
