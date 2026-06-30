import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

interface JsonProp {
  type?: string;
  enum?: string[];
  items?: JsonProp;
  description?: string;
}

interface JsonObjectSchema {
  properties?: Record<string, JsonProp>;
  required?: string[];
}

function leafToZod(prop: JsonProp | undefined): ZodTypeAny {
  if (prop && Array.isArray(prop.enum) && prop.enum.length > 0) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop?.type) {
    case 'string':
      return z.string();
    case 'number':
    case 'integer':
      return z.number();
    case 'boolean':
      return z.boolean();
    case 'object':
      return z.record(z.string(), z.unknown());
    case 'array':
      return z.array(prop?.items ? leafToZod(prop.items) : z.unknown());
    default:
      return z.unknown();
  }
}

/**
 * Convert a SAI tool's JSON Schema `input_schema` into a Zod raw shape suitable
 * for the claude-agent-sdk `tool()` helper. Only the small subset of JSON Schema
 * actually used by SAI_TOOL_SCHEMA is supported (string/number/boolean/object/
 * array + enum); anything else degrades to z.unknown() so a new schema never
 * throws at startup. Properties absent from `required` become optional.
 */
export function jsonSchemaToZodShape(schema: JsonObjectSchema): ZodRawShape {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const shape: ZodRawShape = {};
  for (const [key, prop] of Object.entries(properties)) {
    let zt = leafToZod(prop);
    if (prop && typeof prop.description === 'string') {
      zt = zt.describe(prop.description);
    }
    if (!required.has(key)) {
      zt = zt.optional();
    }
    shape[key] = zt;
  }
  return shape;
}
