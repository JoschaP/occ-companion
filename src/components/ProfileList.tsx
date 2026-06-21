import {
  ActionIcon,
  Box,
  Button,
  Group,
  Menu,
  Paper,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import {
  IconChevronRight,
  IconCopy,
  IconDeviceFloppy,
  IconDotsVertical,
  IconKey,
  IconPencil,
  IconPlus,
  IconServer2,
  IconTrash,
} from "@tabler/icons-react";

import type { ConnectionProfile } from "../types";

interface Props {
  profiles: ConnectionProfile[];
  connectingId: string | null;
  onConnect: (p: ConnectionProfile) => void;
  onEdit: (p: ConnectionProfile) => void;
  onCopyPublicKey: (id: string) => void;
  onExportKit: (id: string) => void;
  onDelete: (id: string) => void;
  onNew: () => void;
  onGenerateKey: () => void;
}

export function ProfileList({
  profiles,
  connectingId,
  onConnect,
  onEdit,
  onCopyPublicKey,
  onExportKit,
  onDelete,
  onNew,
  onGenerateKey,
}: Props) {
  return (
    <Box maw={620} mx="auto" px="md" py="xl" w="100%">
      <Group justify="space-between" align="flex-end" mb="lg" mt="md">
        <div>
          <Title order={1}>OCC Secure Exports</Title>
          <Text c="dimmed" size="sm">
            Download &amp; decrypt your OCC data exports.
          </Text>
        </div>
        <Button leftSection={<IconPlus size={18} />} onClick={onNew}>
          New connection
        </Button>
      </Group>

      {profiles.length === 0 ? (
        <Paper withBorder p="xl" radius="md">
          <Stack align="center" gap="sm" py="lg">
            <IconServer2 size={40} stroke={1.3} color="var(--mantine-color-dimmed)" />
            <Text fw={600}>No connections yet</Text>
            <Text c="dimmed" size="sm" ta="center" maw={360}>
              Add the S3 bucket the OCC delivers your exports to. If you don't
              have an encryption key yet, generate one first.
            </Text>
            <Group mt="sm">
              <Button variant="light" leftSection={<IconKey size={18} />} onClick={onGenerateKey}>
                Generate a key pair
              </Button>
              <Button leftSection={<IconPlus size={18} />} onClick={onNew}>
                Add a connection
              </Button>
            </Group>
          </Stack>
        </Paper>
      ) : (
        <Stack gap="xs">
          {profiles.map((p) => (
            <Paper
              key={p.id}
              withBorder
              radius="md"
              p="sm"
              className="profile-item"
              style={{ cursor: "pointer" }}
              onClick={() => onConnect(p)}
            >
              <Group wrap="nowrap" gap="sm">
                <IconServer2 size={22} stroke={1.4} color="var(--mantine-color-primary-6)" />
                <Box flex={1} miw={0}>
                  <Text fw={600} truncate>
                    {p.name || p.bucket}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {p.bucket} · {p.endpoint}
                  </Text>
                </Box>
                {connectingId === p.id ? (
                  <Text size="sm" c="dimmed">
                    Connecting…
                  </Text>
                ) : (
                  <IconChevronRight size={18} color="var(--mantine-color-dimmed)" />
                )}
                <Menu position="bottom-end" withArrow>
                  <Menu.Target>
                    <ActionIcon
                      variant="subtle"
                      color="gray"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <IconDotsVertical size={18} />
                    </ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown onClick={(e) => e.stopPropagation()}>
                    <Menu.Item
                      leftSection={<IconPencil size={16} />}
                      onClick={() => onEdit(p)}
                    >
                      Edit
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconCopy size={16} />}
                      onClick={() => onCopyPublicKey(p.id)}
                    >
                      Copy public key
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<IconDeviceFloppy size={16} />}
                      onClick={() => onExportKit(p.id)}
                    >
                      Export Rescue Kit
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<IconTrash size={16} />}
                      onClick={() => onDelete(p.id)}
                    >
                      Delete
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Paper>
          ))}
          <Group justify="center" mt="md">
            <Button
              variant="subtle"
              size="sm"
              leftSection={<IconKey size={16} />}
              onClick={onGenerateKey}
            >
              Generate a key pair
            </Button>
          </Group>
        </Stack>
      )}
    </Box>
  );
}
