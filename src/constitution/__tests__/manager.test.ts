import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ConstitutionManager } from '../manager.js';
import { buildImmutablePatterns, renderBaseConstitution } from '../base.js';
import { Logger } from '../../utils/logger.js';
import { parseTenantConfig } from '../../config/tenantConfig.js';
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
    vi.restoreAllMocks();
  });

  it('should return base constitution', () => {
    const constitution = manager.getFullConstitution();
    expect(constitution).toContain('diligent colleague');
    expect(constitution).toContain('Engagement Rules');
  });

  it('describes Scribble-owned cross-channel memory without overclaiming identity', () => {
    const constitution = manager.getFullConstitution();

    expect(constitution).toContain('Scribble-provided context and tools');
    expect(constitution).not.toContain('perfect memory');
    expect(constitution).toContain('background context or `conversation_search`');
    expect(constitution).toContain('include clear relevance and attribution');
  });

  it('renders base constitution from tenant config', () => {
    const tenant = parseTenantConfig({
      SCRIBBLE_ORG_NAME: 'Acme Labs',
      SCRIBBLE_BOT_NAME: 'Scout',
      SCRIBBLE_BOT_ALIASES: 'scout,helper',
      SCRIBBLE_DECISION_LOG_CHANNEL: 'decisions',
      SCRIBBLE_WIKI_GIT_AUTHOR_NAME: 'Scout Bot',
      SCRIBBLE_WIKI_GIT_AUTHOR_EMAIL: 'scout@example.com',
    });
    manager = new ConstitutionManager(TEST_DIR, {
      tenant,
      integrations: { linear: true },
    });

    const constitution = manager.getFullConstitution();

    expect(constitution).toContain('You are Scout, a diligent colleague at Acme Labs');
    expect(constitution).toContain('Explicit @mention of you (@Scout)');
    expect(constitution).toContain('"Scout, can you..."');
    expect(constitution).toContain('"Hey Scout"');
    expect(constitution).toContain('"like Scout said"');
    expect(constitution).toContain('#decisions');
    expect(constitution).not.toContain('Prime Radiant');
  });

  it('formats Slack channel IDs without a prompt hash in decision-log guidance', () => {
    const tenant = parseTenantConfig({
      SCRIBBLE_DECISION_LOG_CHANNEL: 'C0A93A7H820',
    });

    const constitution = renderBaseConstitution(tenant, { linear: false });

    expect(constitution).toContain('messages in C0A93A7H820');
    expect(constitution).not.toContain('#C0A93A7H820');
  });

  it('renders Linear guidance only when the integration is enabled', () => {
    const tenant = parseTenantConfig({});

    const disabled = renderBaseConstitution(tenant, { linear: false });
    const enabled = renderBaseConstitution(tenant, { linear: true });

    expect(disabled).toContain('Linear tools are not configured');
    expect(disabled).not.toContain('Linear operations are available through the `linear` MCP tool');
    expect(enabled).toContain('Linear operations are available through the `linear` MCP tool');
    expect(enabled).not.toContain('Linear tools are not configured');
  });

  it('checks immutable identity overrides against escaped effective aliases', () => {
    const tenant = parseTenantConfig({
      SCRIBBLE_BOT_NAME: 'Scout+',
      SCRIBBLE_BOT_ALIASES: 'helper.bot',
    });
    manager = new ConstitutionManager(TEST_DIR, { tenant });

    expect(() => {
      manager.addLearnedBehavior('stop being helper.bot', 'U123', 'test');
    }).toThrow(/immutable/i);

    const patterns = buildImmutablePatterns(tenant);
    expect(patterns.some(pattern => pattern.test('stop being helperXbot'))).toBe(false);
    expect(patterns.some(pattern => pattern.test('stop being Scout+'))).toBe(true);
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

  it('rejects oversize learned behavior', () => {
    const huge = 'x'.repeat(2049);
    expect(() => manager.addLearnedBehavior(huge, 'tester', 'reason')).toThrow(/too long/i);
  });

  it('accepts learned behavior at 2048 chars', () => {
    const behavior = 'x'.repeat(2048);
    manager.addLearnedBehavior(behavior, 'tester', 'reason');

    expect(manager.getLearnedBehaviors()[0].behavior).toBe(behavior);
  });

  it('rejects empty learned behavior', () => {
    expect(() => manager.addLearnedBehavior('', 'tester', 'reason')).toThrow(/empty/i);
    expect(() => manager.addLearnedBehavior('   ', 'tester', 'reason')).toThrow(/empty/i);
  });

  it('rejects oversize learned behavior metadata', () => {
    const huge = 'x'.repeat(2049);

    expect(() => manager.addLearnedBehavior('Be concise', huge, 'reason')).toThrow(/requestedBy/i);
    expect(() => manager.addLearnedBehavior('Be concise', 'tester', huge)).toThrow(/reasoning/i);
  });

  it('rejects empty learned behavior metadata', () => {
    expect(() => manager.addLearnedBehavior('Be concise', '', 'reason')).toThrow(/requestedBy/i);
    expect(() => manager.addLearnedBehavior('Be concise', 'tester', '   ')).toThrow(/reasoning/i);
  });

  it('learned behavior log payload omits full behavior text', () => {
    const spy = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => {});
    const behavior = 'Sensitive behavior content here';

    manager.addLearnedBehavior(behavior, 'tester', 'reason');

    const addedCall = spy.mock.calls.find(call => String(call[0]).includes('Added learned behavior'));
    expect(addedCall).toBeDefined();
    const meta = addedCall![1] as Record<string, unknown>;
    expect(meta).not.toHaveProperty('behavior');
    expect(meta.behaviorId).toMatch(/^lb_/);
    expect(meta.behaviorLength).toBe(behavior.length);
  });

  it('failed change-log warning omits full behavior text', () => {
    const spy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
    const behavior = 'Sensitive behavior content here';
    (manager as any).logFile = path.join(TEST_DIR, '_scribble', 'missing', 'constitution-log.json');

    manager.addLearnedBehavior(behavior, 'tester', 'reason');

    const warning = spy.mock.calls.find(call => String(call[0]).includes('Failed to write change log'));
    expect(warning).toBeDefined();
    const meta = warning![1] as Record<string, unknown>;
    expect(meta).not.toHaveProperty('change');
    expect(meta).toHaveProperty('changeLength', behavior.length);
    expect(meta).toHaveProperty('error');
  });

  describe('channel instructions', () => {
    it('should store instruction with channelId only', () => {
      manager.addChannelInstruction({ channelId: 'C123ABC', instruction: 'Log all decisions', requestedBy: 'Jesse' });

      const instructions = manager.getChannelInstructions();
      expect(instructions).toHaveLength(1);
      expect(instructions[0].channelId).toBe('C123ABC');
      expect(instructions[0].channelName).toBeUndefined();
      expect(instructions[0].instruction).toBe('Log all decisions');
    });

    it('should store instruction with channelName only', () => {
      manager.addChannelInstruction({ channelName: 'morning-standup', instruction: 'Track standups', requestedBy: 'Jesse' });

      const instructions = manager.getChannelInstructions();
      expect(instructions).toHaveLength(1);
      expect(instructions[0].channelName).toBe('morning-standup');
      expect(instructions[0].channelId).toBeUndefined();
    });

    it('should store instruction with both channelId and channelName', () => {
      manager.addChannelInstruction({
        channelId: 'C123ABC',
        channelName: 'morning-standup',
        instruction: 'Track standups',
        requestedBy: 'Jesse',
      });

      const instructions = manager.getChannelInstructions();
      expect(instructions).toHaveLength(1);
      expect(instructions[0].channelId).toBe('C123ABC');
      expect(instructions[0].channelName).toBe('morning-standup');
    });

    it('should reject instruction with neither channelId nor channelName', () => {
      expect(() => {
        manager.addChannelInstruction({ instruction: 'Do stuff', requestedBy: 'Jesse' });
      }).toThrow(/channel/i);
    });

    it('rejects oversize instruction', () => {
      const huge = 'x'.repeat(2049);
      expect(() => manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction: huge,
        requestedBy: 'tester',
      })).toThrow(/too long/i);
    });

    it('accepts instruction at 2048 chars', () => {
      const instruction = 'x'.repeat(2048);
      manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction,
        requestedBy: 'tester',
      });

      expect(manager.getChannelInstructions()[0].instruction).toBe(instruction);
    });

    it('rejects empty instruction', () => {
      expect(() => manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction: '',
        requestedBy: 'tester',
      })).toThrow(/empty/i);
      expect(() => manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction: '   ',
        requestedBy: 'tester',
      })).toThrow(/empty/i);
    });

    it('rejects oversize instruction metadata', () => {
      const huge = 'x'.repeat(2049);

      expect(() => manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction: 'Be concise',
        requestedBy: huge,
      })).toThrow(/requestedBy/i);
    });

    it('rejects empty instruction metadata', () => {
      expect(() => manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction: 'Be concise',
        requestedBy: '   ',
      })).toThrow(/requestedBy/i);
    });

    it('channel instruction log payload omits full instruction text', () => {
      const spy = vi.spyOn(Logger.prototype, 'info').mockImplementation(() => {});
      const instruction = 'Sensitive instruction content';

      manager.addChannelInstruction({
        channelId: 'C0A93A7H820',
        instruction,
        requestedBy: 'tester',
      });

      const addedCall = spy.mock.calls.find(call => String(call[0]).includes('Added channel instruction'));
      expect(addedCall).toBeDefined();
      const meta = addedCall![1] as Record<string, unknown>;
      expect(meta).not.toHaveProperty('instruction');
      expect(meta.instructionId).toMatch(/^ci_/);
      expect(meta.instructionLength).toBe(instruction.length);
    });

    it('should look up by channelId', () => {
      manager.addChannelInstruction({ channelId: 'C123', channelName: 'general', instruction: 'Be nice', requestedBy: 'Jesse' });
      manager.addChannelInstruction({ channelId: 'C456', channelName: 'standup', instruction: 'Track tasks', requestedBy: 'Jesse' });

      const result = manager.getChannelInstructions({ channelId: 'C123' });
      expect(result).toHaveLength(1);
      expect(result[0].instruction).toBe('Be nice');
    });

    it('should look up by channelName', () => {
      manager.addChannelInstruction({ channelId: 'C123', channelName: 'general', instruction: 'Be nice', requestedBy: 'Jesse' });
      manager.addChannelInstruction({ channelId: 'C456', channelName: 'standup', instruction: 'Track tasks', requestedBy: 'Jesse' });

      const result = manager.getChannelInstructions({ channelName: 'standup' });
      expect(result).toHaveLength(1);
      expect(result[0].instruction).toBe('Track tasks');
    });

    it('should match by channelId even when query only has channelName stored', () => {
      // Instruction was stored with only channelId
      manager.addChannelInstruction({ channelId: 'C123', instruction: 'Be nice', requestedBy: 'Jesse' });

      // Lookup with channelId should find it
      const result = manager.getChannelInstructions({ channelId: 'C123' });
      expect(result).toHaveLength(1);
    });

    it('should match by channelName even when instruction only has channelId stored', () => {
      // Instruction stored with both
      manager.addChannelInstruction({ channelId: 'C123', channelName: 'general', instruction: 'Be nice', requestedBy: 'Jesse' });

      // Lookup by name only
      const result = manager.getChannelInstructions({ channelName: 'general' });
      expect(result).toHaveLength(1);
    });

    it('should match when lookup provides both and instruction has either', () => {
      // One instruction with only ID, one with only name
      manager.addChannelInstruction({ channelId: 'C123', instruction: 'Rule A', requestedBy: 'Jesse' });
      manager.addChannelInstruction({ channelName: 'general', instruction: 'Rule B', requestedBy: 'Jesse' });

      // Lookup with both — should find both (they could be the same channel)
      const result = manager.getChannelInstructions({ channelId: 'C123', channelName: 'general' });
      expect(result).toHaveLength(2);
    });

    it('should be case-insensitive on channelName', () => {
      manager.addChannelInstruction({ channelName: 'Morning-Standup', instruction: 'Track tasks', requestedBy: 'Jesse' });

      const result = manager.getChannelInstructions({ channelName: 'morning-standup' });
      expect(result).toHaveLength(1);
    });

    it('should be case-insensitive on channelId', () => {
      manager.addChannelInstruction({ channelId: 'c0a93a7h820', instruction: 'Track tasks', requestedBy: 'Jesse' });

      const result = manager.getChannelInstructions({ channelId: 'C0A93A7H820' });
      expect(result).toHaveLength(1);
    });

    it('should format instructions for channel using both ID and name', () => {
      manager.addChannelInstruction({ channelId: 'C123', channelName: 'standup', instruction: 'Track daily tasks', requestedBy: 'Jesse' });

      const formatted = manager.getInstructionsForChannel({ channelId: 'C123', channelName: 'standup' });
      expect(formatted).toContain('Track daily tasks');
      expect(formatted).toContain('standup');
    });

    it('should format instructions matching by ID when name was not stored', () => {
      manager.addChannelInstruction({ channelId: 'C123', instruction: 'Track daily tasks', requestedBy: 'Jesse' });

      const formatted = manager.getInstructionsForChannel({ channelId: 'C123', channelName: 'standup' });
      expect(formatted).toContain('Track daily tasks');
    });

    it('should return empty string when no instructions match', () => {
      manager.addChannelInstruction({ channelId: 'C123', instruction: 'Irrelevant', requestedBy: 'Jesse' });

      const formatted = manager.getInstructionsForChannel({ channelId: 'C999', channelName: 'other' });
      expect(formatted).toBe('');
    });

    it('should remove instruction by id', () => {
      manager.addChannelInstruction({ channelId: 'C123', channelName: 'general', instruction: 'Rule A', requestedBy: 'Jesse' });
      const instructions = manager.getChannelInstructions();
      const id = instructions[0].id;

      manager.removeChannelInstruction(id);

      expect(manager.getChannelInstructions()).toHaveLength(0);
    });
  });
});
