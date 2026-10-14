import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useLocation, useParams } from 'react-router-dom';
import { skinPaths } from './paths';
import {
  Box,
  Button,
  ButtonBase,
  CircularProgress,
  Container,
  Dialog,
  IconButton,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { PlayCircleIcon, QuestionIcon, TrophyIcon, XIcon } from '@phosphor-icons/react';
import {
  api,
  pageTitle,
  useModuleTranslation,
  useSnackbar,
  tokens,
  fontDisplay,
  radii,
  withAlpha,
} from '../../../module-sdk';
import { InspectSkinDialog, SkinCard, SlotTile, VirtualNotice } from './SkinParts';
import { CatalogPicker } from './CatalogPicker';
import { SidePicker } from './SidePicker';
import {
  loadoutSlots,
  useCatalogWeapons,
  useMySkins,
  useSkinsStatus,
  type OwnedSkin,
  type Rarity,
} from './useSkins';
import { equippedFor } from './loadoutSides';
import { canPick, togglePick } from './tradeUp';
import { TradeUpPanel } from './TradeUpPanel';
import { TryoutLink } from './TryoutLink';

const { color } = tokens;
const RARITY_ORDER: Rarity[] = [
  'immortal',
  'ancient',
  'legendary',
  'mythical',
  'rare',
  'uncommon',
  'common',
];

type Filter = 'all' | 'rifles' | 'pistols' | 'smgs' | 'heavy' | 'knives' | 'gloves';
const PISTOLS = [
  'glock',
  'hkp2000',
  'usp_silencer',
  'p250',
  'fiveseven',
  'tec9',
  'cz75a',
  'deagle',
  'revolver',
  'taser',
  'elite',
];
const SMGS = ['mac10', 'mp9', 'mp7', 'mp5sd', 'ump45', 'p90', 'bizon'];
const HEAVY = ['nova', 'xm1014', 'sawedoff', 'mag7', 'm249', 'negev'];

function category(skin: Pick<OwnedSkin, 'slot' | 'weapon'>): Filter {
  if (skin.slot === 'knife') return 'knives';
  if (skin.slot === 'gloves') return 'gloves';
  const w = skin.weapon.replace('weapon_', '');
  if (PISTOLS.includes(w)) return 'pistols';
  if (SMGS.includes(w)) return 'smgs';
  if (HEAVY.includes(w)) return 'heavy';
  return 'rifles';
}

/**
 * The inventory (board 1): the equipped loadout as a row of slots, every skin
 * as a picture card, one click to equip (saved at once). On someone else's
 * page (`/player/:steamId/inventory`) the same view, read only.
 */
export function InventoryPage() {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const equipFailed = (error: unknown) =>
    showError(error instanceof Error ? error.message : t('skins.equipFailed'));
  const { steamId } = useParams<{ steamId?: string }>();
  // /inventory is your own; /player/:steamId/inventory is anyone's, read only.
  const own = !steamId;
  const status = useSkinsStatus();
  const enabled = status ? status.enabled : null;
  const catalogUnlocked = own && Boolean(status?.catalogUnlocked);
  const mine = useMySkins();
  const [theirs, setTheirs] = useState<{ inventory: OwnedSkin[]; picks: OwnedSkin[] } | null>(null);
  // Own page with the catalogue unlocked: earned skins, or every catalogue skin (one slot when chosen).
  const [view, setView] = useState<'owned' | 'catalog'>('owned');
  const [slotFilter, setSlotFilter] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<'rarity' | 'newest'>('rarity');
  // `#skin-<id>` (a new-skin notification, a shared link) opens that skin.
  const { hash } = useLocation();
  const [inspect, setInspect] = useState<number | null>(() => skinFromHash(hash));
  const [seenHash, setSeenHash] = useState(hash);
  if (hash !== seenHash) {
    setSeenHash(hash);
    const id = skinFromHash(hash);
    if (id !== null) setInspect(id);
  }
  const [helpOpen, setHelpOpen] = useState(false);
  // The skin being dragged onto a loadout slot, and the one whose sides are being picked.
  const [dragging, setDragging] = useState<OwnedSkin | null>(null);
  const [picking, setPicking] = useState<OwnedSkin | null>(null);
  // Trade-ups (when the site has them): picking skins of one grade for one of the next.
  const [tradeUpCount, setTradeUpCount] = useState<number | null>(null);
  const [trading, setTrading] = useState(false);
  const [picked, setPicked] = useState<OwnedSkin[]>([]);

  useEffect(() => {
    if (!own) return;
    let cancelled = false;
    api
      .get<{ tradeUp: { count: number } | null }>('/api/skins/status')
      .then((r) => !cancelled && setTradeUpCount(r.tradeUp?.count ?? null))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [own]);

  useEffect(() => {
    document.title = pageTitle(t('skins.inventory'));
  }, [t]);

  useEffect(() => {
    if (own || !steamId) return;
    let cancelled = false;
    api
      .get<{ inventory: OwnedSkin[]; picks?: OwnedSkin[] }>(`/api/skins/players/${steamId}`)
      .then((r) => !cancelled && setTheirs({ inventory: r.inventory ?? [], picks: r.picks ?? [] }))
      .catch(() => !cancelled && setTheirs({ inventory: [], picks: [] }));
    return () => {
      cancelled = true;
    };
  }, [own, steamId]);

  const inventory = useMemo(
    () => (own ? mine.inventory : (theirs?.inventory ?? [])),
    [own, mine.inventory, theirs]
  );
  const picks = useMemo(
    () => (own ? mine.picks : (theirs?.picks ?? [])),
    [own, mine.picks, theirs]
  );
  // What each side has on: earned skins and catalogue picks together.
  const loadout = useMemo(() => [...inventory, ...picks], [inventory, picks]);
  const inCatalog = catalogUnlocked && view === 'catalog';
  const catalogWeapons = useCatalogWeapons(catalogUnlocked);
  const loading = enabled === null || (own ? mine.loading : theirs === null);
  const shown = useMemo(() => {
    const list = inventory.filter((s) => filter === 'all' || category(s) === filter);
    return [...list].sort((a, b) =>
      sort === 'newest'
        ? b.createdAt - a.createdAt
        : RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity)
    );
  }, [inventory, filter, sort]);
  const slots = loadoutSlots(inventory, picks, catalogWeapons);

  const chip = (key: Filter) => (
    <ButtonBase
      key={key}
      onClick={() => {
        setFilter(key);
        setSlotFilter(null);
      }}
      aria-pressed={filter === key}
      sx={{
        px: 1.75,
        py: 1,
        borderRadius: radii.pill,
        fontSize: '0.875rem',
        border: `1px solid ${filter === key ? color.ink : color.rule}`,
        bgcolor: filter === key ? color.ink : 'transparent',
        color: filter === key ? color.accentInk : color.ink2,
        fontWeight: filter === key ? 600 : 400,
      }}
    >
      {t(`skins.filter.${key}`)}
    </ButtonBase>
  );

  return (
    <Box data-testid="inventory-page">
      <Container
        maxWidth="lg"
        sx={{ py: { xs: 4, md: 6 }, display: 'flex', flexDirection: 'column', gap: 3.5 }}
      >
        {enabled === false ? (
          <Typography sx={{ color: color.ink2 }}>{t('skins.off')}</Typography>
        ) : loading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 8 }}>
            <CircularProgress aria-label={t('skins.inventory')} />
          </Box>
        ) : (
          <>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 2,
              }}
            >
              <Box>
                <Typography
                  component="h1"
                  sx={{
                    fontFamily: fontDisplay,
                    fontSize: '2.5rem',
                    fontWeight: 700,
                    letterSpacing: '-0.02em',
                  }}
                >
                  {t('skins.inventory')}
                </Typography>
                <Typography sx={{ color: color.ink2 }}>
                  {t('skins.count', { count: inventory.length })} ·{' '}
                  <Box
                    component={RouterLink}
                    to={skinPaths.dropRates}
                    data-testid="inventory-drop-rates"
                    sx={{
                      color: color.accent,
                      textDecoration: 'none',
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {t('skins.drops.link')}
                  </Box>
                </Typography>
              </Box>
              <VirtualNotice />
            </Box>

            {own && <TryoutLink />}

            <Box
              component="section"
              aria-labelledby="loadout-title"
              sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
            >
              <Typography
                id="loadout-title"
                component="h2"
                sx={{ fontFamily: fontDisplay, fontSize: '1.25rem', fontWeight: 600 }}
              >
                {t('skins.equippedTitle')}
              </Typography>
              {([3, 2] as const).map((team) => {
                const on = equippedFor(loadout, team);
                // This side's slots: knife, gloves, the weapons it buys that have a skin, and
                // every weapon it buys while the catalogue is unlocked.
                const sideSlots = slots.filter(
                  (slot) =>
                    loadout.some((s) => s.slot === slot && (s.side === null || s.side === team)) ||
                    catalogWeapons.some(
                      (w) => w.slot === slot && (w.side === null || w.side === team)
                    ) ||
                    slot === 'knife' ||
                    slot === 'gloves'
                );
                return (
                  <Box
                    key={team}
                    sx={{ display: 'grid', gap: 1 }}
                    data-testid={`loadout-side-${team === 3 ? 'ct' : 't'}`}
                  >
                    <Typography
                      sx={{
                        fontSize: '0.8125rem',
                        fontWeight: 600,
                        color: team === 3 ? color.sideCt : color.sideT,
                      }}
                    >
                      {team === 3 ? t('skins.side.ct') : t('skins.side.t')}
                    </Typography>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(118px, 1fr))',
                        gap: 1.25,
                      }}
                    >
                      {sideSlots.map((slot) => {
                        const skin = on.get(slot) ?? null;
                        const label =
                          slot === 'knife'
                            ? t('skins.slot.knife')
                            : slot === 'gloves'
                              ? t('skins.slot.gloves')
                              : ([...loadout, ...catalogWeapons].find((s) => s.slot === slot)
                                  ?.weaponName ?? slot);
                        // An equipped slot opens its skin; an empty one shows the skins that fit it.
                        const tile = (
                          <SlotTile
                            key={slot}
                            label={label}
                            skin={skin}
                            onDrop={
                              own &&
                              dragging &&
                              dragging.slot === slot &&
                              (dragging.side === null || dragging.side === team)
                                ? () => {
                                    const dropped = dragging;
                                    setDragging(null);
                                    void mine.equipOn(dropped, team).catch(equipFailed);
                                  }
                                : undefined
                            }
                            onClick={() => {
                              if (skin) {
                                setInspect(skin.id);
                                return;
                              }
                              if (catalogUnlocked) {
                                setView('catalog');
                                setFilter('all');
                                setSlotFilter(slot);
                                return;
                              }
                              const owned = inventory.find((s) => s.slot === slot);
                              setFilter(
                                owned
                                  ? category(owned)
                                  : slot === 'knife'
                                    ? 'knives'
                                    : slot === 'gloves'
                                      ? 'gloves'
                                      : 'all'
                              );
                            }}
                          />
                        );
                        // A pick comes off its side with the cross; it goes when no side has it.
                        return own && skin?.source === 'catalog' ? (
                          <Box key={slot} sx={{ position: 'relative' }}>
                            {tile}
                            <IconButton
                              size="small"
                              aria-label={t('skins.takeOffLabel', { name: skin.name })}
                              data-testid="pick-take-off"
                              onClick={() => void mine.unequipPick(skin, team).catch(equipFailed)}
                              sx={{
                                position: 'absolute',
                                top: 4,
                                right: 4,
                                width: 24,
                                height: 24,
                                bgcolor: withAlpha(color.paper2, 0.85),
                                border: `1px solid ${color.rule}`,
                                '&:hover': { bgcolor: color.paper3 },
                              }}
                            >
                              <XIcon size={12} />
                            </IconButton>
                          </Box>
                        ) : (
                          tile
                        );
                      })}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {catalogUnlocked && (
              <ToggleButtonGroup
                exclusive
                size="small"
                value={view}
                onChange={(_, next: 'owned' | 'catalog' | null) => {
                  if (!next) return;
                  setView(next);
                  setSlotFilter(null);
                }}
                aria-label={t('skins.view.label')}
                data-testid="inventory-view"
                sx={{ alignSelf: 'flex-start' }}
              >
                <ToggleButton value="owned" sx={{ px: 2, borderRadius: radii.pill }}>
                  {t('skins.view.owned')}
                </ToggleButton>
                <ToggleButton value="catalog" sx={{ px: 2, borderRadius: radii.pill }}>
                  {t('skins.view.catalog')}
                </ToggleButton>
              </ToggleButtonGroup>
            )}

            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 2,
              }}
            >
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {(
                  ['all', 'rifles', 'pistols', 'smgs', 'heavy', 'knives', 'gloves'] as Filter[]
                ).map(chip)}
              </Box>
              {own && tradeUpCount !== null && !trading && !inCatalog && (
                <Button
                  variant="outlined"
                  onClick={() => {
                    setPicked([]);
                    setTrading(true);
                  }}
                  data-testid="trade-up-start"
                  sx={{ borderRadius: radii.pill }}
                >
                  {t('skins.tradeUp.start')}
                </Button>
              )}
              {!inCatalog && (
                <Select
                  size="small"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as 'rarity' | 'newest')}
                  sx={{ borderRadius: radii.pill, minWidth: 180 }}
                  inputProps={{ 'aria-label': t('skins.sortLabel') }}
                >
                  <MenuItem value="rarity">{t('skins.sort.rarity')}</MenuItem>
                  <MenuItem value="newest">{t('skins.sort.newest')}</MenuItem>
                </Select>
              )}
            </Box>

            {trading && tradeUpCount !== null && (
              <TradeUpPanel
                count={tradeUpCount}
                picked={picked}
                onCancel={() => {
                  setTrading(false);
                  setPicked([]);
                }}
                onDone={(skinId) => {
                  setTrading(false);
                  setPicked([]);
                  void mine.reload();
                  setInspect(skinId);
                }}
              />
            )}

            {inCatalog ? (
              <CatalogPicker slot={slotFilter} category={filter} picks={picks} onPick={mine.pick} />
            ) : shown.length === 0 ? (
              <Typography sx={{ color: color.ink2 }}>
                {inventory.length
                  ? t('skins.noneInFilter')
                  : own
                    ? t('skins.emptyOwn')
                    : t('skins.emptyTheirs')}
              </Typography>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 1.75,
                }}
              >
                {shown.map((skin) => (
                  <SkinCard
                    key={skin.id}
                    skin={skin}
                    showNew={own}
                    onEquip={
                      own
                        ? (s) =>
                            // A skin both sides can use asks which side; a one-side weapon toggles.
                            s.side === null
                              ? setPicking(s)
                              : void mine.equip(s, 0).catch(equipFailed)
                        : undefined
                    }
                    onDragSkin={own ? setDragging : undefined}
                    onInspect={(s) => setInspect(s.id)}
                    pick={
                      trading && tradeUpCount !== null
                        ? {
                            picked: picked.some((p) => p.id === skin.id),
                            disabled: !canPick(skin, picked, tradeUpCount),
                            onToggle: (s) => setPicked((list) => togglePick(s, list, tradeUpCount)),
                          }
                        : undefined
                    }
                  />
                ))}
              </Box>
            )}

            <ButtonBase
              onClick={() => setHelpOpen(true)}
              sx={{
                alignSelf: 'flex-start',
                display: 'inline-flex',
                gap: 1.25,
                fontSize: '0.875rem',
                color: color.ink2,
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: '50%',
                  border: `1px solid ${color.rule}`,
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <QuestionIcon size={14} />
              </Box>
              {t('skins.howToGet')}
            </ButtonBase>
          </>
        )}
      </Container>

      <InspectSkinDialog skinId={inspect} onClose={() => setInspect(null)} />
      {picking && (
        <SidePicker
          skin={inventory.find((x) => x.id === picking.id) ?? picking}
          onClose={() => setPicking(null)}
          onPick={(team) => {
            const skin = picking;
            setPicking(null);
            void mine.equipOn(skin, team).catch(equipFailed);
          }}
          onTakeOff={() => {
            const skin = inventory.find((x) => x.id === picking.id) ?? picking;
            setPicking(null);
            void (async () => {
              let current = skin;
              for (const team of [...skin.equippedSides]) {
                await mine.equip(current, team);
                current = {
                  ...current,
                  equippedSides: current.equippedSides.filter((x) => x !== team),
                };
              }
            })().catch(equipFailed);
          }}
        />
      )}
      <Dialog
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        PaperProps={{
          sx: { borderRadius: radii.lg, bgcolor: color.paper2, backgroundImage: 'none' },
        }}
      >
        <Box sx={{ p: 3.5, display: 'flex', flexDirection: 'column', gap: 2, maxWidth: 440 }}>
          <Typography
            component="h2"
            sx={{ fontFamily: fontDisplay, fontSize: '1.375rem', fontWeight: 600 }}
          >
            {t('skins.howToGet')}
          </Typography>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <PlayCircleIcon size={22} color={color.accent} aria-hidden />
            <Typography>{t('skins.howMatchmaking')}</Typography>
          </Box>
          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <TrophyIcon size={22} color={color.medalGold} aria-hidden />
            <Typography>{t('skins.howTournament')}</Typography>
          </Box>
          <VirtualNotice compact />
        </Box>
      </Dialog>
    </Box>
  );
}

/** The skin id in `#skin-<id>`, or null. */
function skinFromHash(hash: string): number | null {
  const id = /^#skin-(\d+)$/.exec(hash)?.[1];
  return id ? Number(id) : null;
}
