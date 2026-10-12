import React from 'react';
import { Box } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';

/**
 * A map or thumbnail image that fades in once loaded, over a gradient that
 * stays if it never does. CS2's own copy: the module's map cards, veto and
 * server panel use it. Core keeps its copy for the match details dialog and
 * the team page's map list until those CS2 visuals leave core (item 8b).
 */
interface FadeInImageProps {
  src: string;
  alt: string;
  /**
   * Optional explicit height/width; otherwise the container should control size.
   */
  height?: number | string;
  width?: number | string;
  /**
   * Additional styles applied to the outer container.
   */
  sx?: SxProps<Theme>;
  /**
   * Optional children rendered on top of the image (e.g., labels, gradients).
   */
  children?: React.ReactNode;
  /**
   * Tried once when `src` fails to load.
   */
  fallbackSrc?: string;
  /**
   * Shown in place of the image when it (and the fallback) failed to load.
   */
  placeholder?: React.ReactNode;
}

const FadeInImageInner: React.FC<FadeInImageProps> = ({
  src,
  alt,
  height,
  width,
  sx,
  children,
  fallbackSrc,
  placeholder,
}) => {
  const [loaded, setLoaded] = React.useState(false);
  const [error, setError] = React.useState(false);
  const [useFallback, setUseFallback] = React.useState(false);

  const handleError = () => {
    if (fallbackSrc && !useFallback) setUseFallback(true);
    else setError(true);
  };

  return (
    <Box
      sx={[
        (theme) => ({
          position: 'relative',
          overflow: 'hidden',
          height,
          width,
          background: `linear-gradient(135deg, ${theme.palette.background.default}, ${theme.palette.background.paper})`,
        }),
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {!error && (
        <Box
          component="img"
          src={useFallback && fallbackSrc ? fallbackSrc : src}
          alt={alt}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={handleError}
          sx={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            opacity: loaded ? 1 : 0,
            transition: 'opacity 0.6s ease-in-out',
          }}
        />
      )}

      {error && placeholder && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'text.disabled',
          }}
        >
          {placeholder}
        </Box>
      )}

      {/* Overlay content (labels, gradients, etc.) */}
      {children && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  );
};

/** State is per `src`: a new picture starts unloaded, unfailed and without its fallback. */
export const FadeInImage: React.FC<FadeInImageProps> = (props) => (
  <FadeInImageInner key={props.src} {...props} />
);
