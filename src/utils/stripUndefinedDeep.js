export function stripUndefinedDeep(value) {
  if (Array.isArray(value)) {
    return value.map(stripUndefinedDeep);
  }
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = stripUndefinedDeep(v);
    }
    return out;
  }
  return value;
}
