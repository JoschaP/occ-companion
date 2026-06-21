import { useState } from "react";
import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDeviceFloppy,
  IconKey,
} from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { notifications } from "@mantine/notifications";

import { api } from "../api";
import type { KeyPair } from "../types";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Offer to drop the generated private key straight into the form. */
  onUseKey?: (privateKey: string) => void;
}

function KeyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Code block style={{ flex: 1, wordBreak: "break-all" }}>
          {value}
        </Code>
        <CopyButton value={value} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
              <ActionIcon
                variant="light"
                color={copied ? "green" : "gray"}
                onClick={copy}
                size="lg"
              >
                {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
    </div>
  );
}

export function KeygenDialog({ opened, onClose, onUseKey }: Props) {
  const [pair, setPair] = useState<KeyPair | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  // The Rescue Kit download is optional: saving it writes the private key as a
  // plaintext file on disk, so we never force it. The dialog stays dismissable;
  // the user is warned that an un-saved, un-remembered key is unrecoverable.
  const canDismiss = !busy;

  async function generate() {
    setBusy(true);
    try {
      setSaved(false);
      setPair(await api.generateKeypair());
    } catch (e) {
      notifications.show({
        color: "red",
        icon: <IconAlertTriangle size={18} />,
        title: "Could not generate a key pair",
        message: String(e),
        autoClose: 5000,
      });
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setPair(null);
    setSaved(false);
    onClose();
  }

  /** A human-readable recovery document that is also a valid age identity file
      (every line except the secret key is a `#` comment). */
  function rescueKit(p: KeyPair): string {
    const today = new Date().toISOString().slice(0, 10);
    return [
      "# ============================================================",
      "#   OCC Secure Exports — Key Rescue Kit",
      "# ============================================================",
      `#   Created: ${today}`,
      "#",
      "#   This file is the ONLY way to decrypt your OCC data exports.",
      "#   Keep it safe and private. Anyone with the private key below",
      "#   can read your exports. It is never sent anywhere.",
      "#",
      "#   PUBLIC KEY — give this to the OCC so it can encrypt for you:",
      `#     ${p.publicKey}`,
      "#",
      "#   PRIVATE KEY — your secret. It is the line below that starts",
      "#   with AGE-SECRET-KEY. If you lose it, your exports can NEVER",
      "#   be recovered.",
      "#",
      "#   To restore: open OCC Secure Exports, add a connection, and paste",
      "#   the private key into the \"Private key\" field. Or decrypt a",
      "#   file manually with the age tool:",
      "#     age -d -i occ-secure-exports-rescue-kit.txt export.json.age > export.json",
      "# ============================================================",
      "",
      p.privateKey,
      "",
    ].join("\n");
  }

  async function saveRescueKit() {
    if (!pair) return;
    const path = await save({
      title: "Save your Rescue Kit",
      defaultPath: "occ-secure-exports-rescue-kit.txt",
      filters: [{ name: "Rescue Kit", extensions: ["txt", "age", "key"] }],
    });
    if (!path) return;
    try {
      await api.saveTextFile(path, rescueKit(pair), true);
      setSaved(true);
      notifications.show({
        color: "green",
        icon: <IconCheck size={18} />,
        title: "Rescue Kit saved",
        message: "Keep this file safe — it is your only way to decrypt.",
        autoClose: 3500,
      });
    } catch (e) {
      notifications.show({
        color: "red",
        icon: <IconAlertTriangle size={18} />,
        title: "Could not save the Rescue Kit",
        message: String(e),
        autoClose: 5000,
      });
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (canDismiss) close();
      }}
      title="Generate a key pair"
      size="lg"
      centered
      closeOnClickOutside={canDismiss}
      closeOnEscape={canDismiss}
      withCloseButton={canDismiss}
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Your <b>public key</b> goes to the OCC so your exports can be
          encrypted for you. Your <b>private key</b> stays on this device and is
          the only thing that can decrypt them.
        </Text>

        {!pair ? (
          <Button
            leftSection={<IconKey size={18} />}
            onClick={generate}
            loading={busy}
            mt="xs"
          >
            Generate a new key pair
          </Button>
        ) : (
          <>
            <KeyBlock label="PUBLIC KEY — paste this into the OCC" value={pair.publicKey} />
            <KeyBlock label="PRIVATE KEY — keep this secret" value={pair.privateKey} />

            <Alert
              color={saved ? "green" : "yellow"}
              icon={saved ? <IconCheck size={18} /> : <IconAlertTriangle size={18} />}
              variant="light"
            >
              {saved
                ? "Rescue Kit saved — it's a file on this device (never sent anywhere). Keep it safe."
                : "Optional but strongly recommended: download a Rescue Kit. Saving it writes the private key as a file you control on this device. Without it — and unless the connection remembers this key — a lost key means your exports can never be decrypted."}
            </Alert>

            <Group justify="space-between">
              <Button
                variant={saved ? "light" : "filled"}
                color={saved ? "green" : undefined}
                leftSection={
                  saved ? <IconCheck size={18} /> : <IconDeviceFloppy size={18} />
                }
                onClick={saveRescueKit}
              >
                {saved ? "Saved — save again" : "Download Rescue Kit"}
              </Button>
              <Group gap="sm">
                {onUseKey && (
                  <Button
                    variant="subtle"
                    onClick={() => {
                      onUseKey(pair.privateKey);
                      close();
                    }}
                  >
                    Use in connection
                  </Button>
                )}
                <Button variant="default" onClick={close}>
                  Done
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
