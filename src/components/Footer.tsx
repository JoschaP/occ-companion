import { Anchor, Group, Text, Tooltip } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";

interface Props {
  version: string;
  updateAvailable?: boolean;
  onUpdateClick?: () => void;
}

/** Slim footer reinforcing the trust model and showing the app version. */
export function Footer({ version, updateAvailable, onUpdateClick }: Props) {
  return (
    <Group className="footer" justify="space-between" px="md" wrap="nowrap" gap="sm">
      <Group gap={6} wrap="nowrap" miw={0}>
        <IconLock
          size={13}
          color="var(--mantine-color-green-6)"
          style={{ position: "relative", top: -1 }}
        />
        <Text size="xs" c="dimmed" truncate>
          Your private key never leaves this device — no telemetry.
        </Text>
      </Group>
      <Group gap="sm" wrap="nowrap" style={{ flexShrink: 0 }}>
        {updateAvailable && (
          <Anchor component="button" type="button" size="xs" onClick={onUpdateClick}>
            New version available
          </Anchor>
        )}
        {version && (
          <Tooltip label="OCC Secure Exports" withArrow>
            <Text size="xs" c="dimmed">
              v{version}
            </Text>
          </Tooltip>
        )}
      </Group>
    </Group>
  );
}
