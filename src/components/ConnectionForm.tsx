import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Box,
  Button,
  Divider,
  Group,
  PasswordInput,
  Stack,
  Switch,
  Text,
  TextInput,
  Textarea,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconKey,
  IconPlugConnected,
} from "@tabler/icons-react";

import { notifications } from "@mantine/notifications";

import { api } from "../api";
import { errText } from "../lib/errors";
import {
  emptyProfile,
  type ConnectionProfile,
  type Credentials,
} from "../types";

interface Props {
  initial: ConnectionProfile | null;
  onCancel: () => void;
  onConnect: (profile: ConnectionProfile, creds: Credentials) => void;
  onGenerateKey: () => void;
  /** Prefilled private key handed over from the keygen dialog. */
  injectedKey?: string | null;
}

export function ConnectionForm({
  initial,
  onCancel,
  onConnect,
  onGenerateKey,
  injectedKey,
}: Props) {
  const [profile, setProfile] = useState<ConnectionProfile>(
    initial ?? emptyProfile(crypto.randomUUID()),
  );
  const [secret, setSecret] = useState("");
  const [ageKey, setAgeKey] = useState("");
  const [hasSavedSecret, setHasSavedSecret] = useState(false);
  const [hasSavedKey, setHasSavedKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initial) {
      api
        .secretStatus(initial.id)
        .then((s) => {
          setHasSavedSecret(s.hasSecret);
          setHasSavedKey(s.hasKey);
        })
        .catch(() => {
          setHasSavedSecret(false);
          setHasSavedKey(false);
        });
    }
  }, [initial]);

  useEffect(() => {
    if (injectedKey) {
      setAgeKey(injectedKey);
      setProfile((p) => ({ ...p, rememberKey: true }));
    }
  }, [injectedKey]);

  const set = <K extends keyof ConnectionProfile>(
    key: K,
    value: ConnectionProfile[K],
  ) => setProfile((p) => ({ ...p, [key]: value }));

  const insecure = profile.endpoint.trim().toLowerCase().startsWith("http://");

  function validate(): string | null {
    if (!profile.name.trim()) return "Please give this connection a name.";
    if (!profile.endpoint.trim()) return "The endpoint URL is required.";
    if (!profile.bucket.trim()) return "The bucket name is required.";
    if (!profile.accessKeyId.trim()) return "The access key ID is required.";
    // A stored secret only counts if it will still be there after saving — i.e.
    // the matching "remember" toggle is still on. Turning it off deletes it.
    if (!secret && !(hasSavedSecret && profile.rememberSecret))
      return "The secret access key is required.";
    if (!ageKey && !(hasSavedKey && profile.rememberKey))
      return "A private key is required to decrypt.";
    return null;
  }

  function buildCreds(): Credentials {
    return {
      secretAccessKey: secret || undefined,
      ageKey: ageKey || undefined,
    };
  }

  // The backend returns false from save_profile when "remember" was requested
  // but the OS secure store is unavailable (e.g. no Secret Service on Linux);
  // warn so the user isn't surprised that nothing was persisted.
  function warnIfNotRemembered(remembered: boolean) {
    if (remembered || (!profile.rememberSecret && !profile.rememberKey)) return;
    notifications.show({
      color: "yellow",
      icon: <IconAlertTriangle size={18} />,
      title: "Credentials not remembered",
      message:
        "No system keyring is available, so this connection will ask for credentials each time.",
      autoClose: 6000,
    });
  }

  async function handleConnect() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const creds = buildCreds();
      // Persist metadata + secrets (per remember flags) before connecting.
      const remembered = await api.saveProfile(profile, creds);
      warnIfNotRemembered(remembered);
      onConnect(profile, creds);
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveOnly() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const remembered = await api.saveProfile(profile, buildCreds());
      warnIfNotRemembered(remembered);
      onCancel();
    } catch (e) {
      setError(errText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Box maw={620} mx="auto" px="md" py="xl">
      <Group mb="lg" mt="md" gap="xs">
        <ActionIcon variant="subtle" color="gray" onClick={onCancel} size="lg">
          <IconArrowLeft size={20} />
        </ActionIcon>
        <Title order={2}>
          {initial ? "Edit connection" : "New connection"}
        </Title>
      </Group>

      <Stack>
        {error && (
          <Alert
            color="red"
            icon={<IconAlertTriangle size={18} />}
            variant="light"
          >
            {error}
          </Alert>
        )}

        <TextInput
          label="Connection name"
          placeholder="My exports"
          value={profile.name}
          onChange={(e) => set("name", e.currentTarget.value)}
        />

        <Divider label="Storage" labelPosition="left" mt="xs" />

        <TextInput
          label="Endpoint URL"
          placeholder="https://s3.example.com"
          value={profile.endpoint}
          onChange={(e) => set("endpoint", e.currentTarget.value)}
        />
        {insecure && (
          <Alert
            color="orange"
            icon={<IconAlertTriangle size={18} />}
            variant="light"
            p="xs"
          >
            This endpoint uses plain <b>http://</b>. Your credentials and data
            would travel unencrypted. Use <b>https://</b> unless this is a local
            test server.
          </Alert>
        )}

        <Group grow>
          <TextInput
            label="Bucket"
            placeholder="my-bucket"
            value={profile.bucket}
            onChange={(e) => set("bucket", e.currentTarget.value)}
          />
          <TextInput
            label="Region"
            placeholder="us-east-1"
            value={profile.region}
            onChange={(e) => set("region", e.currentTarget.value)}
          />
        </Group>

        <TextInput
          label="Access key ID"
          value={profile.accessKeyId}
          onChange={(e) => set("accessKeyId", e.currentTarget.value)}
        />

        <PasswordInput
          label="Secret access key"
          placeholder={
            hasSavedSecret ? "•••••••• (saved — leave blank to keep)" : ""
          }
          value={secret}
          onChange={(e) => setSecret(e.currentTarget.value)}
        />

        <Switch
          label="Path-style URLs (required for MinIO / Ceph)"
          checked={profile.pathStyle}
          onChange={(e) => set("pathStyle", e.currentTarget.checked)}
        />

        <TextInput
          label="Start folder (optional)"
          description="Limit the browser to a prefix, e.g. tenant-123/"
          value={profile.basePrefix}
          onChange={(e) => set("basePrefix", e.currentTarget.value)}
        />

        <Divider label="Decryption" labelPosition="left" mt="xs" />

        <div>
          <Group justify="space-between" align="flex-end" mb={4}>
            <Text size="sm" fw={500}>
              Private key (age or SSH)
            </Text>
            <Tooltip label="Generate a new key pair" withArrow>
              <Button
                size="compact-xs"
                variant="subtle"
                leftSection={<IconKey size={14} />}
                onClick={onGenerateKey}
              >
                I don't have one yet
              </Button>
            </Tooltip>
          </Group>
          <Textarea
            placeholder={
              hasSavedKey
                ? "•••••••• (saved — leave blank to keep)"
                : "AGE-SECRET-KEY-1... or an OpenSSH private key"
            }
            autosize
            minRows={3}
            maxRows={6}
            value={ageKey}
            onChange={(e) => setAgeKey(e.currentTarget.value)}
            styles={{
              input: { fontFamily: "var(--mantine-font-family-monospace)" },
            }}
          />
        </div>

        <Group gap="xl">
          <Switch
            label="Remember secret key in this device's secure store"
            checked={profile.rememberSecret}
            onChange={(e) => set("rememberSecret", e.currentTarget.checked)}
          />
          <Switch
            label="Remember private key in this device's secure store"
            checked={profile.rememberKey}
            onChange={(e) => set("rememberKey", e.currentTarget.checked)}
          />
        </Group>

        <Group mt="md">
          <Button variant="default" onClick={onCancel}>
            Cancel
          </Button>
          <Box flex={1} />
          <Button variant="light" onClick={handleSaveOnly} loading={busy}>
            Save
          </Button>
          <Button
            leftSection={<IconPlugConnected size={18} />}
            onClick={handleConnect}
            loading={busy}
          >
            Save &amp; connect
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}
