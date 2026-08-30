import assert from 'node:assert/strict';
import test from 'node:test';
import { createProvenanceDisclosure } from '../src/provenance-disclosure.js';

class FakeElement extends EventTarget {
  constructor(name) { super(); this.name = name; this.hidden = false; this.dataset = {}; this.attributes = new Map(); this.members = new Set([this]); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  contains(node) { return this.members.has(node); }
  include(...nodes) { nodes.forEach(node => this.members.add(node)); }
}

function dispatch(target, type, properties = {}) {
  const event = new Event(type, { cancelable: true });
  Object.entries(properties).forEach(([name, value]) => Object.defineProperty(event, name, { value }));
  target.dispatchEvent(event);
  return event;
}

function fixture() {
  const ownerDocument = new EventTarget();
  const root = new FakeElement('root');
  const trigger = new FakeElement('trigger');
  const panel = new FakeElement('panel');
  const outside = new FakeElement('outside');
  root.include(trigger, panel);
  return { ownerDocument, root, trigger, panel, outside, disclosure: createProvenanceDisclosure({ root, trigger, panel, ownerDocument }) };
}

test('the provenance panel has no visible chrome at rest and exposes its ARIA state', () => {
  const { root, trigger, panel, disclosure } = fixture();
  assert.equal(panel.hidden, true);
  assert.equal(panel.getAttribute('aria-hidden'), 'true');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(root.dataset.provenanceOpen, 'false');
  disclosure.destroy();
});

test('hover and keyboard focus reveal without trapping pointer or keyboard', () => {
  const { root, trigger, panel, outside, disclosure } = fixture();
  dispatch(root, 'pointerenter');
  assert.equal(panel.hidden, false);
  dispatch(root, 'pointerleave');
  assert.equal(panel.hidden, true);

  dispatch(root, 'focusin', { target: trigger });
  assert.equal(panel.hidden, false);
  const focusOut = dispatch(root, 'focusout', { relatedTarget: outside });
  assert.equal(panel.hidden, true);
  assert.equal(focusOut.defaultPrevented, false);
  disclosure.destroy();
});

test('touch/click toggles, outside press dismisses, and Escape dismisses', () => {
  const { ownerDocument, root, trigger, panel, outside, disclosure } = fixture();
  dispatch(trigger, 'click');
  assert.equal(panel.hidden, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'true');
  dispatch(ownerDocument, 'pointerdown', { target: outside });
  assert.equal(panel.hidden, true);

  dispatch(trigger, 'click');
  const escape = dispatch(ownerDocument, 'keydown', { key: 'Escape' });
  assert.equal(panel.hidden, true);
  assert.equal(escape.defaultPrevented, false);

  dispatch(trigger, 'click');
  dispatch(trigger, 'click');
  assert.equal(panel.hidden, true);
  assert.equal(root.dataset.provenanceOpen, 'false');
  disclosure.destroy();
});
