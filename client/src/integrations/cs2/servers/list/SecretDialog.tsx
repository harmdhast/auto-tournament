import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import { CopyIcon } from '@phosphor-icons/react';
import { mono, useModuleTranslation, useSnackbar } from '../../../../module-sdk';
import { insecureFlag, platformIsPlainHttp } from '../insecureLink';
import type { Secret } from '../secret.types';
import { formatWhen } from '../time';

/** A code or key, shown once. */
export function SecretDialog({ secret, onClose }: { secret: Secret | null; onClose: () => void }) {
  const { t, i18n } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const locale = i18n.language;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      showSnackbar(t('fleetPanel.copied'), 'success');
    } catch {
      showError(t('fleetPanel.copyFailed'));
    }
  };

  return (
    <Dialog open={secret !== null} onClose={onClose} maxWidth="sm" fullWidth>
        <DialogTitle>
          {secret?.kind === 'key'
            ? t('fleetPanel.keyCreatedTitle')
            : t('fleetPanel.codeCreatedTitle')}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" mb={2}>
            {secret?.kind === 'key'
              ? t('fleetPanel.keyCreatedHelp', { name: secret?.name })
              : t('fleetPanel.codeCreatedHelp', {
                  name: secret?.name,
                  time: formatWhen(secret?.expiresAt, locale),
                })}
          </Typography>
          <Box
            display="flex"
            alignItems="center"
            gap={1}
            sx={{
              p: 1.5,
              borderRadius: 1,
              bgcolor: 'action.hover',
              ...mono,
              wordBreak: 'break-all',
            }}
          >
            <Box flex={1} data-testid="fleet-secret">
              {secret?.value}
            </Box>
            <IconButton
              size="small"
              onClick={() => secret && void copy(secret.value)}
              aria-label={t('fleetPanel.copy')}
            >
              <CopyIcon size={20} />
            </IconButton>
          </Box>
          <Typography variant="caption" color="warning.main" display="block" mt={1.5}>
            {t('fleetPanel.shownOnce')}
          </Typography>
          {secret?.kind === 'code' && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="pre"
              sx={{ ...mono, mt: 1.5, whiteSpace: 'pre-wrap' }}
            >
              {`ru fleet enroll ${window.location.origin} ${secret.value}${insecureFlag()}`}
            </Typography>
          )}
          {secret?.kind === 'code' && platformIsPlainHttp() && (
            <Typography
              variant="caption"
              color="warning.main"
              display="block"
              mt={1}
              data-testid="fleet-insecure-note"
            >
              {t('fleetPanel.insecureNote')}
            </Typography>
          )}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={onClose}>
            {t('common.close')}
          </Button>
        </DialogActions>
      </Dialog>
  );
}
