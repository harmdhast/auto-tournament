import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Box,
  Typography,
  Switch,
  FormControlLabel,
  IconButton,
  CircularProgress,
  Alert,
} from '@mui/material';
import { XIcon } from '@phosphor-icons/react';
import { api, useSnackbar, ConfirmDialog, useModuleTranslation } from '../../../module-sdk';
import type { Server } from '../cs2.types';

/**
 * Edit one server's settings.
 */
export interface ServerModalProps {
  open: boolean;
  server: Server | null;
  onClose: () => void;
  onSave: () => void;
}

export default function ServerModal({ open, server, onClose, onSave }: ServerModalProps) {
  const { showSuccess, showError } = useSnackbar();
  const [name, setName] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [tournamentUse, setTournamentUse] = useState(true);
  const [failoverUse, setFailoverUse] = useState(true);
  const [skins, setSkins] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  const { t } = useModuleTranslation('cs2');

  useEffect(() => {
    if (server) {
      setName(server.name);
      setEnabled(server.enabled);
      setTournamentUse(server.tournamentUse !== false);
      setFailoverUse(server.failoverUse !== false);
      setSkins(server.skins === true);
    } else {
      resetForm();
    }
  }, [server, open]);

  const resetForm = () => {
    setName('');
    setEnabled(true);
    setError('');
  };
  const handleNameChange = (value: string) => {
    setName(value);
    if (error) setError(''); // Clear error when user starts typing
  };

  const handleSave = async () => {
    if (!server) return;
    if (!name.trim()) {
      setError(t('serverModal.errors.nameRequired'));
      return;
    }

    setSaving(true);
    setError('');

    try {
      await api.put(`/api/servers/${server.id}`, {
        name: name.trim(),
        enabled,
        tournamentUse,
        failoverUse,
        skins,
      });
      showSuccess(t('serverModal.success.serverUpdated'));
      onSave();
      resetForm();
      onClose();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('serverModal.errors.saveFailed');
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteClick = () => {
    setConfirmDeleteOpen(true);
  };

  const handleDeleteConfirm = async () => {
    if (!server) return;
    setConfirmDeleteOpen(false);

    setSaving(true);
    try {
      await api.delete(`/api/servers/${server.id}`);
      showSuccess(t('serverModal.success.serverDeleted'));
      onSave();
      resetForm();
      onClose();
    } catch (err) {
      const error = err as Error;
      const errorMessage = error.message || t('serverModal.errors.deleteFailed');
      setError(errorMessage);
      showError(errorMessage);
    } finally {
      setSaving(false);
    }
  };

  const handleDialogClose = (
    _event: React.SyntheticEvent | Event,
    reason: 'backdropClick' | 'escapeKeyDown'
  ) => {
    // Prevent accidental closes via backdrop or ESC; require explicit Cancel/X.
    if (reason === 'backdropClick' || reason === 'escapeKeyDown') {
      return;
    }
    onClose();
  };

  return (
    <>
      <Dialog
        open={open}
        onClose={handleDialogClose}
        maxWidth="sm"
        fullWidth
        data-testid="server-modal"
        disableEscapeKeyDown
      >
        <DialogTitle
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Typography variant="h6" fontWeight={600}>
            {t('serverModal.titleEdit')}
          </Typography>
          <IconButton onClick={onClose} size="small" aria-label="close">
            <XIcon size={20} />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ px: 3, pt: 2, pb: 1 }}>
          {error && (
            <Alert severity="error" sx={{ mb: 2 }}>
              {error}
            </Alert>
          )}

          <Box display="flex" flexDirection="column" gap={2}>
            <TextField
              label={t('serverModal.serverNameLabel')}
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder={t('serverModal.serverNamePlaceholder')}
              required
              fullWidth
              slotProps={{
                htmlInput: { 'data-testid': 'server-name-input' },
              }}
            />

            <FormControlLabel
              control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {t('serverModal.enabledLabel')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('serverModal.enabledHelper')}
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={tournamentUse}
                  onChange={(e) => setTournamentUse(e.target.checked)}
                  inputProps={{ 'aria-label': t('serverModal.tournamentUseLabel') }}
                  data-testid="server-tournament-use"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {t('serverModal.tournamentUseLabel')}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('serverModal.tournamentUseHelper')}
                  </Typography>
                </Box>
              }
            />

            <FormControlLabel
              control={
                <Switch
                  checked={failoverUse && tournamentUse}
                  disabled={!tournamentUse}
                  onChange={(e) => setFailoverUse(e.target.checked)}
                  inputProps={{
                    'aria-label': t('serverModal.failoverUseLabel', {
                      defaultValue: 'Use for failover',
                    }),
                  }}
                  data-testid="server-failover-use"
                />
              }
              label={
                <Box>
                  <Typography variant="body2" fontWeight={500}>
                    {t('serverModal.failoverUseLabel', { defaultValue: 'Use for failover' })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {t('serverModal.failoverUseHelper', {
                      defaultValue:
                        'Off: automatic failover never moves a match here or keeps it as a spare.',
                    })}
                  </Typography>
                </Box>
              }
            />

            {skins && server?.steamToken === true && (
              <Alert severity="warning" data-testid="server-skins-token-warning">
                {t('serverModal.skinsTokenWarning')}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 3, gap: 1 }}>
          <Button
            data-testid="server-delete-button"
            onClick={handleDeleteClick}
            color="error"
            disabled={saving}
            sx={{ mr: 'auto' }}
          >
            {t('serverModal.buttons.deleteServer')}
          </Button>
          <Button onClick={onClose} disabled={saving}>
            {t('serverModal.buttons.cancel')}
          </Button>
          <Button
            data-testid="server-save-button"
            onClick={handleSave}
            variant="contained"
            disabled={saving}
            startIcon={saving ? <CircularProgress size={20} color="inherit" /> : undefined}
            sx={{ ml: 'auto' }}
          >
            {saving ? t('serverModal.buttons.saving') : t('serverModal.buttons.saveChanges')}
          </Button>
        </DialogActions>
      </Dialog>

      <ConfirmDialog
        open={confirmDeleteOpen}
        title={t('serverModal.confirmDelete.title')}
        message={t('serverModal.confirmDelete.message', { name: server?.name })}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setConfirmDeleteOpen(false)}
        confirmColor="error"
      />
    </>
  );
}
