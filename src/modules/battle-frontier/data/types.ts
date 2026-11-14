/**
 * Battle Frontier data layer (Emerald, Gen 3): the rules bundle's shape and the
 * loader API's types.
 *
 * FROZEN at the end of feature/frontier-data: the screens build on these names.
 * Add fields; do not rename or remove one.
 *
 * Two files feed it: public/data/trainers/emerald.json (the Trainer Dex bundle:
 * the 882 sets, 300 trainers and Brain teams) and public/data/frontier/emerald.json
 * (the rules, scripts/frontier/build.mjs). Both come from pret/pokeemerald at the
 * pin in scripts/trainers/sources.mjs.
 */

import type { FacilityPokemon, FacilitySet } from '../../../data/trainers'

export type FacilityId = 'tower' | 'dome' | 'palace' | 'arena' | 'factory' | 'pike' | 'pyramid'
export type FrontierFormat = 'singles' | 'doubles' | 'multi' | 'link-multi'
export type LevelMode = 'lv50' | 'open'
/**
 * What one step of a facility's win streak counts, as the game stores it:
 * battles (Tower, Palace, Arena, Factory), tournaments won (Dome), rooms
 * cleared (Pike), floors cleared (Pyramid).
 */
export type StreakUnit = 'battle' | 'tournament' | 'room' | 'floor'
export type BrainSymbol = 'silver' | 'gold'
/** 'generated': drawn at random each time (Noland); 'fixed': sFrontierBrainsMons. */
export type BrainTeamKind = 'generated' | 'fixed' | 'unconfirmed'
export type ShopClerk = 'decor-1' | 'decor-2' | 'vitamins' | 'hold-items'

// ------------------------------------------------ the rules bundle, as written

export interface RawIvBand {
  from: number
  to: number
  iv: number
}

export interface RawFacility {
  id: FacilityId
  /** FRONTIER_FACILITY_* */
  index: number
  name: string
  formats: { id: FrontierFormat; party_size: number; battle_party_size?: number }[]
  unit: StreakUnit
  /** Battles (Dome rounds, Pike rooms, Pyramid floors) in one challenge. */
  per_set: number
  /** Streak units in one completed set (1 for the Dome: its streak counts tournaments). */
  streak_per_set: number
  rules: string
  brain: {
    name: string
    title: string
    symbol_name: string
    team_kind: 'generated' | 'fixed'
    /** sFrontierBrainStreakAppearances: {silver, gold, repeat, offset}. */
    streak: { silver: number; gold: number; repeat: number; offset: number }
    /** IV for all six stats at the first Silver and Gold appearance. */
    iv: { silver: number; gold: number }
    iv_rule?: 'factory-table'
    iv_challenge_offset?: number
  }
}

export interface RawShopEntry {
  clerk: ShopClerk
  item_id: number | null
  /** DECOR_* for a decoration (no item id). */
  decor: string | null
  name: string
  price: number
}

export interface FrontierRulesBundle {
  version_group: 'emerald'
  generation: 3
  source: string
  levels: { lv50: number; open_min: number; open_max: number }
  open_only_from_index: number
  stages_per_challenge: number
  trainer_count: number
  trainer_id_ranges: { normal: [number, number][]; hard: [number, number][] }
  trainer_ivs: RawIvBand[]
  factory: {
    /** sFixedIVTable[challenge] = [battles 1-6, battle 7]. */
    iv_table: [number, number][]
    /** Challenge 8 reads past the table (documented off-by-one); derived from the ROM layout. */
    iv_out_of_bounds: {
      challenge: number
      normal: number | 'random'
      last_battle: number | 'random'
      derived: true
    }
    /** sInitialRentalMonRanges: the set indices a Factory opponent draws from, by challenge. */
    rental_ranges: { lv50: [number, number][]; open: [number, number][] }
  }
  facilities: RawFacility[]
  bp: {
    /** awards[facility][format][row]: row = completed sets in the streak - 1, clamped. */
    awards: Record<FacilityId, Partial<Record<FrontierFormat, number[]>>>
    brain_bonus: number
    cap: number
  }
  shop: RawShopEntry[]
  /** gBattleFrontierHeldItems: index = a set's itemTableId; slot 0 is "none". */
  held_items: (number | null)[]
  banned_species: number[]
  counts: Record<string, number>
  checks: Record<string, unknown>
}

// ------------------------------------------------------------- the API

export interface IdRange {
  from: number
  to: number
}

export interface FrontierFacility {
  id: FacilityId
  name: string
  /** Formats in FRONTIER_MODE order; party size = Pokémon the player enters. */
  formats: { id: FrontierFormat; partySize: number; battlePartySize?: number }[]
  unit: StreakUnit
  perSet: number
  rules: string
}

/** Where a Brain appears, counted the way the owner's log counts. */
export interface BrainAppearance {
  symbol: BrainSymbol
  /**
   * The Brain's position in the facility's log: battle number (Tower, Palace,
   * Arena, Factory, and the Dome's battles at 4 per tournament), room number
   * (Pike), floor number (Pyramid: the Brain waits at the top after it).
   */
  battle: number
  /** The facility's streak unit. */
  unit: StreakUnit
  /** Which unit: tournament 5 (Dome), room 28 (Pike), battle 35 (Tower)... */
  unitNumber: number
  /** A Gold rematch past the first Gold appearance. */
  repeat: boolean
}

