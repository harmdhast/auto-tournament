/**
 * What an admin can do to one Ready Up server (FLEET.md §4): a new one-time
 * code, use for matches or stop, the connect address, rotate its token,
 * revoke, rename, remove. Also Add server (a pending record and its code) and
 * the dialog that shows a code or key once.
 */
import { useState, type ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  ArrowsClockwiseIcon,
  GlobeIcon,
  LinkBreakIcon,
  LinkIcon,
  PasswordIcon,
  PencilSimpleIcon,
  ProhibitIcon,
  TrashIcon,
} from '@phosphor-icons/react';
import {
  api,
  apiErrorMessage,
  ConfirmDialog,
  mono,
  useModuleTranslation,
  useSnackbar,
} from '../../../../module-sdk';
import type { FleetServer } from '../../cs2.types';
import type { Secret } from '../secret.types';
import { SecretDialog } from './SecretDialog';

export interface ServerAction {
  id: 'open' | 'match' | 'newCode' | 'link' | 'address' | 'rotate' | 'revoke' | 'rename' | 'remove';
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  testId?: string;
  run: () => void;
}

/** The link / connect-address dialog: `link` links the server, `edit` changes a linked server's address. */
type AddressDialog = { mode: 'link' | 'edit'; server: FleetServer; host: string; port: string };
type Pending = { action: 'revoke' | 'remove'; server: FleetServer };

