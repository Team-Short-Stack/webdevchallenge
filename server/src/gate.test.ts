import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { StreamGate } from './gate.js';

describe('StreamGate', () => {
  it('only lets in as many streams as it granted', () => {
    const gate = new StreamGate(1000, () => 0);
    assert.equal(gate.consume(), false);
    gate.grant();
    assert.equal(gate.consume(), true);
    assert.equal(gate.consume(), false);
  });

  it('expires grants', () => {
    let t = 0;
    const gate = new StreamGate(1000, () => t);
    gate.grant();
    t = 1001;
    assert.equal(gate.pending, 0);
    assert.equal(gate.consume(), false);
  });
});
