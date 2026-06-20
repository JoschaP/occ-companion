import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import { Notifications, notifications } from "@mantine/notifications";

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./assets/fonts/fonts.css";
import "./styles.css";

import { theme } from "./theme";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

// Safety net: surface any async error that slipped past a local try/catch
// instead of letting it vanish silently.
window.addEventListener("unhandledrejection", (event) => {
  notifications.show({
    color: "red",
    title: "Unexpected error",
    message: String(event.reason),
    autoClose: 6000,
  });
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="auto">
      <Notifications position="top-right" />
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </MantineProvider>
  </React.StrictMode>,
);
