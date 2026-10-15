import { settingsService } from '../settingsService';
import { checkPlatformUpdate, type PlatformUpdate } from './updateCheck';

export type PlatformUpdateOptions = NonNullable<Parameters<typeof checkPlatformUpdate>[0]>;

/** The platform update check, with `available` false while the `updateNotices` setting is off. */
export async function platformUpdate(options?: PlatformUpdateOptions): Promise<PlatformUpdate> {
  const [notices, update] = await Promise.all([
    settingsService.areUpdateNoticesEnabled(),
    checkPlatformUpdate(options),
  ]);
  return notices ? update : { ...update, available: false };
}
