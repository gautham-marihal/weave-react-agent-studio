// The part of the schema that describes one place in the configuration: for ['tools', 2] the schema of a tool, for ['guardrails', 'input', 0] the schema of
// one check on what the caller says. The settings form is built from the schema, so a panel that shows one item of a list asks for its schema here.
// Pure: no React, no DOM.

export function schemaAtPath(engine, schema, path) {
  if (!engine || !schema?.properties || !Array.isArray(path) || !path.length) return null;
  let node = schema.properties[path[0]];
  for (let i = 1; i < path.length && node; i += 1) {
    const flat = engine.flatten(node);
    node = typeof path[i] === 'number' ? flat.items : flat.properties?.[path[i]];
  }
  return node || null;
}

export const getAtPath = (root, path) => path.reduce((node, part) => (node == null ? node : node[part]), root);

// `root` with the value at `path` replaced (arrays and objects are copied along the way; the rest is shared).
export function setAtPath(root, path, value) {
  if (!path.length) return value;
  const [head, ...rest] = path;
  const copy = Array.isArray(root) ? [...root] : { ...(root || {}) };
  copy[head] = setAtPath(root == null ? undefined : root[head], rest, value);
  return copy;
}

// `root` without the item at `path` (the last part is an index into a list).
export function removeAtPath(root, path) {
  const list = getAtPath(root, path.slice(0, -1));
  if (!Array.isArray(list)) return root;
  return setAtPath(
    root,
    path.slice(0, -1),
    list.filter((_, i) => i !== path[path.length - 1]),
  );
}
