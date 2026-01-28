// scribble/src/core/__tests__/responseSchema.test.ts
import { describe, it, expect } from 'vitest';
import { ENGAGEMENT_RESPONSE_SCHEMA, parseEngagementResponse, type EngagementResponse } from '../responseSchema.js';

describe('EngagementResponse', () => {
  it('should have required schema properties', () => {
    expect(ENGAGEMENT_RESPONSE_SCHEMA.type).toBe('object');
    expect(ENGAGEMENT_RESPONSE_SCHEMA.properties.shouldRespond).toBeDefined();
    expect(ENGAGEMENT_RESPONSE_SCHEMA.required).toContain('shouldRespond');
  });

  it('should parse valid response with shouldRespond=false', () => {
    const json = '{"shouldRespond": false, "reason": "not addressed"}';
    const result = parseEngagementResponse(json);
    expect(result.shouldRespond).toBe(false);
    expect(result.reason).toBe('not addressed');
    expect(result.message).toBeUndefined();
  });

  it('should parse valid response with shouldRespond=true', () => {
    const json = '{"shouldRespond": true, "message": "Hello!"}';
    const result = parseEngagementResponse(json);
    expect(result.shouldRespond).toBe(true);
    expect(result.message).toBe('Hello!');
  });

  it('should throw on invalid JSON', () => {
    expect(() => parseEngagementResponse('not json')).toThrow();
  });

  it('should throw on missing shouldRespond', () => {
    expect(() => parseEngagementResponse('{"message": "hi"}')).toThrow();
  });
});
