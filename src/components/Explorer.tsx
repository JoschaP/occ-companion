import { useEffect, useMemo, useRef, useState } from "react";
import { Tree, type NodeApi, type NodeRendererProps } from "react-arborist";
import {
  ActionIcon,
  Box,
  Button,
  Divider,
  Group,
  LoadingOverlay,
  Text,
  Tooltip,
} from "@mantine/core";
import { useElementSize } from "@mantine/hooks";
import {
  IconChevronDown,
  IconChevronRight,
  IconDownload,
  IconFile,
  IconFolder,
  IconLock,
  IconLogout,
  IconRefresh,
} from "@tabler/icons-react";

import type { ObjectInfo, TreeNode } from "../types";
import {
  buildDownloadPlan,
  buildTree,
  checkableAgeKeys,
  formatBytes,
  formatDate,
  type DownloadPlanItem,
} from "../lib/tree";
import {
  isFresh,
  summarizeKeyChecks,
  type CachedCheck,
  type KeyCheckSummary,
} from "../lib/keycheck";
import { Wordmark } from "./Wordmark";
import { api } from "../api";

interface Props {
  bucket: string;
  basePrefix: string;
  objects: ObjectInfo[];
  version: string;
  refreshing: boolean;
  onRefresh: () => void;
  onDisconnect: () => void;
  onDownload: (items: DownloadPlanItem[]) => void;
}

function Node({ node, style, dragHandle }: NodeRendererProps<TreeNode>) {
  const data = node.data;
  const isFolder = data.isFolder;

  return (
    <div
      ref={dragHandle}
      style={style}
      className={`node${node.isSelected ? " selected" : ""}`}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) node.selectMulti();
        else if (e.shiftKey) node.selectContiguous();
        else node.select();
        if (isFolder) node.toggle();
      }}
    >
      <span className="twist">
        {isFolder ? (
          node.isOpen ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )
        ) : null}
      </span>
      <span className="icon">
        {isFolder ? <IconFolder size={16} /> : <IconFile size={16} />}
      </span>
      <span className="name">{data.name}</span>
      {!isFolder && <span className="size">{formatBytes(data.size)}</span>}
      {!isFolder && <span className="date">{formatDate(data.lastModified)}</span>}
    </div>
  );
}

