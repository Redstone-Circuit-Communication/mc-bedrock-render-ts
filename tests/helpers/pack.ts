import { existsSync, readFileSync } from 'fs';
import { ResourcePack, ResourceStack } from '../../src/renderer/resources';

/** The vanilla resource folder of the game, zipped (files may be `.brarchive`). Set BEDROCK_PACK to its path. */
export const PACK_PATH = process.env.BEDROCK_PACK ?? '/mnt/user-data/uploads/animation_controllers.zip';
export const hasPack = existsSync(PACK_PATH);
export async function loadBasePack(): Promise<ResourceStack> {
  return new ResourceStack([await ResourcePack.fromBytes(new Uint8Array(readFileSync(PACK_PATH)))]);
}
