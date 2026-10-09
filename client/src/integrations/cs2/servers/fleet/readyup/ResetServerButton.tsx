/** Reset a Ready Up server: whatever it holds goes, so it can take the next match (api fleet/reset.ts). */
import { useRef, useState } from 'react';
import { IconButton, Tooltip } from '@mui/material';
import { ArrowCounterClockwiseIcon } from '@phosphor-icons/react';
import {
  ConfirmDialog,
  api,
  apiErrorMessage,
  useModuleTranslation,
  useSnackbar,
} from '../../../../../module-sdk';
import type { FleetServer } from '../../../cs2.types';

export interface ResetResult {
  ok: true;
  ended: 'assignment' | 'local' | 'none';
  settledMatchSlug: string | null;
}

export function ResetServerButton({
  server,
  onDone,
}: {
  server: FleetServer;
  onDone?: (res: ResetResult) => void;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showSnackbar, showError } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const slug = server.availabilityDetail;

  const confirm = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const res = await api.post<ResetResult>(`/api/fleet/servers/${server.id}/reset`);
      setOpen(false);
      showSnackbar(
        res.settledMatchSlug
          ? t('serversBoard.readyUp.reset.doneMatch', {
              name: server.name,
              slug: res.settledMatchSlug,
            })
          : t('serversBoard.readyUp.reset.done', { name: server.name }),
        'success'
      );
      onDone?.(res);
    } catch (err) {
      showError(apiErrorMessage(err, t('serversBoard.readyUp.reset.failed')));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <>
      <Tooltip title={t('serversBoard.readyUp.reset.action')}>
        <span>
          <IconButton
            size="small"
            onClick={() => setOpen(true)}
            disabled={!server.online || busy}
            aria-label={t('serversBoard.readyUp.reset.action')}
            data-testid={`fleet-reset-${server.id}`}
          >
            <ArrowCounterClockwiseIcon size={20} />
          </IconButton>
        </span>
      </Tooltip>
      <ConfirmDialog
        open={open}
        title={t('serversBoard.readyUp.reset.title', { name: server.name })}
        message={
          slug
            ? t('serversBoard.readyUp.reset.messageMatch', { slug })
            : t('serversBoard.readyUp.reset.message')
        }
        confirmLabel={t('serversBoard.readyUp.reset.action')}
        confirmColor="warning"
        loading={busy}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      />
    </>
  );
}
