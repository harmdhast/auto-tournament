import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Dialog,
  Slider,
  TextField,
  Typography,
} from '@mui/material';
import {
  api,
  useModuleTranslation,
  useSnackbar,
  tokens,
  fontDisplay,
  radii,
} from '../../../module-sdk';
import { SkinImage } from './SkinParts';
import { rarityColor } from './rarity';
import { wearKey, type CatalogSkin, type OwnedSkin, type PickInput } from './useSkins';

const { color } = tokens;

const DEFAULT_FLOAT = 0.01;
const DEFAULT_PATTERN = 0;

const label = (skin: Pick<CatalogSkin, 'name' | 'variant'>) =>
  skin.variant ? `${skin.name} (${skin.variant})` : skin.name;

/**
 * Every catalogue skin as a grid (search, and one weapon when a loadout slot
 * was chosen); a click opens the float and pattern to equip it with.
 */
export function CatalogPicker({
  weapon,
  category,
  picks,
  onPick,
}: {
  weapon: string | null;
  category: string;
  picks: OwnedSkin[];
  onPick: (input: PickInput) => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [loaded, setLoaded] = useState<{ key: string; skins: CatalogSkin[] } | null>(null);
  const [chosen, setChosen] = useState<CatalogSkin | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQ(text.trim()), 250);
    return () => clearTimeout(timer);
  }, [text]);

  const key = `${q}\n${weapon ?? ''}\n${category}`;
  const skins = loaded?.key === key ? loaded.skins : null;

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams();
    if (q) query.set('q', q);
    if (weapon) query.set('weapon', weapon);
    if (category !== 'all') query.set('category', category);
    api
      .get<{ skins: CatalogSkin[] }>(`/api/skins/catalog?${query}`)
      .then((r) => !cancelled && setLoaded({ key, skins: r.skins ?? [] }))
      .catch((error: unknown) => {
        if (cancelled) return;
        setLoaded({ key, skins: [] });
        showError(error instanceof Error ? error.message : t('skins.catalog.loadFailed'));
      });
    return () => {
      cancelled = true;
    };
  }, [q, weapon, category, key, showError, t]);

  const shown = skins ?? [];
  const current = (skin: CatalogSkin) =>
    picks.find((p) => p.weapon === skin.weapon && p.name === label(skin)) ?? null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <TextField
        type="search"
        size="small"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t('skins.catalog.search')}
        inputProps={{ 'aria-label': t('skins.catalog.search') }}
        sx={{ maxWidth: 420, '& .MuiOutlinedInput-root': { borderRadius: radii.pill } }}
      />
      {skins === null ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress aria-label={t('skins.catalog.search')} />
        </Box>
      ) : shown.length === 0 ? (
        <Typography sx={{ color: color.ink2 }}>{t('skins.catalog.empty')}</Typography>
      ) : (
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 1.75,
          }}
        >
          {shown.map((skin) => (
            <ButtonBase
              key={`${skin.weapon}:${skin.paintKit}`}
              onClick={() => setChosen(skin)}
              aria-label={t('skins.catalog.pickLabel', {
                name: `${skin.weaponName} ${label(skin)}`,
              })}
              data-testid="catalog-tile"
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                textAlign: 'left',
                borderRadius: '16px',
                overflow: 'hidden',
                bgcolor: color.paper2,
                border: `1px solid ${color.rule}`,
                ...(current(skin) && {
                  outline: `2px solid ${color.accent}`,
                  outlineOffset: '3px',
                }),
                '&:hover': { borderColor: color.muted },
                '&:focus-visible': { outline: `2px solid ${color.focus}`, outlineOffset: '3px' },
              }}
            >
              <SkinImage skin={skin} height={96} />
              <Typography
                sx={{
                  fontSize: '0.75rem',
                  color: color.muted,
                  px: 1.5,
                  pt: 1.25,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {skin.weaponName}
              </Typography>
              <Typography
                sx={{
                  fontWeight: 600,
                  fontSize: '0.875rem',
                  px: 1.5,
                  pt: 0.25,
                  pb: 1.5,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {label(skin)}
              </Typography>
              <Box sx={{ mt: 'auto', height: 3, bgcolor: rarityColor[skin.rarity] }} />
            </ButtonBase>
          ))}
        </Box>
      )}
      <PickDialog
        skin={chosen}
        start={chosen ? current(chosen) : null}
        onClose={() => setChosen(null)}
        onPick={async (input) => {
          try {
            await onPick(input);
            setChosen(null);
          } catch (error) {
            showError(error instanceof Error ? error.message : t('skins.equipFailed'));
          }
        }}
      />
    </Box>
  );
}

