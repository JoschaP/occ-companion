import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// Mantine reads matchMedia; jsdom doesn't implement it.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }),
});

// react-arborist / Mantine measure elements via ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
  ResizeObserverStub;

// jsdom lacks these layout methods used by Mantine/scroll areas.
Element.prototype.scrollIntoView = vi.fn();

// jsdom has no FontFaceSet; Mantine's autosize Textarea listens on it.
Object.defineProperty(document, "fonts", {
  writable: true,
  value: {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    ready: Promise.resolve(),
  },
});
