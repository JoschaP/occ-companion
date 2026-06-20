import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  api: {
    secretStatus: vi.fn(),
    saveProfile: vi.fn(),
  },
}));

import { api } from "../api";
import { ConnectionForm } from "./ConnectionForm";
import type { ConnectionProfile } from "../types";
import { renderUI } from "../test/util";

const mockApi = api as unknown as {
  secretStatus: ReturnType<typeof vi.fn>;
  saveProfile: ReturnType<typeof vi.fn>;
};

const savedProfile: ConnectionProfile = {
  id: "p1",
  name: "Mine",
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "bucket",
  accessKeyId: "AKIA",
  pathStyle: true,
  basePrefix: "",
  rememberSecret: true,
  rememberKey: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.secretStatus.mockResolvedValue({ hasSecret: true, hasKey: true });
  mockApi.saveProfile.mockResolvedValue(undefined);
});

describe("ConnectionForm", () => {
  it("warns when the endpoint uses plain http", async () => {
    const user = userEvent.setup();
    renderUI(
      <ConnectionForm
        initial={null}
        onCancel={vi.fn()}
        onConnect={vi.fn()}
        onGenerateKey={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/Endpoint URL/i), "http://insecure.test");
    expect(await screen.findByText(/uses plain/i)).toBeInTheDocument();
  });

  it("blocks saving a nameless connection with a clear error", async () => {
    const user = userEvent.setup();
    renderUI(
      <ConnectionForm
        initial={null}
        onCancel={vi.fn()}
        onConnect={vi.fn()}
        onGenerateKey={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /^Save$/ }));
    expect(await screen.findByText(/give this connection a name/i)).toBeInTheDocument();
    expect(mockApi.saveProfile).not.toHaveBeenCalled();
  });

  // Regression: turning off "remember" deletes the stored secret on save, so a
  // previously-stored secret must no longer satisfy validation.
  it("requires the secret again once 'remember secret' is switched off", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    renderUI(
      <ConnectionForm
        initial={savedProfile}
        onCancel={vi.fn()}
        onConnect={onConnect}
        onGenerateKey={vi.fn()}
      />,
    );

    // Wait until the form knows a secret is stored.
    await screen.findAllByPlaceholderText(/saved — leave blank to keep/i);

    // Switch off "remember secret".
    await user.click(screen.getByLabelText(/Remember secret key/i));
    await user.click(screen.getByRole("button", { name: /Save & connect/i }));

    expect(
      await screen.findByText(/secret access key is required/i),
    ).toBeInTheDocument();
    expect(onConnect).not.toHaveBeenCalled();
    expect(mockApi.saveProfile).not.toHaveBeenCalled();
  });

  it("saves & connects when a stored profile is unchanged", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    renderUI(
      <ConnectionForm
        initial={savedProfile}
        onCancel={vi.fn()}
        onConnect={onConnect}
        onGenerateKey={vi.fn()}
      />,
    );
    await screen.findAllByPlaceholderText(/saved — leave blank to keep/i);
    await user.click(screen.getByRole("button", { name: /Save & connect/i }));

    await waitFor(() => expect(mockApi.saveProfile).toHaveBeenCalled());
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "p1" }),
      expect.anything(),
    );
  });
});
