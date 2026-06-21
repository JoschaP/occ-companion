import { useCallback, useEffect, useState } from "react";
import {
  Group,
  Modal,
  Progress,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconLoader2,
} from "@tabler/icons-react";
import { open, save, confirm } from "@tauri-apps/plugin-dialog";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { getVersion } from "@tauri-apps/api/app";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { api, onFileDone, onProgress } from "./api";
import type { ConnectionProfile, ConnectResult, Credentials } from "./types";
import { formatBytes } from "./lib/tree";
import { ProfileList } from "./components/ProfileList";
import { ConnectionForm } from "./components/ConnectionForm";
import { Explorer } from "./components/Explorer";
import { KeygenDialog } from "./components/KeygenDialog";
import { Footer } from "./components/Footer";

type View = "list" | "form" | "explorer";

interface DlItem {
  name: string;
  done: number;
  total: number;
  status: "running" | "ok" | "error";
  error?: string;
}

interface DlState {
  open: boolean;
  dest: string;
  items: Record<string, DlItem>;
}

const fileName = (key: string) =>
  (key.split("/").pop() || key).replace(/\.age$/, "");

// Compact for the connection screen, roomier once a bucket is open.
async function resizeWindow(mode: "compact" | "explorer") {
  try {
    const size =
      mode === "explorer"
        ? new LogicalSize(1080, 720)
        : new LogicalSize(760, 620);
    const w = getCurrentWindow();
    await w.setSize(size);
    await w.center();
  } catch {
    /* window API unavailable (e.g. tests) — ignore */
  }
}

