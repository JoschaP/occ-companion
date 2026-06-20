import { render } from "@testing-library/react";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import type { ReactNode } from "react";

import { theme } from "../theme";

/** Render a component tree inside the app's Mantine provider (incl. the
    notifications container so toasts are assertable). */
export function renderUI(ui: ReactNode) {
  return render(
    <MantineProvider theme={theme}>
      <Notifications />
      {ui}
    </MantineProvider>,
  );
}
