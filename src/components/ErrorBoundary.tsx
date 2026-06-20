import { Component, type ReactNode } from "react";
import { Button, Code, Stack, Text, Title } from "@mantine/core";

interface State {
  error: Error | null;
}

/** Catches render-time crashes so the app shows a recoverable message instead
    of a blank window. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Unhandled UI error:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <Stack p="xl" maw={560} mx="auto" mt={60} gap="sm">
          <Title order={3}>Something went wrong</Title>
          <Text c="dimmed" size="sm">
            The app hit an unexpected error. Your keys and files are not
            affected — nothing was sent anywhere.
          </Text>
          <Code block>{this.state.error.message}</Code>
          <Button onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
        </Stack>
      );
    }
    return this.props.children;
  }
}
