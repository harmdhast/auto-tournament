import { Card, CardActionArea, CardContent, Typography, Box, Chip } from '@mui/material';
import { MapTrifoldIcon } from '@phosphor-icons/react';
import type { Map } from '../cs2.types';
import { FadeInImage } from '../common/FadeInImage';
import { useModuleTranslation } from '../../../module-sdk';
import { mapImageFallback, mapImageUrl } from './cs2Assets';
import { mapModeColor, mapModeKey, mapModeOf } from './mapModes';

interface MapCardProps {
  map: Map;
  onClick: (map: Map) => void;
}

export function MapCard({ map, onClick }: MapCardProps) {
  const { t } = useModuleTranslation('cs2');
  const mode = mapModeOf(map);
  const imageUrl = mapImageUrl(map.id, 'small', map.imageUrl);
  const fallbackUrl = mapImageFallback(map.id, 'small', map.imageUrl);

  return (
    <Card
      data-testid={`map-card-${map.id}`}
      elevation={1}
      sx={{
        height: '100%',
        width: '100%',
        transition: 'background-color 0.2s',
        '&:hover': {
          bgcolor: 'var(--at-paper3)',
        },
      }}
    >
      <CardActionArea
        onClick={() => onClick(map)}
        sx={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}
      >
        <Box
          sx={{
            height: '140px',
            width: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <FadeInImage
            src={imageUrl}
            fallbackSrc={fallbackUrl}
            alt={map.displayName}
            height="100%"
            width="100%"
            placeholder={<MapTrifoldIcon size={48} />}
          />
        </Box>
        <CardContent
          sx={{
            flexGrow: 1,
            display: 'flex',
            flexDirection: 'column',
            pt: 2,
            px: 2,
            pb: 1.5,
            '&:last-child': {
              pb: 1.5,
            },
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <Typography variant="h6" component="div" gutterBottom>
              {map.displayName}
            </Typography>
            {mode && (
              <Chip
                label={t(mapModeKey(mode))}
                size="small"
                color={mapModeColor(mode)}
                variant="outlined"
                data-testid={`map-card-mode-${map.id}`}
                sx={{ flexShrink: 0, mt: 0.25 }}
              />
            )}
          </Box>
          <Typography variant="body2" color="text.secondary">
            {map.id}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
