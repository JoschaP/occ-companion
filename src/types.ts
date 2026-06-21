// Mirrors the Rust DTOs (serde camelCase).

export interface ConnectionProfile {
  id: string;
  name: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  pathStyle: boolean;
  basePrefix: string;
  rememberSecret: boolean;
  rememberKey: boolean;
}

/** Secrets passed alongside a profile; never persisted unless the flags say so. */
export interface Credentials {
  secretAccessKey?: string;
  ageKey?: string;
}

export interface SecretStatus {
  hasSecret: boolean;
  hasKey: boolean;
}

export interface ConnectResult {
  bucket: string;
  basePrefix: string;
}

export interface KeyPair {
  publicKey: string;
  privateKey: string;
}

export interface ObjectInfo {
  key: string;
  size: number;
  lastModified: string | null;
}

/** Result of the GitHub releases update check (mirrors Rust `UpdateInfo`). */
export interface UpdateInfo {
  current: string;
  latest: string;
  updateAvailable: boolean;
  url: string;
}

/** Per-object key-check outcome (mirrors Rust `KeyMatch`). */
export type KeyMatchStatus = "match" | "mismatch" | "plain" | "unknown";

export interface KeyCheck {
  key: string;
  status: KeyMatchStatus;
}

export interface ProgressEvent {
  key: string;
  done: number;
  total: number;
}

export interface FileResult {
  key: string;
  ok: boolean;
  error: string | null;
  path: string | null;
  bytes: number;
}

/** One file to download, with the destination path (relative to the chosen
 *  folder) that preserves folder structure. `.age` is stripped from the final
 *  segment; the backend sanitizes against path traversal regardless. */
export interface DownloadItem {
  key: string;
  relPath: string;
}

/** A node in the bucket tree (folders are synthesized from key prefixes). */
export interface TreeNode {
  id: string;
  name: string;
  isFolder: boolean;
  key?: string;
  size?: number;
  lastModified?: string | null;
  children?: TreeNode[];
}

export function emptyProfile(id: string): ConnectionProfile {
  return {
    id,
    name: "",
    endpoint: "",
    region: "us-east-1",
    bucket: "",
    accessKeyId: "",
    pathStyle: true,
    basePrefix: "",
    rememberSecret: true,
    rememberKey: false,
  };
}
