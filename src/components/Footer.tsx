import { Group, Text, Tooltip } from "@mantine/core";
import { IconLock } from "@tabler/icons-react";

/** Slim footer reinforcing the trust model and showing the app version. */
export function Footer({ version }: { version: string }) {
  return (
    <Group className="footer" justify="space-between" px="md" wrap="nowrap" gap="sm">
      <Group gap={6} wrap="nowrap" miw={0}>
        <IconLock size={13} color="var(--mantine-color-dimmed)" />
        <Text size="xs" c="dimmed" truncate>
          Your private key never leaves this device — no telemetry.
        </Text>
      </Group>
      {version && (
        <Tooltip label="OCC Secure Exports" withArrow>
          <Text size="xs" c="dimmed" style={{ flexShrink: 0 }}>
            v{version}
          </Text>
        </Tooltip>
      )}
    </Group>
  );
}
