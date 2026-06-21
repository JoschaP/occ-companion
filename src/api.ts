// Typed wrappers around the Tauri command surface and event channels.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  ConnectionProfile,
  ConnectResult,
  Credentials,
  FileResult,
  KeyCheck,
  KeyPair,
  ObjectInfo,
  ProgressEvent,
  SecretStatus,
} from "./types";

export const api = {
  generateKeypair: () => invoke<KeyPair>("generate_keypair"),

  saveTextFile: (path: string, contents: string, restrict: boolean) =>
    invoke<void>("save_text_file", { path, contents, restrict }),

  listProfiles: () => invoke<ConnectionProfile[]>("list_profiles"),

  saveProfile: (profile: ConnectionProfile, creds: Credentials) =>
    invoke<void>("save_profile", { profile, creds }),

  deleteProfile: (id: string) => invoke<void>("delete_profile", { id }),

  profilePublicKey: (id: string) =>
    invoke<string | null>("profile_public_key", { id }),

  exportRescueKit: (id: string, path: string) =>
    invoke<void>("export_rescue_kit", { id, path }),

  secretStatus: (id: string) => invoke<SecretStatus>("secret_status", { id }),

  connect: (profile: ConnectionProfile, creds: Credentials) =>
    invoke<ConnectResult>("connect", { profile, creds }),

  checkKeys: (keys: string[]) => invoke<KeyCheck[]>("check_keys", { keys }),

  listObjects: (prefix?: string) =>
    invoke<ObjectInfo[]>("list_objects", { prefix: prefix ?? null }),

  disconnect: () => invoke<void>("disconnect"),

  downloadDecrypt: (keys: string[], destDir: string) =>
    invoke<FileResult[]>("download_decrypt", { keys, destDir }),
};

export function onProgress(cb: (e: ProgressEvent) => void): Promise<UnlistenFn> {
  return listen<ProgressEvent>("download://progress", (ev) => cb(ev.payload));
}

export function onFileDone(cb: (e: FileResult) => void): Promise<UnlistenFn> {
  return listen<FileResult>("download://file", (ev) => cb(ev.payload));
}
