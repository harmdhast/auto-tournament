import type { ReactNode } from 'react';
import { Box, Button, Dialog, Typography } from '@mui/material';
import { useModuleTranslation, tokens, fontDisplay, radii } from '../../../module-sdk';
import type { LoadoutTeam } from './loadoutSides';
import type { OwnedSkin } from './useSkins';

const { color } = tokens;

/**
 * Which side a skin both sides can use goes on (a click or Enter on its card):
 * CT, T or both, or off again. Dragging it onto a side's slot does the same.
 * A catalogue pick passes its float and seed fields as children, and `again`
 * to let a side that already has the skin take new values.
 */
export function SidePicker({
  skin,
  onPick,
  onTakeOff,
  onClose,
  oneSide = false,
  again = false,
  disabled = false,
  testId = 'side-picker',
  children,
}: {
  skin: Pick<OwnedSkin, 'weaponName' | 'name' | 'equippedSides' | 'equipped'>;
  onPick: (team: LoadoutTeam) => void;
  onTakeOff?: () => void;
  onClose: () => void;
  /** A weapon one side buys: one button, it is always "both". */
  oneSide?: boolean;
  again?: boolean;
  disabled?: boolean;
  testId?: string;
  children?: ReactNode;
}) {
  const { t } = useModuleTranslation('cs2');
  const on = (team: LoadoutTeam) =>
    !again && (skin.equippedSides.includes(team) || skin.equippedSides.includes(0));
  const actions: Array<{ team: LoadoutTeam; label: string; id: string; done: boolean }> = oneSide
    ? [{ team: 0, label: t('skins.catalog.equip'), id: 'both', done: false }]
    : [
        { team: 3, label: t('skins.equipOnCt'), id: 'ct', done: on(3) },
        { team: 2, label: t('skins.equipOnT'), id: 't', done: on(2) },
        {
          team: 0,
          label: t('skins.equipOnBoth'),
          id: 'both',
          done: !again && skin.equippedSides.includes(0),
        },
      ];
  return (
    <Dialog
      open
      onClose={onClose}
      aria-labelledby="side-picker-title"
      PaperProps={{
        sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
      }}
    >
      <Box
        data-testid={testId}
        sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2, width: 'min(360px, 85vw)' }}
      >
        <Typography
          id="side-picker-title"
          component="h2"
          sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
        >
          {skin.weaponName} | {skin.name}
        </Typography>
        {children}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {actions.map((a) => (
            <Button
              key={a.id}
              variant={a.done ? 'outlined' : 'contained'}
              disabled={a.done || disabled}
              onClick={() => onPick(a.team)}
              data-testid={`${testId}-${a.id}`}
              sx={{ borderRadius: radii.pill, justifyContent: 'center' }}
            >
              {a.label}
            </Button>
          ))}
          {again && (
            <Button
              onClick={onClose}
              data-testid={`${testId}-cancel`}
              sx={{ borderRadius: radii.pill, color: color.ink2 }}
            >
              {t('skins.catalog.cancel')}
            </Button>
          )}
          {onTakeOff && skin.equipped && (
            <Button
              onClick={onTakeOff}
              data-testid={`${testId}-off`}
              sx={{ borderRadius: radii.pill, color: color.ink2 }}
            >
              {t('skins.takeOff')}
            </Button>
          )}
        </Box>
      </Box>
    </Dialog>
  );
}
