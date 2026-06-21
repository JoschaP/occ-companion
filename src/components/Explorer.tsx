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

import type { KeyMatchStatus, ObjectInfo, TreeNode } from "../types";
import {
  buildTree,
  checkableAgeKeys,
  collectKeys,
  formatBytes,
  formatDate,
} from "../lib/tree";
import { summarizeKeyChecks, type KeyCheckSummary } from "../lib/keycheck";
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
  onDownload: (keys: string[]) => void;
}

function uniqueKeys(nodes: NodeApi<TreeNode>[]): string[] {
  const set = new Set<string>();
  for (const n of nodes) for (const k of collectKeys(n.data)) set.add(k);
  return [...set];
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

  const selectedKeys = useMemo(() => uniqueKeys(selected), [selected]);
  const count = selectedKeys.length;
  const hasAge = useMemo(
    () => selectedKeys.some((k) => k.toLowerCase().endsWith(".age")),
    [selectedKeys],
  );

  // Only directly-selected .age *files* are worth a key pre-check — never a
  // folder (see checkableAgeKeys).
  const checkableKeys = useMemo(
    () => checkableAgeKeys(selected.map((n) => n.data)),
    [selected],
  );

  // Pre-flight: can the connected key decrypt the selected .age files?
  // Results are cached per object key for the session — a header never changes
  // within a listing, so re-visiting a file is instant (no request, no jank on
  // fast navigation). The cache is cleared whenever the listing changes.
  const checkCache = useRef<Map<string, KeyMatchStatus>>(new Map());
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
    // Show whatever we already know immediately (cache hit → no flicker).
    setKeyStatus(summarizeKeyChecks(checkableKeys, checkCache.current));
    const missing = checkableKeys.filter((k) => !checkCache.current.has(k));
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
          for (const r of results) checkCache.current.set(r.key, r.status);
          setKeyStatus(summarizeKeyChecks(checkableKeys, checkCache.current));
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

        {count > 0 && (
          <Text className="selection-count">
            {count} file{count === 1 ? "" : "s"}
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
          disabled={count === 0}
          onClick={() => onDownload(selectedKeys)}
        >
          {hasAge ? "Download & decrypt" : "Download"}
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
          {objects.length} object{objects.length === 1 ? "" : "s"} ·{" "}
          {formatBytes(totalSize)} total
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
