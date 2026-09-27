import { Box, Text } from "ink";
import { useEffect, useState } from "react";
import { SPINNER_FRAMES, theme } from "../theme.ts";

export function Spinner({ label = "Running" }: { label?: string }) {
  const [frame, setFrame] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => setFrame((value) => (value + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(timer);
  }, []);
  return (
    <Box>
      <Text color={theme.brand}>{SPINNER_FRAMES[frame]} </Text>
      <Text color={theme.dim}>{label}…  (esc to interrupt)</Text>
    </Box>
  );
}
