/**
 * Files of the fork that break a lint rule upstream added with a list of
 * pre-rule files (eslint.config.mjs). The rule is off for the listed files
 * only; every other file follows it. A change that fixes a file takes it off.
 */
export const FORK_LINT_TODO = {
  '@typescript-eslint/no-non-null-assertion': ['api/src/utils/bodyLimits.ts'],
  '@typescript-eslint/no-unnecessary-condition': [
    'api/src/services/shareCards/images.ts',
    'api/src/utils/sessionCookies.ts',
    'api/src/utils/testEndpoints.ts',
  ],
  '@typescript-eslint/no-unnecessary-type-assertion': [
    'api/src/integrations/cs2/routes/testHelpers.ts',
  ],
  '@typescript-eslint/prefer-nullish-coalescing': [
    'api/src/integrations/cs2/rconEnabled.ts',
    'api/src/integrations/cs2/skins/skinService.ts',
    'api/src/utils/sessionSecret.ts',
    'api/src/utils/testEndpoints.ts',
  ],
  '@typescript-eslint/prefer-optional-chain': ['api/src/integrations/cs2/routes/testHelpers.ts'],
  'no-restricted-syntax': [
    'api/src/integrations/cs2/routes/testHelpers.ts',
    'api/src/integrations/cs2/skins/catalogSearch.ts',
    'api/src/integrations/cs2/skins/skinService.ts',
    'api/src/integrations/cs2/tournamentSettings.ts',
    'api/src/integrations/cs2/veto/simulation.ts',
    'api/src/routes/test.ts',
    'api/src/services/shareCards/images.ts',
    'api/src/services/socketService.ts',
    'api/src/utils/guarded.ts',
    'api/src/utils/sessionCookies.ts',
    'api/src/utils/testEndpoints.ts',
    'api/src/utils/typedConfirm.ts',
  ],
};
