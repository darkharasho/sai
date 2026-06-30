import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { jsonSchemaToZodShape } from '../../../electron/services/claudeBackend/jsonSchemaToZod';

describe('jsonSchemaToZodShape', () => {
  it('maps scalar types and marks non-required as optional', () => {
    const shape = jsonSchemaToZodShape({
      properties: {
        name: { type: 'string' },
        count: { type: 'number' },
        flag: { type: 'boolean' },
      },
      required: ['name'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ name: 'x', count: 1, flag: true }).success).toBe(true);
    expect(obj.safeParse({ count: 1 }).success).toBe(false); // name required
    expect(obj.safeParse({ name: 'x' }).success).toBe(true); // count/flag optional
  });

  it('maps enum to z.enum', () => {
    const shape = jsonSchemaToZodShape({
      properties: { chart: { type: 'string', enum: ['bar', 'line'] } },
      required: ['chart'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ chart: 'bar' }).success).toBe(true);
    expect(obj.safeParse({ chart: 'pie' }).success).toBe(false);
  });

  it('maps arrays of strings/numbers and free-form objects', () => {
    const shape = jsonSchemaToZodShape({
      properties: {
        labels: { type: 'array', items: { type: 'string' } },
        values: { type: 'array', items: { type: 'number' } },
        props: { type: 'object' },
        filters: { type: 'array', items: { type: 'object' } },
      },
      required: ['labels', 'values'],
    });
    const obj = z.object(shape);
    expect(obj.safeParse({ labels: ['a'], values: [1], props: { k: 'v' }, filters: [{ name: 'x' }] }).success).toBe(true);
    expect(obj.safeParse({ labels: [1], values: [1] }).success).toBe(false); // labels must be strings
  });

  it('handles an empty/absent properties object', () => {
    expect(jsonSchemaToZodShape({})).toEqual({});
    const obj = z.object(jsonSchemaToZodShape({}));
    expect(obj.safeParse({}).success).toBe(true);
  });

  it('falls back to z.unknown() for unrecognized types', () => {
    const shape = jsonSchemaToZodShape({ properties: { weird: { type: 'null' } } });
    const obj = z.object(shape);
    expect(obj.safeParse({ weird: 123 }).success).toBe(true); // unknown accepts anything
  });
});