export default function App() {
  const [view, setView] = useState<View>("list");
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [editing, setEditing] = useState<ConnectionProfile | null>(null);
  const [injectedKey, setInjectedKey] = useState<string | null>(null);
  const [keygenOpen, setKeygenOpen] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const [session, setSession] = useState<ConnectResult | null>(null);
  const [objects, setObjects] = useState<
    Awaited<ReturnType<typeof api.listObjects>>
  >([]);
  const [refreshing, setRefreshing] = useState(false);

  const [dl, setDl] = useState<DlState>({ open: false, dest: "", items: {} });
  const [version, setVersion] = useState("");

  useEffect(() => {
    getVersion()
      .then(setVersion)
      .catch(() => {});
  }, []);

  const reloadProfiles = useCallback(() => {
    api
      .listProfiles()
      .then(setProfiles)
      .catch((e) => fail("Could not load connections", e));
  }, []);

  useEffect(() => {
    reloadProfiles();
  }, [reloadProfiles]);

  // Dev-only: auto-seed a demo connection (from .env.development.local) so
  // local testing needs no manual entry. Never runs in production builds.
  useEffect(() => {
    const env = import.meta.env as unknown as Record<string, string | undefined> & {
      DEV: boolean;
    };
    if (!env.DEV || !env.VITE_DEV_ENDPOINT) return;
    (async () => {
      const profiles = await api.listProfiles();
      if (profiles.some((p) => p.id === "dev-demo")) return;
      const profile: ConnectionProfile = {
        id: "dev-demo",
        name: "Demo (dev)",
        endpoint: env.VITE_DEV_ENDPOINT!,
        region: env.VITE_DEV_REGION || "us-east-1",
        bucket: env.VITE_DEV_BUCKET || "",
        accessKeyId: env.VITE_DEV_ACCESS_KEY_ID || "",
        pathStyle: env.VITE_DEV_PATH_STYLE !== "false",
        basePrefix: "",
        rememberSecret: true,
        rememberKey: true,
      };
      await api.saveProfile(profile, {
        secretAccessKey: env.VITE_DEV_SECRET,
        ageKey: env.VITE_DEV_AGE_KEY,
      });
      reloadProfiles();
    })().catch(() => {});
  }, [reloadProfiles]);

  // Download progress / completion events (registered once).
  useEffect(() => {
    const uns: UnlistenFn[] = [];
    onProgress((e) =>
      setDl((d) =>
        d.items[e.key]
          ? {
              ...d,
              items: {
                ...d.items,
                [e.key]: { ...d.items[e.key], done: e.done, total: e.total },
              },
            }
          : d,
      ),
    ).then((u) => uns.push(u));
    onFileDone((e) =>
      setDl((d) => {
        const it = d.items[e.key];
        if (!it) return d;
        return {
          ...d,
          items: {
            ...d.items,
            [e.key]: {
              ...it,
              status: e.ok ? "ok" : "error",
              error: e.error ?? undefined,
              done: e.ok ? it.total || it.done : it.done,
            },
          },
        };
      }),
    ).then((u) => uns.push(u));
    return () => uns.forEach((u) => u());
  }, []);

  function fail(title: string, e: unknown) {
    notifications.show({
      color: "red",
      icon: <IconAlertTriangle size={18} />,
      title,
      message: String(e),
      autoClose: 6000,
    });
  }

  async function doConnect(p: ConnectionProfile, creds: Credentials) {
    setConnectingId(p.id);
    try {
      const res = await api.connect(p, creds);
      const objs = await api.listObjects(res.basePrefix || undefined);
      setSession(res);
      setObjects(objs);
      setView("explorer");
      void resizeWindow("explorer");
      reloadProfiles();
    } catch (e) {
      fail("Could not connect", e);
    } finally {
      setConnectingId(null);
    }
  }

  async function connectFromList(p: ConnectionProfile) {
    try {
      const s = await api.secretStatus(p.id);
      if (s.hasSecret && s.hasKey) {
        await doConnect(p, {});
      } else {
        setEditing(p);
        setInjectedKey(null);
        setView("form");
      }
    } catch (e) {
      fail("Could not open connection", e);
    }
  }

  async function refresh() {
    if (!session) return;
    setRefreshing(true);
    try {
      setObjects(await api.listObjects(session.basePrefix || undefined));
    } catch (e) {
      fail("Could not refresh", e);
    } finally {
      setRefreshing(false);
    }
  }

  async function disconnect() {
    try {
      await api.disconnect();
    } catch {
      /* ignore */
    }
    setSession(null);
    setObjects([]);
    setView("list");
    void resizeWindow("compact");
    reloadProfiles();
  }

  async function copyPublicKey(id: string) {
    try {
      const pub = await api.profilePublicKey(id);
      if (!pub) {
        notifications.show({
          color: "yellow",
          title: "No public key available",
          message:
            "This connection has no stored age key (or uses an SSH key). Enable “remember key” to derive it.",
          autoClose: 5000,
        });
        return;
      }
      await navigator.clipboard.writeText(pub);
      notifications.show({
        color: "green",
        icon: <IconCircleCheck size={18} />,
        title: "Public key copied",
        message: "Paste it into the OCC.",
        autoClose: 2500,
      });
    } catch (e) {
      fail("Could not copy the public key", e);
    }
  }

  async function exportKit(id: string) {
    const path = await save({
      title: "Export Rescue Kit",
      defaultPath: "occ-companion-rescue-kit.txt",
      filters: [{ name: "Rescue Kit", extensions: ["txt", "age", "key"] }],
    });
    if (!path) return;
    try {
      await api.exportRescueKit(id, path);
      notifications.show({
        color: "green",
        icon: <IconCircleCheck size={18} />,
        title: "Rescue Kit exported",
        message: "Keep this file somewhere safe.",
        autoClose: 3000,
      });
    } catch (e) {
      fail("Could not export the Rescue Kit", e);
    }
  }

  async function deleteProfile(id: string) {
    const ok = await confirm("Delete this connection and its stored secrets?", {
      title: "Delete connection",
      kind: "warning",
    });
    if (!ok) return;
    try {
      await api.deleteProfile(id);
      reloadProfiles();
    } catch (e) {
      fail("Could not delete", e);
    }
  }

  async function handleDownload(keys: string[]) {
    const dir = await open({
      directory: true,
      multiple: false,
      title: "Choose a folder to save into",
    });
    if (!dir || Array.isArray(dir)) return;
    const items: Record<string, DlItem> = {};
    for (const k of keys) {
      items[k] = { name: fileName(k), done: 0, total: 0, status: "running" };
    }
    setDl({ open: true, dest: dir, items });
    try {
      await api.downloadDecrypt(keys, dir);
    } catch (e) {
      fail("Download failed", e);
    }
  }

  const dlItems = Object.values(dl.items);
  const allDone =
    dlItems.length > 0 && dlItems.every((i) => i.status !== "running");

  return (
    <>
      {view === "explorer" && session ? (
        <Explorer
          bucket={session.bucket}
          basePrefix={session.basePrefix}
          objects={objects}
          version={version}
          refreshing={refreshing}
          onRefresh={refresh}
          onDisconnect={disconnect}
          onDownload={handleDownload}
        />
      ) : (
        <>
          <ScrollArea style={{ flex: 1 }}>
          {view === "form" ? (
            <ConnectionForm
              initial={editing}
              injectedKey={injectedKey}
              onCancel={() => {
                setView("list");
                setEditing(null);
                setInjectedKey(null);
                reloadProfiles();
              }}
              onConnect={doConnect}
              onGenerateKey={() => setKeygenOpen(true)}
            />
          ) : (
            <ProfileList
              profiles={profiles}
              connectingId={connectingId}
              onConnect={connectFromList}
              onEdit={(p) => {
                setEditing(p);
                setInjectedKey(null);
                setView("form");
              }}
              onCopyPublicKey={copyPublicKey}
              onExportKit={exportKit}
              onDelete={deleteProfile}
              onNew={() => {
                setEditing(null);
                setInjectedKey(null);
                setView("form");
              }}
              onGenerateKey={() => setKeygenOpen(true)}
            />
          )}
          </ScrollArea>
          <Footer version={version} />
        </>
      )}

      <KeygenDialog
        opened={keygenOpen}
        onClose={() => setKeygenOpen(false)}
        onUseKey={(key) => {
          setInjectedKey(key);
          if (view !== "form") setView("form");
        }}
      />

      <Modal
        opened={dl.open}
        onClose={() => setDl((d) => ({ ...d, open: false }))}
        title={allDone ? "Done" : "Downloading & decrypting"}
        closeOnClickOutside={allDone}
        withCloseButton={allDone}
        centered
        size="lg"
      >
        <Stack gap="xs">
          <Text size="sm" c="dimmed">
            Saving to <b>{dl.dest}</b>
          </Text>
          {dlItems.map((it, i) => {
            const pct =
              it.total > 0
                ? Math.min(100, (it.done / it.total) * 100)
                : it.status === "ok"
                  ? 100
                  : 0;
            return (
              <div key={i}>
                <Group gap="xs" wrap="nowrap" justify="space-between">
                  <Group gap={8} wrap="nowrap" miw={0}>
                    <StatusIcon status={it.status} />
                    <Text size="sm" truncate>
                      {it.name}
                    </Text>
                  </Group>
                  <Text size="xs" c="dimmed">
                    {it.status === "error" ? "failed" : formatBytes(it.done)}
                  </Text>
                </Group>
                <Progress
                  value={pct}
                  color={
                    it.status === "error"
                      ? "red"
                      : it.status === "ok"
                        ? "green"
                        : "primary"
                  }
                  size="sm"
                  mt={4}
                  animated={it.status === "running"}
                />
                {it.status === "error" && it.error && (
                  <Text size="xs" c="red" mt={2}>
                    {it.error}
                  </Text>
                )}
              </div>
            );
          })}
        </Stack>
      </Modal>
    </>
  );
}

function StatusIcon({ status }: { status: DlItem["status"] }) {
  if (status === "ok")
    return (
      <ThemeIcon color="green" variant="light" size="sm" radius="xl">
        <IconCircleCheck size={14} />
      </ThemeIcon>
    );
  if (status === "error")
    return (
      <ThemeIcon color="red" variant="light" size="sm" radius="xl">
        <IconAlertTriangle size={14} />
      </ThemeIcon>
    );
  return (
    <ThemeIcon color="gray" variant="light" size="sm" radius="xl">
      <IconLoader2 size={14} className="spin" />
    </ThemeIcon>
  );
}