export interface FrontierBrain {
  facility: FacilityId
  name: string
  title: string
  symbolName: string
  teamKind: BrainTeamKind
  /** sFrontierBrainStreakAppearances, as the game stores it. */
  streak: { silver: number; gold: number; repeat: number; offset: number }
  silver: BrainAppearance
  gold: BrainAppearance
  ivs: { silver: number; gold: number }
  /** The fixed teams (Trainer Dex bundle); null when the team is generated. */
  teams: { silver: FacilityPokemon[]; gold: FacilityPokemon[] } | null
  note?: string
}

export interface FrontierSet extends FacilitySet {
  /** The decomp set index, FRONTIER_MON_* (0-881). */
  index: number
  /** Index above FRONTIER_MONS_HIGH_TIER: never drawn at Level 50. */
  openOnly: boolean
}

export interface FrontierTrainer {
  /** The decomp trainer id, FRONTIER_TRAINER_* (0-299). */
  id: number
  key: string
  classId: string | null
  className: string | null
  name: string | null
  /** The sets it draws from, as FrontierSet indices. */
  setIndices: number[]
}

export interface IvBand {
  min: number
  max: number
  /** 'trainer-id': GetFrontierTrainerFixedIvs; 'factory-table': sFixedIVTable. */
  rule: 'trainer-id' | 'factory-table'
  /** The IV of each trainer-id slice inside the pool's range. */
  byTrainerId?: RawIvBand[]
  /**
   * Factory: the game reads the IV row at the BATTLE TOWER Lv50 streak (a
   * documented mistake). Exact only when `towerLv50Streak` is passed; otherwise
   * the band spans the whole table.
   */
  readsTowerStreak?: true
  /** Can be random IVs (the table's out-of-bounds row). */
  random?: true
}

export type LevelRule =
  | { mode: 'lv50'; level: number }
  /** The player's highest party level, at least `min`. */
  | { mode: 'open'; min: number; max: number; rule: 'highest-in-party' }

export interface PoolDraw {
  idRange: IdRange
  hard: boolean
  /** How many trainers come from this range (the Dome bracket). */
  count?: number
  when: string
}

export interface TrainerPool {
  facility: FacilityId
  levelMode: LevelMode
  streak: number
  /** The challenge index the game passes to GetRandomScaledFrontierTrainerId. */
  challenge: number
  /** Every trainer id the next opponent can have (the union of `draws`). */
  idRange: IdRange
  /** True when the opponent comes from the Hard 7th-battle ladder. */
  hard: boolean
  ivBand: IvBand
  level: LevelRule
  /** One entry, or several where the facility draws from more than one range. */
  draws: PoolDraw[]
  /** Factory: the set indices opponents draw from (the trainer's own list is unused). */
  factorySetRange?: IdRange
  note?: string
}

export interface TrainerPoolArgs {
  facility: FacilityId
  levelMode: LevelMode
  /** Wins so far in the facility's own unit (see StreakUnit). */
  streak: number
  format?: FrontierFormat
  /** Factory only: the Battle Tower Lv50 streak in the same format (see IvBand). */
  towerLv50Streak?: number
}

export interface NextBrainArgs {
  facility: FacilityId
  format: FrontierFormat
  levelMode: LevelMode
  /** Wins so far in the facility's own unit (see StreakUnit). */
  streak: number
  /** Symbols already earned at this facility: 0, 1 (Silver) or 2 (Gold). */
  symbols: 0 | 1 | 2
}

export interface BpAwardArgs {
  facility: FacilityId
  format: FrontierFormat
  /** Sets completed in the current streak, counting the one just won (1-based). */
  completedSets: number
  /** The set ended with a Frontier Brain win. */
  brain?: boolean
}

export interface BpAward {
  base: number
  brainBonus: number
  points: number
}

export interface BpShopEntry {
  clerk: ShopClerk
  itemId: number | null
  decor: string | null
  name: string
  price: number
}

/** What loadFrontierData resolves to. Every method is synchronous. */
export interface FrontierData {
  facilities(): FrontierFacility[]
  brains(): FrontierBrain[]
  sets(): FrontierSet[]
  trainers(): FrontierTrainer[]
  /** A trainer's sets that can be drawn at this level mode. */
  trainerSets(trainerId: number, levelMode: LevelMode): FrontierSet[]
  trainerPoolForStreak(args: TrainerPoolArgs): TrainerPool
  /** The next Brain battle from this streak on (the upcoming one included); null if none can come. */
  nextBrainAt(args: NextBrainArgs): BrainAppearance | null
  /** null when the facility has no such format. */
  bpAward(args: BpAwardArgs): BpAward | null
  /** The balance after adding points, capped at 9999. */
  addBattlePoints(balance: number, points: number): number
  bpShop(): BpShopEntry[]
  /** Species ids. */
  bannedSpecies(): number[]
  /** A Pokédex species id within Gen 3, or null. */
  resolveSpecies(name: string): number | null
}
