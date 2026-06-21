// OCC design tokens, mirrored from the OCC web console (../frontend).
// Same primary blue scale, gray/status scales, fonts and radii so the app
// is visually part of the OCC family.

import { createTheme, type MantineColorsTuple } from "@mantine/core";

const primary: MantineColorsTuple = [
  "#e7f4ff",
  "#d0e5ff",
  "#9ec8fc",
  "#69aafb",
  "#4190fa",
  "#2b7ffa",
  "#1e77fb",
  "#1165e1",
  "#0054BC",
  "#004db2",
];

const gray: MantineColorsTuple = [
  "#FAFAFA",
  "#E7EBEE",
  "#DBE0E3",
  "#E1E7EB",
  "#B5BDC2",
  "#A9B2B8",
  "#6B7C85",
  "#39505D",
  "#082231",
  "#061D2A",
];

const green: MantineColorsTuple = [
  "#EFFEE7",
  "#E0F8D4",
  "#C2EFAB",
  "#A2E67E",
  "#87DE57",
  "#75D940",
  "#6BD731",
  "#59BE23",
  "#4DA91B",
  "#3D920C",
];

const orange: MantineColorsTuple = [
  "#FFF4E2",
  "#FFE9CC",
  "#FFD09C",
  "#FDB766",
  "#FCA13A",
  "#FB931D",
  "#FC8C0C",
  "#E17900",
  "#C86A00",
  "#AE5A00",
];

const red: MantineColorsTuple = [
  "#FFE9E9",
  "#FFD1D1",
  "#FBA0A1",
  "#F76D6D",
  "#F34141",
  "#F22625",
  "#F21616",
  "#D8070B",
  "#C10008",
  "#A90003",
];

export const theme = createTheme({
  primaryColor: "primary",
  primaryShade: { light: 8, dark: 6 },
  autoContrast: true,
  fontFamily: "Anek Latin Regular, -apple-system, BlinkMacSystemFont, sans-serif",
  fontFamilyMonospace:
    "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  headings: {
    fontFamily: "Space Grotesk Bold, sans-serif",
    fontWeight: "700",
  },
  defaultRadius: "md",
  radius: {
    xs: "4px",
    sm: "8px",
    md: "10px",
    lg: "14px",
    xl: "18px",
  },
  colors: { primary, gray, green, orange, red },
});
