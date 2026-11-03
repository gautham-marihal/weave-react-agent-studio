// The schema for one place in the configuration (['tools', 2] -> a tool's schema), for panels that show one list item.
// Pure: no React, no DOM.

//   root (optional): the configuration itself. Where the schema is a choice of shapes (a knowledge base is a vector
//   store or a search service), the shape is the one the value there fits; without it a choice can't be looked into.
export function schemaAtPath(engine, schema, path, root) {
  if (!engine || !schema?.properties || !Array.isArray(path) || !path.length) return null;
  const branchOf = (node, depth) => {
    // only on the way down: the place asked for keeps its choice (its form offers to switch shape)
    if (root === undefined || !node || depth >= path.length) return node;
    const flat = engine.flatten(node);
    if (!engine.isPureUnion?.(flat)) return node;
    const branches = engine.branchesOf(flat);
    const value = path.slice(0, depth).reduce((at, part) => (at == null ? at : at[part]), root);
    return branches.length ? branches[engine.pickBranch(branches, value)] : node;
  };
  // with the configuration, fields that switch on by the value (an end-call tool's params) are found too
  const shapeAt = (node, depth) =>
    root === undefined || !engine.resolveShape ? engine.flatten(node) : engine.resolveShape(node, getAtPath(root, path.slice(0, depth)));
  let node = branchOf(schema.properties[path[0]], 1);
  for (let i = 1; i < path.length && node; i += 1) {
    const flat = shapeAt(node, i);
    // a map's entries (state.variables.<name>, connections.<name>) have the schema of its additionalProperties
    const entry = flat.additionalProperties && typeof flat.additionalProperties === 'object' ? flat.additionalProperties : undefined;
    node = branchOf(typeof path[i] === 'number' ? flat.items : (flat.properties?.[path[i]] ?? entry), i + 1);
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
