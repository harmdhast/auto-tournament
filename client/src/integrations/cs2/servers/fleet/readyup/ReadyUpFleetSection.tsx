/**
 * The Ready Up fleet on the Servers page: the servers that connect with Ready Up,
 * the keys and codes they enroll with, what is pushed to them, automatic scaling
 * and failover, one tab each. A link to a tab's anchor (`#fleet`, `#fleet-keys`,
 * `#fleet-settings`, `#autoscale`, `#failover`) or openServerSection() selects it.
 */
import { useEffect, useState } from 'react';
import { Box, Tab, Tabs, Typography } from '@mui/material';
import { useModuleTranslation } from '../../../../../module-sdk';
import AutoScalePanel from '../../AutoScalePanel';
import FleetPanel from '../../FleetPanel';
import FleetPushPanel from '../../FleetPushPanel';
import FailoverSettingsPanel from '../../FailoverSettingsPanel';
import { EmbeddedServerSections } from '../../ServerSection';
import { OPEN_EVENT } from '../../openServerSection';

export type ReadyUpTab = 'servers' | 'keys' | 'push' | 'autoscale' | 'failover';

const TABS: ReadyUpTab[] = ['servers', 'keys', 'push', 'autoscale', 'failover'];

/** The anchors other pages and buttons link to, and the tab each one shows. */
const ANCHOR_TAB: Record<string, ReadyUpTab> = {
  fleet: 'servers',
  'fleet-keys': 'keys',
  'fleet-settings': 'push',
  autoscale: 'autoscale',
  failover: 'failover',
};

function tabFromHash(): ReadyUpTab | null {
  return ANCHOR_TAB[window.location.hash.slice(1)] ?? null;
}

export function ReadyUpFleetSection() {
  const { t } = useModuleTranslation('cs2');
  const [tab, setTab] = useState<ReadyUpTab>(() => tabFromHash() ?? 'servers');

  useEffect(() => {
    const onHash = () => {
      const next = tabFromHash();
      if (next) setTab(next);
    };
    const onOpen = (e: Event) => {
      const next = ANCHOR_TAB[(e as CustomEvent<string>).detail];
      if (next) setTab(next);
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener(OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener(OPEN_EVENT, onOpen);
    };
  }, []);

  return (
    <Box
      component="section"
      mt={3}
      data-testid="readyup-fleet"
      aria-labelledby="readyup-fleet-title"
      sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}
    >
      <Typography
        id="readyup-fleet-title"
        component="h2"
        variant="h6"
        sx={{ fontWeight: 600, lineHeight: 1.3 }}
      >
        {t('serversBoard.readyUp.title')}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {t('serversBoard.readyUp.about')}
      </Typography>
      <Tabs
        value={tab}
        onChange={(_e, value: ReadyUpTab) => setTab(value)}
        variant="scrollable"
        allowScrollButtonsMobile
        sx={{ mt: 1, mb: 2, borderBottom: 1, borderColor: 'divider' }}
      >
        {TABS.map((id) => (
          <Tab
            key={id}
            value={id}
            label={t(`serversBoard.readyUp.tabs.${id}`)}
            data-testid={`readyup-tab-${id}`}
          />
        ))}
      </Tabs>
      <EmbeddedServerSections value>
        {tab === 'servers' && <FleetPanel part="servers" />}
        {tab === 'keys' && <FleetPanel part="keys" />}
        {tab === 'push' && <FleetPushPanel />}
        {tab === 'autoscale' && <AutoScalePanel />}
        {tab === 'failover' && <FailoverSettingsPanel />}
      </EmbeddedServerSections>
    </Box>
  );
}