function PickDialog({
  skin,
  start,
  onClose,
  onPick,
}: {
  skin: CatalogSkin | null;
  start: OwnedSkin | null;
  onClose: () => void;
  onPick: (input: PickInput) => Promise<void>;
}) {
  const { t } = useModuleTranslation('cs2');
  const [float, setFloat] = useState(String(DEFAULT_FLOAT));
  const [pattern, setPattern] = useState(String(DEFAULT_PATTERN));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!skin) return;
    setFloat(String(start?.float ?? DEFAULT_FLOAT));
    setPattern(String(start?.pattern ?? DEFAULT_PATTERN));
    // Reset only when another skin opens, not when the pick refreshes under it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skin]);

  const floatValue = float.trim() === '' ? NaN : Number(float);
  const patternValue = pattern.trim() === '' ? NaN : Number(pattern);
  const floatOk = floatValue >= 0 && floatValue <= 1;
  const patternOk = Number.isInteger(patternValue) && patternValue >= 0 && patternValue <= 1000;

  return (
    <Dialog
      open={skin !== null}
      onClose={onClose}
      fullWidth
      maxWidth="xs"
      PaperProps={{
        sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
      }}
      data-testid="catalog-pick-dialog"
    >
      {skin && (
        <Box sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2.5 }}>
          <Box>
            <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
              {skin.weaponName}
            </Typography>
            <Typography
              component="h2"
              sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}
            >
              {label(skin)}
            </Typography>
          </Box>
          <Box
            sx={{
              borderRadius: '14px',
              overflow: 'hidden',
              borderBottom: 3,
              borderColor: rarityColor[skin.rarity],
            }}
          >
            <SkinImage skin={skin} height={160} />
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>
                {t('skins.float')}
              </Typography>
              <Typography sx={{ fontSize: '0.8125rem', color: color.muted }}>
                {floatOk ? t(`skins.wear.${wearKey(floatValue)}`) : ''}
              </Typography>
            </Box>
            <Slider
              min={0}
              max={1}
              step={0.0001}
              value={floatOk ? floatValue : 0}
              onChange={(_, v) => setFloat(String(Math.round((v as number) * 10000) / 10000))}
              aria-label={t('skins.catalog.wear')}
            />
            <TextField
              size="small"
              type="number"
              value={float}
              onChange={(e) => setFloat(e.target.value)}
              error={!floatOk}
              label={t('skins.float')}
              inputProps={{ min: 0, max: 1, step: 0.0001 }}
            />
          </Box>
          <TextField
            size="small"
            type="number"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            error={!patternOk}
            label={t('skins.pattern')}
            inputProps={{ min: 0, max: 1000, step: 1 }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
            <Button onClick={onClose} sx={{ borderRadius: radii.pill }}>
              {t('skins.catalog.cancel')}
            </Button>
            <Button
              variant="contained"
              disabled={!floatOk || !patternOk || busy}
              onClick={() => {
                setBusy(true);
                void onPick({
                  weapon: skin.weapon,
                  paintKit: skin.paintKit,
                  float: floatValue,
                  pattern: patternValue,
                }).finally(() => setBusy(false));
              }}
              sx={{ borderRadius: radii.pill }}
            >
              {t('skins.catalog.equip')}
            </Button>
          </Box>
        </Box>
      )}
    </Dialog>
  );
}