export function Explorer({
  bucket,
  basePrefix,
  objects,
  version,
  refreshing,
  onRefresh,
  onDisconnect,
  onDownload,
}: Props) {
  const [selected, setSelected] = useState<NodeApi<TreeNode>[]>([]);
  const { ref, width, height } = useElementSize();

  const treeData = useMemo(
    () => buildTree(objects, basePrefix),
    [objects, basePrefix],
  );

  const selectedNodes = useMemo(() => selected.map((n) => n.data), [selected]);
  const plan = useMemo(() => buildDownloadPlan(selectedNodes), [selectedNodes]);
  const fileCount = useMemo(
    () => selectedNodes.filter((n) => !n.isFolder).length,
    [selectedNodes],
  );
  const folderCount = useMemo(
    () => selectedNodes.filter((n) => n.isFolder).length,
    [selectedNodes],
  );
  const hasAge = useMemo(
    () => plan.some((p) => p.key.toLowerCase().endsWith(".age")),
    [plan],
  );

  // What did the user actually pick — folders, files, or both? (A folder is
  // not a file; we never call its contents "N files".)
  const selectionLabel = [
    folderCount > 0
      ? `${folderCount} folder${folderCount === 1 ? "" : "s"}`
      : null,
    fileCount > 0 ? `${fileCount} file${fileCount === 1 ? "" : "s"}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // Button verb mirrors the selection: a directory vs a file, "& decrypt" only
  // when at least one .age file is involved.
  const downloadNoun =
    folderCount > 0
      ? fileCount === 0 && folderCount === 1
        ? "directory"
        : "items"
      : fileCount === 1
        ? "file"
        : "files";
  const downloadLabel = `Download ${downloadNoun}${hasAge ? " & decrypt" : ""}`;

  // Only directly-selected .age *files* are worth a key pre-check — never a
  // folder (see checkableAgeKeys).
  const checkableKeys = useMemo(
    () => checkableAgeKeys(selectedNodes),
    [selectedNodes],
  );

  // Pre-flight: can the connected key decrypt the selected .age files?
  // Results are cached per object key with a TTL — a header never changes
  // within a listing, so re-visiting a file is instant (no request, no jank on
  // fast navigation), while the TTL still re-probes after a while in case the
  // object was replaced. The cache is also cleared when the listing changes.
  const checkCache = useRef<Map<string, CachedCheck>>(new Map());
  useEffect(() => {
    checkCache.current.clear();
  }, [objects]);

  const [keyStatus, setKeyStatus] = useState<KeyCheckSummary | null>(null);
  const [checking, setChecking] = useState(false);
  const selectionId = checkableKeys.join("\n");
  useEffect(() => {
    if (!checkableKeys.length) {
      setKeyStatus(null);
      setChecking(false);
      return;
    }
    // Show whatever we already know (fresh cache hits) immediately — no flicker.
    const now = Date.now();
    setKeyStatus(summarizeKeyChecks(checkableKeys, checkCache.current, now));
    const missing = checkableKeys.filter(
      (k) => !isFresh(checkCache.current.get(k), now),
    );
    if (!missing.length) {
      setChecking(false);
      return;
    }
    let cancelled = false;
    setChecking(true);
    const t = setTimeout(() => {
      api
        .checkKeys(missing)
        .then((results) => {
          if (cancelled) return;
          const at = Date.now();
          for (const r of results) {
            checkCache.current.set(r.key, { status: r.status, at });
          }
          setKeyStatus(
            summarizeKeyChecks(checkableKeys, checkCache.current, Date.now()),
          );
        })
        .catch(() => {
          /* keep the cached portion; transient errors shouldn't blank it */
        })
        .finally(() => !cancelled && setChecking(false));
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionId]);
  const totalSize = useMemo(
    () => objects.reduce((sum, o) => sum + o.size, 0),
    [objects],
  );

  // Size of the current selection (sum of the files the download would fetch),
  // so the status bar reacts as you navigate/select instead of always showing
  // the bucket total.
  const sizeByKey = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of objects) m.set(o.key, o.size);
    return m;
  }, [objects]);
  const selectionSize = useMemo(
    () => plan.reduce((sum, p) => sum + (sizeByKey.get(p.key) ?? 0), 0),
    [plan, sizeByKey],
  );

  return (
    <div className="explorer">
      <Group className="toolbar" gap="sm" wrap="nowrap">
        <Wordmark size={16} />
        <Divider orientation="vertical" />
        <Group gap={6} wrap="nowrap" miw={0}>
          <IconFolder size={18} color="var(--mantine-color-primary-6)" />
          <Text fw={600} truncate>
            {bucket}
          </Text>
          {basePrefix && (
            <Text c="dimmed" size="sm" truncate>
              /{basePrefix.replace(/\/$/, "")}
            </Text>
          )}
        </Group>

        <Tooltip label="Refresh" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onRefresh} loading={refreshing}>
            <IconRefresh size={18} />
          </ActionIcon>
        </Tooltip>

        <Box flex={1} />

        {selectedNodes.length > 0 && (
          <Text className="selection-count">
            {selectionLabel}
            {checking && (
              <Text span c="dimmed">
                {" "}
                · checking key…
              </Text>
            )}
            {!checking && keyStatus && keyStatus.mismatches > 0 && (
              <Text span c="red">
                {" "}
                · key can&apos;t decrypt {keyStatus.mismatches}
              </Text>
            )}
            {!checking &&
              keyStatus &&
              keyStatus.mismatches === 0 &&
              keyStatus.matches > 0 && (
                <Text span c="green">
                  {" "}
                  · key matches
                </Text>
              )}
          </Text>
        )}
        <Button
          leftSection={<IconDownload size={18} />}
          disabled={plan.length === 0}
          onClick={() => onDownload(plan)}
        >
          {downloadLabel}
        </Button>
        <Tooltip label="Close connection" withArrow>
          <ActionIcon variant="subtle" color="gray" onClick={onDisconnect} size="lg">
            <IconLogout size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>

      {treeData.length > 0 && (
        <div className="tree-head">
          <span className="th-name">Name</span>
          <span className="th-size">Size</span>
          <span className="th-date">Modified</span>
        </div>
      )}

      <div className="tree-wrap" ref={ref} style={{ position: "relative" }}>
        <LoadingOverlay
          visible={refreshing}
          zIndex={5}
          overlayProps={{ blur: 1 }}
          loaderProps={{ size: "sm" }}
        />
        {treeData.length === 0 ? (
          <Box className="empty-state" ta="center" c="dimmed">
            <IconFolder size={44} stroke={1.2} />
            <Text fw={600}>This location is empty.</Text>
            <Text size="sm">No exports have been delivered here yet.</Text>
          </Box>
        ) : (
          <Tree<TreeNode>
            data={treeData}
            openByDefault={false}
            width={width}
            height={height}
            rowHeight={34}
            indent={18}
            disableDrag
            disableDrop
            onSelect={setSelected}
            selectionFollowsFocus={false}
          >
            {(props) => <Node {...props} />}
          </Tree>
        )}
      </div>

      <Group className="statusbar" justify="space-between" wrap="nowrap" gap="sm">
        <Text size="xs" c="dimmed">
          {plan.length > 0
            ? `${plan.length} file${plan.length === 1 ? "" : "s"} selected · ${formatBytes(selectionSize)}`
            : `${objects.length} object${objects.length === 1 ? "" : "s"} · ${formatBytes(totalSize)} total`}
        </Text>
        <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
          <IconLock size={12} color="var(--mantine-color-dimmed)" />
          <Text size="xs" c="dimmed">
            Key stays local{version ? ` · v${version}` : ""}
          </Text>
        </Group>
      </Group>
    </div>
  );
}
