/**
 * The Battle Frontier data layer: Emerald (Gen 3) only. Loader API FROZEN at the
 * end of feature/frontier-data; the screens build on it.
 *
 * LAZY: nothing is fetched until loadFrontierData is called, and nothing here is
 * imported by the app's entry. It fetches public/data/frontier/emerald.json (the
 * rules) beside the Trainer Dex's own Emerald partition (the sets, trainers and
 * Brain teams), both partitions in the service worker's sense (PARTITION_DIRS).
 *
 * GENERATION-SCOPED: the Frontier exists in the app's Gen 3 only. For any other
 * selected generation loadFrontierData resolves to null and fetches nothing;
 * resolveSpecies reads the Gen 3 species list through speciesEntries, the same
 * scoped list the Pokédex renders.
 */

import { dataUrl } from '../../../data/loader'
import { loadTrainers } from '../../../data/trainers'
import { speciesEntries } from '../../dex/entrySources'
import { createFrontierData } from './rules'
import type { FrontierData, FrontierRulesBundle } from './types'

export { speciesKey } from './rules'
export type {
  BpAward,
  BpAwardArgs,
  BpShopEntry,
  BrainAppearance,
  BrainSymbol,
  BrainTeamKind,
  FacilityId,
  FrontierBrain,
  FrontierData,
  FrontierFacility,
  FrontierFormat,
  FrontierSet,
  FrontierTrainer,
  IdRange,
  IvBand,
  LevelMode,
  LevelRule,
  NextBrainArgs,
  PoolDraw,
  ShopClerk,
  StreakUnit,
  TrainerPool,
  TrainerPoolArgs,
} from './types'

export const FRONTIER_GENERATION = 3
export const FRONTIER_VERSION_GROUP = 'emerald'
const RULES_PATH = 'frontier/emerald.json'

export const isFrontierGeneration = (generation: number | null | undefined): boolean =>
  generation === FRONTIER_GENERATION

let cached: FrontierData | null = null
let inflight: Promise<FrontierData> | null = null

/**
 * The Frontier data for the app's selected generation: null unless it is 3.
 * Loaded once and held in memory; a failure is not cached.
 */
export function loadFrontierData(generation: number | null | undefined): Promise<FrontierData | null> {
  if (!isFrontierGeneration(generation)) return Promise.resolve(null)
  if (cached) return Promise.resolve(cached)
  if (!inflight) {
    const pending = (async () => {
      const url = dataUrl(RULES_PATH)
      const [res, partition] = await Promise.all([fetch(url), loadTrainers(FRONTIER_VERSION_GROUP)])
      if (!res.ok) throw new Error(`failed to load ${url}: HTTP ${res.status}`)
      const rules = (await res.json()) as FrontierRulesBundle
      cached = createFrontierData(rules, partition, () =>
        speciesEntries({ generation: FRONTIER_GENERATION, isAll: false }),
      )
      return cached
    })()
    inflight = pending
    void pending
      .finally(() => {
        if (inflight === pending) inflight = null
      })
      .catch(() => {})
  }
  return inflight
}

/** The data if it is already in memory (null otherwise, or outside Gen 3). */
export const peekFrontierData = (generation: number | null | undefined): FrontierData | null =>
  isFrontierGeneration(generation) ? cached : null

/** Test seam. */
export function __resetFrontierCache(): void {
  cached = null
  inflight = null
}
