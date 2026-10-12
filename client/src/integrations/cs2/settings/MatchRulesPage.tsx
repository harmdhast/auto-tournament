/**
 * Match rules (CS2's rail item, board 7): the defaults sent to Ready Up
 * servers with every match (`Cs2ServerDefaults`). They are fields of
 * `GET`/`PUT /api/settings`, every one optional, so the component saves only
 * what changed. Map sync lives on the Maps page.
 */

import React, { useEffect, useState } from 'react';
import { Box, LinearProgress } from '@mui/material';
import { api, useModuleTranslation, useSnackbar, PageHead, pageTitle } from '../../../module-sdk';
import { Cs2ServerDefaults } from './Cs2ServerDefaults';

interface SettingsResponse {
  success: boolean;
  settings?: Record<string, unknown>;
}

export const MatchRulesPage: React.FC = () => {
  const { t } = useModuleTranslation('cs2');
  const { showError } = useSnackbar();
  const [loading, setLoading] = useState(true);
  const [initialSettings, setInitialSettings] = useState<Record<string, unknown> | undefined>();

  useEffect(() => {
    document.title = pageTitle(t('matchRules.title'));
  }, [t]);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const response = await api.get<SettingsResponse>('/api/settings');
        if (active) setInitialSettings(response.settings);
      } catch (err) {
        if (active) showError(err instanceof Error ? err.message : t('settings.loadFailed'));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [showError, t]);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }} data-testid="cs2-settings">
      <PageHead title={t('matchRules.title')} subtitle={t('matchRules.subtitle')} sx={{ mb: 0 }} />
      {loading ? <LinearProgress /> : <Cs2ServerDefaults initial={initialSettings} />}
    </Box>
  );
};
