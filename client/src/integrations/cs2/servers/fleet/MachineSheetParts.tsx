import { Box, Stack, Typography } from '@mui/material';
import { fontDisplay, mono, radii, tokens } from '../../../../module-sdk';

const { color } = tokens;

function barColor(pct: number): string {
  if (pct >= 90) return color.ban;
  if (pct >= 75) return color.warning;
  return color.live;
}

export function Bar({ label, value, pct }: { label: string; value: string; pct: number }) {
  return (
    <Box>
      <Stack direction="row" justifyContent="space-between" mb={0.75}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="body2" sx={mono}>
          {value}
        </Typography>
      </Stack>
      <Box sx={{ height: 6, borderRadius: radii.pill, bgcolor: color.paper3, overflow: 'hidden' }}>
        <Box
          sx={{
            width: `${Math.min(100, Math.max(0, pct))}%`,
            height: '100%',
            bgcolor: barColor(pct),
          }}
        />
      </Box>
    </Box>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Typography sx={{ fontFamily: fontDisplay, fontWeight: 600 }}>{children}</Typography>;
}
