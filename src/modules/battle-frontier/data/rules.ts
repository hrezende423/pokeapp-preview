/**
 * The Emerald Battle Frontier rules as functions over the two bundles. Pure: no
 * fetch and no module state, so a suite can run it in Node. Each rule names the
 * pokeemerald routine it transcribes; the tables themselves are parsed from the
 * disassembly by scripts/frontier/build.mjs.
 */

import type { TrainerPartition } from '../../../data/trainers'
import type {
  BpAward,
  BpAwardArgs,
  BpShopEntry,
  BrainAppearance,
  BrainSymbol,
  FacilityId,
  FrontierBrain,
  FrontierData,
  FrontierFacility,
  FrontierRulesBundle,
  FrontierSet,
  FrontierTrainer,
  IdRange,
  IvBand,
  LevelMode,
  LevelRule,
  NextBrainArgs,
  PoolDraw,
  RawFacility,
  TrainerPool,
  TrainerPoolArgs,
} from './types'

/** What resolveSpecies needs of a species: the scoped dex list supplies it. */
export interface SpeciesName {
  id: number
  name: string
  display_name: string
}

const FACTORY_BRAIN_NOTE =
  'Noland’s team is generated, not fixed: FillFactoryBrainParty (battle_factory.c) draws three sets from the current challenge’s rental range, as for any Factory opponent, at IV sFixedIVTable[challenge + 2]. The team listed for him in sFrontierBrainsMons (Metang, Skarmory, Aggron) is Steven’s Mossdeep multi-battle team and is never used here.'

/**
 * A species name as a lookup key: lowercase letters and digits only, gender signs
 * spelled out. "Mr. Mime", "mr-mime" and "mr mime" all give "mrmime";
 * "Farfetch’d" and "farfetch'd" give "farfetchd"; "Nidoran♀" gives "nidoranf".
 */
export function speciesKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/♀/g, 'f')
    .replace(/♂/g, 'm')
    .replace(/[^a-z0-9]/g, '')
}

const toRange = ([from, to]: [number, number]): IdRange => ({ from, to })

