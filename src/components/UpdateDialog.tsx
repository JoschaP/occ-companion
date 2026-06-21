import { Button, Code, Group, Modal, Stack, Text } from "@mantine/core";
import { IconExternalLink } from "@tabler/icons-react";
import { openUrl } from "@tauri-apps/plugin-opener";

import type { UpdateInfo } from "../types";

function osKind(): "mac" | "windows" | "linux" {
  const ua = navigator.userAgent;
  if (/Mac/i.test(ua)) return "mac";
  if (/Win/i.test(ua)) return "windows";
  return "linux";
}

interface Props {
  opened: boolean;
  onClose: () => void;
  info: UpdateInfo | null;
}

/** How to update, per platform — matching how the app is distributed. */
export function UpdateDialog({ opened, onClose, info }: Props) {
  const os = osKind();
  const cmd =
    os === "mac"
      ? "brew upgrade --cask occ-secure-exports"
      : os === "windows"
        ? "scoop update occ-secure-exports"
        : null;

  return (
    <Modal opened={opened} onClose={onClose} title="Update available" centered size="md">
      <Stack>
        <Text size="sm">
          A newer version is available: <b>v{info?.latest}</b>
          {info?.current ? ` (you have v${info.current})` : ""}.
        </Text>

        {cmd ? (
          <div>
            <Text size="sm" mb={6} c="dimmed">
              If you installed via {os === "mac" ? "Homebrew" : "Scoop"}, update from
              a terminal:
            </Text>
            <Code block>{cmd}</Code>
            <Text size="xs" c="dimmed" mt={6}>
              Otherwise, download the latest installer from the releases page.
            </Text>
          </div>
        ) : (
          <Text size="sm" c="dimmed">
            Download the latest <b>.deb</b> or <b>.AppImage</b> from the releases
            page.
          </Text>
        )}

        <Group justify="flex-end" mt="xs">
          <Button variant="default" onClick={onClose}>
            Later
          </Button>
          <Button
            leftSection={<IconExternalLink size={16} />}
            onClick={() => {
              if (info?.url) void openUrl(info.url).catch(() => {});
            }}
          >
            Open releases page
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
