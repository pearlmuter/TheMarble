export function createProvenanceDisclosure({ root, trigger, panel, ownerDocument }) {
  let hovered = false;
  let focused = false;
  let pinned = false;
  let dismissed = false;

  const render = () => {
    const open = !dismissed && (hovered || focused || pinned);
    panel.hidden = !open;
    panel.setAttribute('aria-hidden', String(!open));
    trigger.setAttribute('aria-expanded', String(open));
    root.dataset.provenanceOpen = String(open);
  };
  const onPointerEnter = () => { hovered = true; dismissed = false; render(); };
  const onPointerLeave = () => { hovered = false; dismissed = false; render(); };
  const onFocusIn = () => { focused = true; dismissed = false; render(); };
  const onFocusOut = event => {
    if (root.contains(event.relatedTarget)) return;
    focused = false;
    dismissed = false;
    render();
  };
  const onClick = () => {
    pinned = !pinned;
    dismissed = !pinned;
    render();
  };
  const dismiss = () => { pinned = false; dismissed = true; render(); };
  const onDocumentPointerDown = event => { if (!root.contains(event.target)) dismiss(); };
  const onDocumentKeyDown = event => { if (event.key === 'Escape') dismiss(); };

  root.addEventListener('pointerenter', onPointerEnter);
  root.addEventListener('pointerleave', onPointerLeave);
  root.addEventListener('focusin', onFocusIn);
  root.addEventListener('focusout', onFocusOut);
  trigger.addEventListener('click', onClick);
  ownerDocument.addEventListener('pointerdown', onDocumentPointerDown);
  ownerDocument.addEventListener('keydown', onDocumentKeyDown);
  render();

  return {
    destroy() {
      root.removeEventListener('pointerenter', onPointerEnter);
      root.removeEventListener('pointerleave', onPointerLeave);
      root.removeEventListener('focusin', onFocusIn);
      root.removeEventListener('focusout', onFocusOut);
      trigger.removeEventListener('click', onClick);
      ownerDocument.removeEventListener('pointerdown', onDocumentPointerDown);
      ownerDocument.removeEventListener('keydown', onDocumentKeyDown);
    },
  };
}