export function createFrontierData(
  rules: FrontierRulesBundle,
  partition: TrainerPartition,
  speciesSource: () => SpeciesName[],
): FrontierData {
  const frontier = partition.facilities.find((f) => f.id === 'battle-frontier')
  if (!frontier) throw new Error('the Emerald trainer bundle has no battle-frontier facility')
  const byId = new Map(rules.facilities.map((f) => [f.id, f]))
  const raw = (id: FacilityId): RawFacility => {
    const f = byId.get(id)
    if (!f) throw new Error(`unknown Frontier facility "${id}"`)
    return f
  }
  const per = rules.stages_per_challenge
  const { normal, hard } = rules.trainer_id_ranges
  const lastRow = normal.length - 1

  // ---------------------------------------------------------- sets, trainers

  let setList: FrontierSet[] | null = null
  const sets = (): FrontierSet[] =>
    (setList ??= frontier.sets.map((s, index) => ({
      ...s,
      index,
      openOnly: index >= rules.open_only_from_index,
    })))

  let trainerList: FrontierTrainer[] | null = null
  const trainers = (): FrontierTrainer[] => {
    if (trainerList) return trainerList
    const indexByKey = new Map(sets().map((s) => [s.key, s.index]))
    trainerList = frontier.trainers
      .filter((t) => !t.party)
      .map((t, id) => ({
        id,
        key: t.key,
        classId: t.class_id,
        className: t.class_name,
        name: t.name,
        setIndices: (t.set_keys ?? []).map((k) => indexByKey.get(k)).filter((i): i is number => i != null),
      }))
    return trainerList
  }

  /** FillTrainerParty (battle_tower.c): a set above FRONTIER_MONS_HIGH_TIER is skipped at Lv50. */
  const trainerSets = (trainerId: number, levelMode: LevelMode): FrontierSet[] => {
    const t = trainers()[trainerId]
    if (!t) return []
    return t.setIndices.map((i) => sets()[i]).filter((s) => levelMode === 'open' || !s.openOnly)
  }

  // ---------------------------------------------------------- trainer pools

  /**
   * GetRandomScaledFrontierTrainerId (battle_tower.c): the challenge's row of
   * sFrontierTrainerIdRanges, or of sFrontierTrainerIdRangesHard for the 7th
   * battle; past the last row, always the last normal row.
   */
  const scaled = (challenge: number, battleNum: number): { idRange: IdRange; hard: boolean } => {
    if (challenge > lastRow) return { idRange: toRange(normal[lastRow]), hard: false }
    if (battleNum === per - 1) return { idRange: toRange(hard[challenge]), hard: true }
    return { idRange: toRange(normal[challenge]), hard: false }
  }

  /** GetFrontierTrainerFixedIvs (battle_tower.c) / GetDomeTrainerMonIvs (battle_dome.c). */
  const trainerIvBand = (range: IdRange): IvBand => {
    const byTrainerId = rules.trainer_ivs
      .filter((b) => b.to >= range.from && b.from <= range.to)
      .map((b) => ({ from: Math.max(b.from, range.from), to: Math.min(b.to, range.to), iv: b.iv }))
    const ivs = byTrainerId.map((b) => b.iv)
    return { min: Math.min(...ivs), max: Math.max(...ivs), rule: 'trainer-id', byTrainerId }
  }

  /**
   * GetFactoryMonFixedIV (battle_factory.c), as FillFactoryFrontierTrainerParty
   * calls it: the row is the Battle Tower Lv50 challenge (the documented
   * mistake), the column is "7th battle". Without BUGFIX the bound is `>`, so
   * challenge 8 reads past the table.
   */
  const factoryIvBand = (streak: number, towerLv50Streak?: number): IvBand => {
    const column = streak % per === per - 1 ? 1 : 0
    const table = rules.factory.iv_table
    const oob = rules.factory.iv_out_of_bounds
    const oobValue = column ? oob.last_battle : oob.normal
    if (towerLv50Streak == null) {
      const values = [...table.map((r) => r[column]), ...(oobValue === 'random' ? [] : [oobValue])]
      return {
        min: oobValue === 'random' ? 0 : Math.min(...values),
        max: 31,
        rule: 'factory-table',
        readsTowerStreak: true,
        ...(oobValue === 'random' ? { random: true as const } : {}),
      }
    }
    const challenge = Math.floor(towerLv50Streak / per)
    const row = challenge > table.length ? table.length - 1 : challenge
    const iv = row === table.length ? oobValue : table[row][column]
    if (iv === 'random') return { min: 0, max: 31, rule: 'factory-table', readsTowerStreak: true, random: true }
    return { min: iv, max: iv, rule: 'factory-table', readsTowerStreak: true }
  }

  /** GetFrontierEnemyMonLevel (battle_tower.c). */
  const level = (levelMode: LevelMode): LevelRule =>
    levelMode === 'lv50'
      ? { mode: 'lv50', level: rules.levels.lv50 }
      : { mode: 'open', min: rules.levels.open_min, max: rules.levels.open_max, rule: 'highest-in-party' }

  const trainerPoolForStreak = ({ facility, levelMode, streak, towerLv50Streak }: TrainerPoolArgs): TrainerPool => {
    const f = raw(facility)
    const challenge = Math.floor(streak / f.streak_per_set)
    let draws: PoolDraw[]
    let note: string | undefined
    switch (facility) {
      case 'dome':
        // InitDomeTrainers (battle_dome.c): entrants 6-15 from the streak's row,
        // entrants 1-5 from the next row; the streak counts tournaments won.
        draws = [
          { ...scaled(challenge, 0), count: 10, when: 'ten of the fifteen other entrants' },
          { ...scaled(challenge + 1, 0), count: 5, when: 'five entrants from the next challenge’s range' },
        ]
        note = 'Which entrant the player meets depends on the bracket; CPU-vs-CPU results are not traced.'
        break
      case 'pike': {
        // PrepareOneTrainer / PrepareTwoTrainers (battle_pike.c): battleNum 1, or
        // 6 for a Hard Battle room; the streak counts rooms (14 per challenge).
        draws = [
          { ...scaled(challenge, 1), when: 'Single or Double Battle room' },
          { ...scaled(challenge, per - 1), when: 'Hard Battle room' },
        ]
        note = 'Which room type comes up is not traced.'
        break
      }
      case 'pyramid': {
        // GetUniqueTrainerId (battle_pyramid.c): battleNum is the floor index
        // (0-6), so the 7th floor reads the Hard row; the streak counts floors.
        const floor = streak % per
        draws = [{ ...scaled(challenge, floor), when: `floor ${floor + 1} of the challenge` }]
        break
      }
      default: {
        // SetNextFacilityOpponent (battle_tower.c; Tower, Palace, Arena) and
        // GenerateOpponentMons (battle_factory.c): battleNum = curChallengeBattleNum.
        const battle = streak % per
        draws = [{ ...scaled(challenge, battle), when: `battle ${battle + 1} of the challenge` }]
        if (facility === 'factory') note = 'Factory opponents draw from factorySetRange, not from their own set list.'
      }
    }
    const idRange = {
      from: Math.min(...draws.map((d) => d.idRange.from)),
      to: Math.max(...draws.map((d) => d.idRange.to)),
    }
    return {
      facility,
      levelMode,
      streak,
      challenge,
      idRange,
      hard: draws.every((d) => d.hard),
      ivBand: facility === 'factory' ? factoryIvBand(streak, towerLv50Streak) : trainerIvBand(idRange),
      level: level(levelMode),
      draws,
      // GetFactoryMonId (battle_factory.c): the challenge's sInitialRentalMonRanges row.
      ...(facility === 'factory'
        ? { factorySetRange: toRange(rules.factory.rental_ranges[levelMode][Math.min(challenge, 7)]) }
        : {}),
      ...(note ? { note } : {}),
    }
  }

  // ---------------------------------------------------------- Brains

  /** A streak-table value (streak + offset) as the owner's log counts it. */
  const appearance = (f: RawFacility, value: number, symbol: BrainSymbol, repeat: boolean): BrainAppearance =>
    f.unit === 'tournament'
      ? // value = tournaments already won; the Brain waits in the next one's final.
        { symbol, battle: (value + 1) * f.per_set, unit: f.unit, unitNumber: value + 1, repeat }
      : { symbol, battle: value, unit: f.unit, unitNumber: value, repeat }

  /** GetFrontierBrainStatus (frontier_util.c): singles only; equality, never "at least". */
  const nextBrainAt = ({ facility, format, streak, symbols }: NextBrainArgs): BrainAppearance | null => {
    if (format !== 'singles') return null
    const f = raw(facility)
    const { silver, gold, repeat, offset } = f.brain.streak
    const v = streak + offset
    if (symbols === 0) return silver >= v ? appearance(f, silver, 'silver', false) : null
    if (symbols === 1) return gold >= v ? appearance(f, gold, 'gold', false) : null
    if (silver >= v) return appearance(f, silver, 'silver', false)
    if (gold >= v) return appearance(f, gold, 'gold', false)
    return appearance(f, gold + Math.ceil((v - gold) / repeat) * repeat, 'gold', true)
  }

  const brains = (): FrontierBrain[] =>
    rules.facilities.map((f) => {
      const fixed = f.brain.team_kind === 'fixed'
      const team = (symbol: BrainSymbol) =>
        frontier.trainers.find((t) => t.key === `brain-${f.id}-${symbol}`)?.party ?? []
      return {
        facility: f.id,
        name: f.brain.name,
        title: f.brain.title,
        symbolName: f.brain.symbol_name,
        teamKind: f.brain.team_kind,
        streak: f.brain.streak,
        silver: appearance(f, f.brain.streak.silver, 'silver', false),
        gold: appearance(f, f.brain.streak.gold, 'gold', false),
        ivs: f.brain.iv,
        teams: fixed ? { silver: team('silver'), gold: team('gold') } : null,
        ...(fixed ? {} : { note: FACTORY_BRAIN_NOTE }),
      }
    })

  // ---------------------------------------------------------- BP

  /** GiveBattlePoints (frontier_util.c). */
  const bpAward = ({ facility, format, completedSets, brain }: BpAwardArgs): BpAward | null => {
    const rows = rules.bp.awards[facility]?.[format]
    if (!rows) return null
    const base = rows[Math.min(Math.max(completedSets - 1, 0), rows.length - 1)]
    const brainBonus = brain ? rules.bp.brain_bonus : 0
    return { base, brainBonus, points: base + brainBonus }
  }

  const addBattlePoints = (balance: number, points: number): number =>
    Math.min(rules.bp.cap, Math.max(0, balance + points))

  const bpShop = (): BpShopEntry[] =>
    rules.shop.map((e) => ({ clerk: e.clerk, itemId: e.item_id, decor: e.decor, name: e.name, price: e.price }))

  // ---------------------------------------------------------- species names

  let speciesIndex: Map<string, number> | null = null
  const resolveSpecies = (name: string): number | null => {
    if (!speciesIndex) {
      speciesIndex = new Map()
      for (const s of speciesSource()) {
        speciesIndex.set(speciesKey(s.name), s.id)
        speciesIndex.set(speciesKey(s.display_name), s.id)
      }
    }
    const key = speciesKey(name)
    return key ? (speciesIndex.get(key) ?? null) : null
  }

  const facilities = (): FrontierFacility[] =>
    rules.facilities.map((f) => ({
      id: f.id,
      name: f.name,
      formats: f.formats.map((x) => ({
        id: x.id,
        partySize: x.party_size,
        ...(x.battle_party_size ? { battlePartySize: x.battle_party_size } : {}),
      })),
      unit: f.unit,
      perSet: f.per_set,
      rules: f.rules,
    }))

  return {
    facilities,
    brains,
    sets,
    trainers,
    trainerSets,
    trainerPoolForStreak,
    nextBrainAt,
    bpAward,
    addBattlePoints,
    bpShop,
    bannedSpecies: () => [...rules.banned_species],
    resolveSpecies,
  }
}
