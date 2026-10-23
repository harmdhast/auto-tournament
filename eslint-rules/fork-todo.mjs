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
  '@typescript-eslint/prefer-nullish-coalescing': [
    'api/src/utils/sessionSecret.ts',
    'api/src/utils/testEndpoints.ts',
  ],
  'no-restricted-syntax': [
    'api/src/routes/test.ts',
    'api/src/services/shareCards/images.ts',
    'api/src/services/socketService.ts',
    'api/src/utils/guarded.ts',
    'api/src/utils/sessionCookies.ts',
    'api/src/utils/testEndpoints.ts',
    'api/src/utils/typedConfirm.ts',
  ],
};
