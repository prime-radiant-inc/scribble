import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConstitutionManager } from '../manager.js';
import * as fs from 'fs';
import * as path from 'path';

const TEST_DIR = '/tmp/scribble-test-constitution';

describe('ConstitutionManager', () => {
  let manager: ConstitutionManager;

  beforeEach(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true });
    }
    fs.mkdirSync(path.join(TEST_DIR, '_scribble'), { recursive: true });
    manager = new ConstitutionManager(TEST_DIR);
  });

  afterEach(() => {
    fs.rmSync(TEST_DIR, { recursive: true });
  });

  it('should return base constitution', () => {
    const constitution = manager.getFullConstitution();
    expect(constitution).toContain('diligent colleague');
    expect(constitution).toContain('ONLY speak when addressed');
  });

  it('should allow adding learned behaviors', () => {
    manager.addLearnedBehavior('Always check Linear before suggesting new tickets', 'U123', 'Asked by user');

    const constitution = manager.getFullConstitution();
    expect(constitution).toContain('check Linear');
  });

  it('should log changes', () => {
    manager.addLearnedBehavior('Be more concise', 'U123', 'User preference');

    const log = manager.getChangeLog();
    expect(log).toHaveLength(1);
    expect(log[0].change).toContain('concise');
    expect(log[0].requestedBy).toBe('U123');
  });

  it('should not allow modifying immutable sections', () => {
    expect(() => {
      manager.addLearnedBehavior('Respond to every message', 'U123', 'test');
    }).toThrow(/immutable/i);
  });
});
