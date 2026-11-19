import { existsSync, readFileSync } from 'fs';
import { ResourcePack, ResourceStack } from '../../src/renderer/resources';

/** The game's own resource folder, zipped (files may be `.brarchive`). Tests that need it run only when BEDROCK_PACK is set. */
export const PACK_PATH = process.env.BEDROCK_PACK ?? '';
export const hasPack = !!PACK_PATH && existsSync(PACK_PATH);
export async function loadBasePack(): Promise<ResourceStack> {
  return new ResourceStack([await ResourcePack.fromBytes(new Uint8Array(readFileSync(PACK_PATH)))]);
}
