import { Text } from "@mantine/core";

/**
 * Neutral text wordmark for the app, set in the brand heading face
 * (Space Grotesk Bold) so it reads as a logo without any third-party mark.
 */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <Text
      component="span"
      fw={700}
      style={{
        fontFamily: "Space Grotesk Bold, sans-serif",
        fontSize: size,
        letterSpacing: "-0.02em",
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      OCC&nbsp;Secure&nbsp;Exports
    </Text>
  );
}