export function useFleetServerActions(reload: () => Promise<void>): {
  actionsFor: (server: FleetServer) => ServerAction[];
  addServer: () => void;
  showSecret: (secret: Secret) => void;
  /** Where the connect address comes from, in words. */
  sourceLabel: (connect: FleetServer['connect']) => string;
  dialogs: ReactNode;
} {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [secret, setSecret] = useState<Secret | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [serverName, setServerName] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false);
  const [addressDialog, setAddressDialog] = useState<AddressDialog | null>(null);
  const [renameDialog, setRenameDialog] = useState<{ server: FleetServer; name: string } | null>(
    null
  );

  const renameServer = async () => {
    if (!renameDialog) return;
    const name = renameDialog.name.trim();
    if (!name) return;
    setBusy(true);
    try {
      await api.patch(`/api/fleet/servers/${renameDialog.server.id}`, { name });
      setRenameDialog(null);
      showSnackbar(t('fleetPanel.renamed'), 'success');
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.rename')));
    } finally {
      setBusy(false);
    }
  };

  const createServer = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ code: string; expiresAt: number; server: FleetServer }>(
        '/api/fleet/servers',
        { ...(serverName.trim() ? { name: serverName.trim() } : {}) }
      );
      setAddOpen(false);
      setServerName('');
      setSecret({ kind: 'code', value: res.code, expiresAt: res.expiresAt, name: res.server.name });
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createServer')));
    } finally {
      setBusy(false);
    }
  };

  const newCode = async (server: FleetServer) => {
    try {
      const res = await api.post<{ code: string; expiresAt: number }>(
        `/api/fleet/servers/${server.id}/code`
      );
      setSecret({ kind: 'code', value: res.code, expiresAt: res.expiresAt, name: server.name });
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.createServer')));
    }
  };

  const rotate = async (server: FleetServer) => {
    try {
      const res = await api.post<{ rotation: 'sent' | 'on_next_connect' }>(
        `/api/fleet/servers/${server.id}/rotate`
      );
      showSnackbar(
        res.rotation === 'sent' ? t('fleetPanel.rotateSent') : t('fleetPanel.rotateQueued'),
        'success'
      );
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.rotate')));
    }
  };

  const toggleLink = async (server: FleetServer) => {
    if (!server.linkedServerId) {
      setAddressDialog({ mode: 'link', server, host: '', port: '' });
      return;
    }
    try {
      await api.delete(`/api/fleet/servers/${server.id}/link`);
      showSnackbar(
        t('fleetPanel.unlinked', { defaultValue: 'No longer used for matches' }),
        'success'
      );
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    }
  };

  const editAddress = (server: FleetServer) => {
    const own = server.connect?.source === 'override';
    setAddressDialog({
      mode: 'edit',
      server,
      host: own ? (server.connect?.host ?? '') : '',
      port: own ? String(server.connect?.port ?? '') : '',
    });
  };

  /** Link, or save the address; `automatic` clears the override. */
  const saveAddress = async (automatic = false) => {
    if (!addressDialog) return;
    const { mode, server } = addressDialog;
    const host = automatic ? '' : addressDialog.host.trim();
    const port = automatic ? '' : addressDialog.port.trim();
    const body = host ? { host, ...(port ? { port: Number(port) } : {}) } : { host: null };
    setBusy(true);
    try {
      if (mode === 'link') {
        await api.post(`/api/fleet/servers/${server.id}/link`, host ? body : {});
        showSnackbar(t('fleetPanel.linked', { defaultValue: 'Used for matches' }), 'success');
      } else {
        await api.put(`/api/fleet/servers/${server.id}/address`, body);
        showSnackbar(
          t('fleetPanel.addressSaved', { defaultValue: 'Connect address saved' }),
          'success'
        );
      }
      setAddressDialog(null);
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    } finally {
      setBusy(false);
    }
  };

  const sourceLabel = (connect: FleetServer['connect']): string => {
    switch (connect?.source) {
      case 'override':
        return t('fleetPanel.connectSource.override', { defaultValue: 'set by an admin' });
      case 'public_addr':
        return t('fleetPanel.connectSource.publicAddr', { defaultValue: 'reported by the server' });
      case 'machine':
        return t('fleetPanel.connectSource.machine', {
          defaultValue: 'the address of the machine it runs on',
        });
      case 'peer':
        return t('fleetPanel.connectSource.peer', {
          defaultValue: 'address the server connects from',
        });
      default:
        return t('fleetPanel.connectSource.unknown', {
          defaultValue: 'not confirmed by the server yet',
        });
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === 'revoke')
        await api.post(`/api/fleet/servers/${pending.server.id}/revoke`);
      else await api.delete(`/api/fleet/servers/${pending.server.id}`);
      await reload();
    } catch (err) {
      showError(apiErrorMessage(err, t('fleetPanel.errors.action')));
    } finally {
      setBusy(false);
      setPending(null);
    }
  };

  const actionsFor = (server: FleetServer): ServerAction[] => {
    const list: ServerAction[] = [];
    if (server.status === 'pending') {
      list.push({
        id: 'newCode',
        label: t('fleetPanel.newCode'),
        icon: <PasswordIcon size={20} />,
        run: () => void newCode(server),
      });
    }
    if (server.status === 'enrolled') {
      list.push({
        id: 'link',
        label: server.linkedServerId
          ? t('fleetPanel.unlink', { defaultValue: 'Stop using for matches' })
          : t('fleetPanel.link', { defaultValue: 'Use for matches' }),
        icon: server.linkedServerId ? <LinkIcon size={20} /> : <LinkBreakIcon size={20} />,
        testId: `fleet-link-${server.id}`,
        run: () => void toggleLink(server),
      });
      if (server.linkedServerId) {
        list.push({
          id: 'address',
          label: t('fleetPanel.connectAddress', { defaultValue: 'Connect address' }),
          icon: <GlobeIcon size={20} />,
          testId: `fleet-address-${server.id}`,
          run: () => editAddress(server),
        });
      }
      list.push(
        {
          id: 'rotate',
          label: t('fleetPanel.rotate'),
          icon: <ArrowsClockwiseIcon size={20} />,
          run: () => void rotate(server),
        },
        {
          id: 'revoke',
          label: t('fleetPanel.revoke'),
          icon: <ProhibitIcon size={20} />,
          danger: true,
          testId: `fleet-revoke-${server.id}`,
          run: () => setPending({ action: 'revoke', server }),
        }
      );
    }
    list.push({
      id: 'rename',
      label: t('fleetPanel.rename'),
      icon: <PencilSimpleIcon size={20} />,
      testId: `fleet-rename-${server.id}`,
      run: () => setRenameDialog({ server, name: server.name }),
    });
    if (server.status !== 'enrolled') {
      list.push({
        id: 'remove',
        label: t('fleetPanel.remove'),
        icon: <TrashIcon size={20} />,
        danger: true,
        run: () => setPending({ action: 'remove', server }),
      });
    }
    return list;
  };

  const dialogs = (
    <>
      {/* Add server: a pending record and its one-time code */}
      <Dialog open={addOpen} onClose={() => setAddOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('fleetPanel.addServer')}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPanel.addServerHelp')}
          </Typography>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('fleetPanel.serverName')}
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            inputProps={{ maxLength: 100 }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => void createServer()}
            disabled={busy}
            data-testid="fleet-create-code"
          >
            {t('fleetPanel.createCode')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Rename */}
      <Dialog
        open={renameDialog !== null}
        onClose={() => setRenameDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t('fleetPanel.rename')}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            sx={{ mt: 1 }}
            label={t('fleetPanel.serverName')}
            value={renameDialog?.name ?? ''}
            onChange={(e) =>
              renameDialog && setRenameDialog({ ...renameDialog, name: e.target.value })
            }
            onKeyDown={(e) => {
              if (e.key === 'Enter') void renameServer();
            }}
            inputProps={{ maxLength: 100, 'data-testid': 'fleet-rename-input' }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRenameDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={() => void renameServer()}
            disabled={busy || !renameDialog?.name.trim()}
            data-testid="fleet-rename-save"
          >
            {t('fleetPanel.renameSave')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Use for matches / connect address */}
      <Dialog
        open={addressDialog !== null}
        onClose={() => setAddressDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {addressDialog?.mode === 'link'
            ? t('fleetPanel.link', { defaultValue: 'Use for matches' })
            : t('fleetPanel.connectAddress', { defaultValue: 'Connect address' })}
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" mb={2}>
            {t('fleetPanel.addressHelp', {
              defaultValue:
                'Players connect to this address. Leave it empty to use the address the server reports, or the one it connects from.',
            })}
          </Typography>
          {addressDialog && (
            <Typography variant="body2" sx={mono} mb={2} data-testid="fleet-address-detected">
              {addressDialog.server.connect
                ? `${t('fleetPanel.addressCurrent', { defaultValue: 'Now' })}: connect ${addressDialog.server.connect.address} (${sourceLabel(addressDialog.server.connect)})`
                : t('fleetPanel.addressNone', {
                    defaultValue: 'No address detected yet: the server has not connected.',
                  })}
            </Typography>
          )}
          <Stack direction="row" gap={1}>
            <TextField
              autoFocus
              fullWidth
              size="small"
              label={t('fleetPanel.addressHost', { defaultValue: 'Host or IP' })}
              placeholder={addressDialog?.server.connect?.host ?? ''}
              value={addressDialog?.host ?? ''}
              onChange={(e) =>
                addressDialog && setAddressDialog({ ...addressDialog, host: e.target.value })
              }
              inputProps={{ maxLength: 253, 'data-testid': 'fleet-address-host' }}
            />
            <TextField
              size="small"
              type="number"
              label={t('fleetPanel.addressPort', { defaultValue: 'Port' })}
              placeholder={String(
                addressDialog?.server.connect?.port ?? addressDialog?.server.host?.game_port ?? ''
              )}
              value={addressDialog?.port ?? ''}
              onChange={(e) =>
                addressDialog && setAddressDialog({ ...addressDialog, port: e.target.value })
              }
              inputProps={{ min: 1, max: 65535, 'data-testid': 'fleet-address-port' }}
              sx={{ width: 120 }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddressDialog(null)}>{t('common.cancel')}</Button>
          {addressDialog?.mode === 'edit' &&
            addressDialog.server.connect?.source === 'override' && (
              <Button onClick={() => void saveAddress(true)} disabled={busy}>
                {t('fleetPanel.addressAutomatic', { defaultValue: 'Use detected address' })}
              </Button>
            )}
          <Button
            variant="contained"
            onClick={() => void saveAddress()}
            disabled={busy || (addressDialog?.mode === 'edit' && !addressDialog.host.trim())}
            data-testid="fleet-address-save"
          >
            {addressDialog?.mode === 'link'
              ? t('fleetPanel.link', { defaultValue: 'Use for matches' })
              : t('fleetPanel.save', { defaultValue: 'Save' })}
          </Button>
        </DialogActions>
      </Dialog>

      <SecretDialog secret={secret} onClose={() => setSecret(null)} />

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.action === 'remove'
            ? t('fleetPanel.confirm.removeTitle')
            : t('fleetPanel.confirm.revokeTitle')
        }
        message={
          pending?.action === 'remove'
            ? t('fleetPanel.confirm.removeMessage', { name: pending.server.name })
            : t('fleetPanel.confirm.revokeMessage', { name: pending?.server.name ?? '' })
        }
        confirmLabel={pending?.action === 'remove' ? undefined : t('fleetPanel.revoke')}
        confirmColor="error"
        loading={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </>
  );

  return {
    actionsFor,
    addServer: () => setAddOpen(true),
    showSecret: setSecret,
    sourceLabel,
    dialogs,
  };
}
