import type { ObjectInfo, TreeNode } from "../types";

/**
 * Turn a flat list of object keys into a folder tree, splitting on "/".
 * Folders are synthesized; leaves carry the object's key/size/date.
 * Folders sort before files, each alphabetically.
 */
export function buildTree(objects: ObjectInfo[], stripPrefix = ""): TreeNode[] {
  const root: TreeNode = { id: "", name: "", isFolder: true, children: [] };

  for (const obj of objects) {
    let rel = obj.key;
    if (stripPrefix && rel.startsWith(stripPrefix)) {
      rel = rel.slice(stripPrefix.length);
    }
    rel = rel.replace(/^\/+/, "");
    if (!rel) continue;

    const parts = rel.split("/");
    let node = root;
    let pathSoFar = stripPrefix;

    parts.forEach((part, idx) => {
      const isLeaf = idx === parts.length - 1;
      pathSoFar = pathSoFar ? `${pathSoFar}/${part}` : part;
      const children = (node.children ??= []);
      let child = children.find((c) => c.name === part && c.isFolder !== isLeaf);

      if (!child) {
        child = isLeaf
          ? {
              id: obj.key,
              name: part,
              isFolder: false,
              key: obj.key,
              size: obj.size,
              lastModified: obj.lastModified,
            }
          : { id: `${pathSoFar}/`, name: part, isFolder: true, children: [] };
        children.push(child);
      }
      node = child;
    });
  }

  sortTree(root);
  return root.children ?? [];
}

function sortTree(node: TreeNode) {
  if (!node.children) return;
  node.children.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
}

/** Collect every object key at or beneath the given node. */
export function collectKeys(node: TreeNode): string[] {
  if (!node.isFolder) return node.key ? [node.key] : [];
  return (node.children ?? []).flatMap(collectKeys);
}

/**
 * Keys of directly-selected nodes that are `.age` files — the only selection
 * worth a key pre-check. Folders are excluded: a folder is not an encrypted
 * file, so probing its contents would be both misleading ("key matches" on a
 * folder) and wasteful (one range request per file inside).
 */
export function checkableAgeKeys(
  nodes: Pick<TreeNode, "isFolder" | "key">[],
): string[] {
  return nodes
    .filter((n) => !n.isFolder && n.key)
    .map((n) => n.key as string)
    .filter((k) => k.toLowerCase().endsWith(".age"));
}

export function formatBytes(n?: number): string {
  if (n === undefined) return "";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
