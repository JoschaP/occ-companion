import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockApi = vi.hoisted(() => ({
  generateKeypair: vi.fn(),
  saveTextFile: vi.fn(),
  listProfiles: vi.fn(),
  saveProfile: vi.fn(),
  deleteProfile: vi.fn(),
  profilePublicKey: vi.fn(),
  exportRescueKit: vi.fn(),
  secretStatus: vi.fn(),
  connect: vi.fn(),
  checkKeys: vi.fn(),
  listObjects: vi.fn(),
  disconnect: vi.fn(),
  downloadDecrypt: vi.fn(),
  checkUpdate: vi.fn(),
}));

vi.mock("./api", () => ({
  api: mockApi,
  onProgress: vi.fn().mockResolvedValue(() => {}),
  onFileDone: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ setSize: vi.fn(), center: vi.fn() }),
  LogicalSize: class {
    constructor(
      public width: number,
      public height: number,
    ) {}
  },
}));
vi.mock("@tauri-apps/api/app", () => ({
  getVersion: () => Promise.resolve("0.1.0"),
}));
vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: vi.fn(),
  revealItemInDir: vi.fn(),
}));

import App from "./App";
import { renderUI } from "./test/util";

const profile = {
  id: "p1",
  name: "My exports",
  endpoint: "https://s3.example.com",
  region: "us-east-1",
  bucket: "my-bucket",
  accessKeyId: "AKIA",
  pathStyle: true,
  basePrefix: "",
  rememberSecret: true,
  rememberKey: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockApi.listProfiles.mockResolvedValue([]);
  mockApi.checkUpdate.mockResolvedValue({
    current: "0.1.0",
    latest: "0.1.0",
    updateAvailable: false,
    url: "",
  });
});

describe("App — connections flow", () => {
  it("shows the empty state with no connections", async () => {
    renderUI(<App />);
    expect(await screen.findByText(/No connections yet/i)).toBeInTheDocument();
  });

  it("opens the connection form from 'New connection'", async () => {
    const user = userEvent.setup();
    renderUI(<App />);
    await screen.findByText(/No connections yet/i);
    await user.click(screen.getAllByRole("button", { name: /New connection/i })[0]);
    expect(
      await screen.findByRole("heading", { name: /New connection/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Endpoint URL/i)).toBeInTheDocument();
  });

  it("lists a saved profile and connects into the explorer", async () => {
    mockApi.listProfiles.mockResolvedValue([profile]);
    mockApi.secretStatus.mockResolvedValue({ hasSecret: true, hasKey: true });
    mockApi.connect.mockResolvedValue({ bucket: "my-bucket", basePrefix: "" });
    mockApi.listObjects.mockResolvedValue([
      { key: "log-export/2026-06-20/a.json.age", size: 1024, lastModified: null },
    ]);

    const user = userEvent.setup();
    renderUI(<App />);

    await user.click(await screen.findByText("My exports"));

    await waitFor(() => expect(mockApi.connect).toHaveBeenCalled());
    // Explorer toolbar + status bar reflect the connected bucket.
    expect(await screen.findByText("my-bucket")).toBeInTheDocument();
    expect(await screen.findByText(/1 object/i)).toBeInTheDocument();
  });

  it("surfaces a connection error and stays on the list", async () => {
    mockApi.listProfiles.mockResolvedValue([profile]);
    mockApi.secretStatus.mockResolvedValue({ hasSecret: true, hasKey: true });
    mockApi.connect.mockRejectedValue("Access denied. Check your access key ID.");

    const user = userEvent.setup();
    renderUI(<App />);
    await user.click(await screen.findByText("My exports"));

    expect(await screen.findByText(/Access denied/i)).toBeInTheDocument();
    // Did not navigate to the explorer.
    expect(mockApi.listObjects).not.toHaveBeenCalled();
  });
});
