import { PlatformConfig } from '@/interfaces/IPlatformConfig';

import { Platform_192_com } from './192-com';
import { Platform_yell_com } from './yell-com';
import { Platform_11880_de } from './11880-de';
import { Platform_gelbeseiten_de } from './gelbeseiten-de';
import { Platform_paginegialle_it } from './paginegialle-it';
import { Platform_pagesjaunes_fr } from './pagesjaunes-fr';
import { Platform_yelp_com } from './yelp-com';
import { Platform_yellowpages_com } from './yellowpages-com';

export const platforms: PlatformConfig[] = [
  Platform_192_com,
  Platform_yell_com,
  Platform_11880_de,
  Platform_gelbeseiten_de,
  Platform_paginegialle_it,
  Platform_pagesjaunes_fr,
  Platform_yelp_com,
  Platform_yellowpages_com,
];

export const platformsById: Record<string, PlatformConfig> = Object.fromEntries(
  platforms.map((p) => [p.id, p])
);

export function getAllPlatforms(): PlatformConfig[] {
  return platforms;
}

export function getPlatformById(id: string): PlatformConfig | undefined {
  return platformsById[id];
}



