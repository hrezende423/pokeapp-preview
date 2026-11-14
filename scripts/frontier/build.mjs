/**
 * Build public/data/frontier/emerald.json: the Emerald Battle Frontier RULES
 * that the Trainer Dex bundle does not carry. `npm run build:frontier`.
 *
 * WHAT IS ALREADY ELSEWHERE. public/data/trainers/emerald.json (built by
 * scripts/trainers/facilities.mjs from the same pinned disassembly) holds the
 * Frontier's 882 sets, its 300 trainers and the 14 Brain teams. This file does
 * NOT copy them: the loader (src/modules/battle-frontier/data/) joins the two.
 * This build only cross-checks that bundle against the disassembly (set order =
 * decomp set index, trainer order = decomp trainer id, one set and one trainer
 * field by field) and fails on any drift.
 *
 * WHAT IS HERE: code-only rules, each transcribed from the routine named beside
 * it, from pret/pokeemerald at the pin in scripts/trainers/sources.mjs. Every
 * table is PARSED from the source, never typed in; the few facts that live in
 * map scripts or prose (rule text, symbol names) are hand-written and say so.
 * The disassembly wins over Bulbapedia (scripts/trainers/CLAUDE.md).
 *
 * Throws, writing nothing, when any count or cross-check fails.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REPOS, ensureSources } from '../trainers/sources.mjs'
import { braceGroups, cString, expandMacros, fields, list, read, stripComments } from '../trainers/gen3.mjs'
import { emeraldBrains, evsFromFlags } from '../trainers/facilities.mjs'
import { loadNames } from '../trainers/names.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const DATA = join(ROOT, 'public/data')
const OUT = join(DATA, 'frontier/emerald.json')
const dir = ensureSources(join(ROOT, '.cache/trainers')).pokeemerald
const src = (p) => stripComments(read(join(dir, p)))
const names = loadNames(DATA)

const problems = []
const expect = (ok, msg) => {
  if (!ok) problems.push(msg)
  return ok
}

// ---------------------------------------------------------------- C helpers

/** `#define NAME body` -> Map(NAME -> 123 | 'expression'); expressions resolve on use. */
const defines = (text) =>
  new Map(
    [...text.matchAll(/^#define[ \t]+(\w+)[ \t]+([^\r\n]+?)[ \t]*\r?$/gm)].map((m) => [
      m[1],
      /^\d+$/.test(m[2]) ? Number(m[2]) : m[2].replace(/^\((.*)\)$/, '$1'),
    ]),
  )

const C = new Map([
  ...defines(src('include/constants/battle_frontier_mons.h')),
  ...defines(src('include/constants/battle_frontier_trainers.h')),
  ...defines(src('include/constants/battle_frontier.h')),
  ...defines(src('include/constants/global.h')),
  ...defines(src('include/constants/pokemon.h')),
  ...defines(src('include/constants/battle_dome.h')),
  ...defines(src('include/constants/battle_pike.h')),
])

/** A constant expression: NAME, 123, or a sum/difference of them. */
function value(expr) {
  const parts = String(expr).trim().split(/\s*([+-])\s*/)
  const term = (t) => {
    if (/^\d+$/.test(t)) return Number(t)
    if (/^0x[0-9a-f]+$/i.test(t)) return Number.parseInt(t, 16)
    if (!C.has(t)) throw new Error(`unknown constant ${t}`)
    const v = C.get(t)
    return typeof v === 'number' ? v : value(v)
  }
  let acc = term(parts[0])
  for (let i = 1; i < parts.length; i += 2) acc += (parts[i] === '+' ? 1 : -1) * term(parts[i + 1])
  return acc
}

/** The braces of a table's initializer: `... name[..][..] = { <this> };`. */
function table(text, name) {
  const at = text.search(new RegExp(`\\b${name}\\s*(\\[[^\\]]*\\]\\s*)*=`))
  if (at < 0) throw new Error(`no table ${name}`)
  return balanced(text, text.indexOf('{', at))
}

/** A function's body, from its definition (not its prototype). */
function functionBody(text, name) {
  const m = new RegExp(`\\b${name}\\s*\\([^)]*\\)\\s*\\{`).exec(text)
  if (!m) throw new Error(`no function ${name}`)
  return balanced(text, m.index + m[0].length - 1)
}

function balanced(text, open) {
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1
    else if (text[i] === '}' && --depth === 0) return text.slice(open + 1, i)
  }
  throw new Error('unbalanced braces')
}

/** `[KEY] = value-or-{...}` designated entries, in source order. */
function designated(body) {
  const out = []
  const re = /\[(\w+)\]\s*=\s*/g
  let m
  while ((m = re.exec(body))) {
    let j = re.lastIndex
    let text
    if (body[j] === '{') {
      text = balanced(body, j)
      j += text.length + 2
    } else {
      const end = body.slice(j).search(/,|$/)
      text = body.slice(j, j + end).trim()
      j += end
    }
    out.push([m[1], text])
    re.lastIndex = j
  }
  return out
}

const tower = src('src/battle_tower.c')
const factory = src('src/battle_factory.c')
const dome = src('src/battle_dome.c')
const util = src('src/frontier_util.c')

// ------------------------------------------------- levels and set eligibility

const levels = {
  // GetFrontierEnemyMonLevel (battle_tower.c): Lv50 is fixed; Open Level is the
  // player's highest party level (GetHighestLevelInPlayerParty), floored at 60.
  lv50: value('FRONTIER_MAX_LEVEL_50'),
  open_min: value('FRONTIER_MIN_LEVEL_OPEN'),
  open_max: value('MAX_LEVEL'),
}
expect(
  /level\s*=\s*GetHighestLevelInPlayerParty\(\);\s*if \(level < FRONTIER_MIN_LEVEL_OPEN\)\s*level = FRONTIER_MIN_LEVEL_OPEN;/.test(
    functionBody(tower, 'GetFrontierEnemyMonLevel'),
  ),
  'GetFrontierEnemyMonLevel no longer floors Open Level at FRONTIER_MIN_LEVEL_OPEN',
)
// FillTrainerParty / GetRandomFrontierMonFromSet (battle_tower.c): a set index
// above FRONTIER_MONS_HIGH_TIER is skipped at level 50.
const highTier = value('FRONTIER_MONS_HIGH_TIER')
expect(
  /\(level == FRONTIER_MAX_LEVEL_50 \|\| level == 20\) && monId > FRONTIER_MONS_HIGH_TIER/.test(
    functionBody(tower, 'FillTrainerParty'),
  ),
  'FillTrainerParty no longer filters FRONTIER_MONS_HIGH_TIER at level 50',
)

// ------------------------------------------------------- trainer-id ladders

// sFrontierTrainerIdRanges / sFrontierTrainerIdRangesHard, read by
// GetRandomScaledFrontierTrainerId (battle_tower.c): challenge index =
// streak / 7 (clamped to the last row); the 7th battle of a challenge reads the
// Hard table.
const ranges = (name) => braceGroups(table(tower, name)).map((g) => list(g).map(value))
const trainerIdRanges = {
  normal: ranges('sFrontierTrainerIdRanges'),
  hard: ranges('sFrontierTrainerIdRangesHard'),
}
expect(trainerIdRanges.normal.length === 8 && trainerIdRanges.hard.length === 8, 'expected 8 rows per id ladder')
expect(
  /battleNum == FRONTIER_STAGES_PER_CHALLENGE - 1/.test(functionBody(tower, 'GetRandomScaledFrontierTrainerId')),
  'GetRandomScaledFrontierTrainerId no longer switches to the Hard table on the 7th battle',
)

// GetFrontierTrainerFixedIvs (battle_tower.c), duplicated as
// GetDomeTrainerMonIvs (battle_dome.c): one IV for all six stats, by trainer id.
function ivBands(body) {
  const bands = []
  let from = 0
  for (const m of body.matchAll(/trainerId\s*<=\s*(\w+)\)\s*fixedIv\s*=\s*(\w+);/g)) {
    bands.push({ from, to: value(m[1]), iv: value(m[2]) })
    from = value(m[1]) + 1
  }
  const last = /else\s+fixedIv\s*=\s*(\w+);/.exec(body)
  if (last) bands.push({ from, to: value('FRONTIER_TRAINERS_COUNT') - 1, iv: value(last[1]) })
  return bands
}
const trainerIvs = ivBands(functionBody(tower, 'GetFrontierTrainerFixedIvs'))
expect(
  JSON.stringify(trainerIvs) === JSON.stringify(ivBands(functionBody(dome, 'GetDomeTrainerMonIvs'))),
  'GetDomeTrainerMonIvs no longer matches GetFrontierTrainerFixedIvs',
)
expect(
  trainerIvs.map((b) => b.iv).join() === '3,6,9,12,15,18,21,31' && trainerIvs.at(-1).from === 220,
  `trainer IV bands ${JSON.stringify(trainerIvs)}`,
)

// ------------------------------------------------------------------ Factory

// sFixedIVTable, read by GetFactoryMonFixedIV (battle_factory.c): [challenge][last battle?].
const ivTable = braceGroups(table(factory, 'sFixedIVTable')).map((g) => list(g).map(value))
const getFixedIv = functionBody(factory, 'GetFactoryMonFixedIV')
// The documented off-by-one: without BUGFIX the bound is `>`, so challenge 8 reads
// one row past the table. The decomp comment: that lands on a number above 31,
// which CreateMon treats as random IVs (fixedIV >= USE_RANDOM_IVS, pokemon.c).
expect(
  /#else\s*if \(challengeNum > ARRAY_COUNT\(sFixedIVTable\)\)/.test(getFixedIv),
  'GetFactoryMonFixedIV off-by-one (#else `>` bound) not found',
)
// sInitialRentalMonRanges (battle_factory.c), read by GetFactoryMonId: the set
// index range a Factory opponent (and Noland) draws from, Lv50 rows 0-7, Open 8-15.
const rentalRows = braceGroups(table(factory, 'sInitialRentalMonRanges')).map((g) => list(g).map(value))
expect(rentalRows.length === 16, `expected 16 rental range rows, got ${rentalRows.length}`)
// The row after the table, as bytes: sFixedIVTable[8] would read the first u16
// of the next table if the linker keeps source order (derived, not observed).
const nextU16 = rentalRows[0][0]
const outOfBounds = {
  challenge: ivTable.length,
  normal: (nextU16 & 0xff) >= value('USE_RANDOM_IVS') ? 'random' : nextU16 & 0xff,
  last_battle: (nextU16 >> 8) >= value('USE_RANDOM_IVS') ? 'random' : nextU16 >> 8,
  derived: true,
}
expect(outOfBounds.normal === 'random', 'the out-of-bounds Factory IV row no longer reads as random IVs')

// FillFactoryFrontierTrainerParty (battle_tower.c): regular Factory trainers read
// the table at the BATTLE TOWER's Lv50 challenge (documented mistake), the 7th
// battle uses the second column.
expect(
  /#else[\s\S]*?challengeNum = gSaveBlock2Ptr->frontier\.towerWinStreaks\[battleMode\]\[FRONTIER_LVL_50\]/.test(
    functionBody(tower, 'FillFactoryFrontierTrainerParty'),
  ),
  'FillFactoryFrontierTrainerParty no longer reads the Tower Lv50 streak',
)

// FillFactoryBrainParty (battle_factory.c): Noland's team.
const brainParty = functionBody(factory, 'FillFactoryBrainParty')
const brainIvOffset = /GetFactoryMonFixedIV\(challengeNum \+ (\d+), FALSE\)/.exec(brainParty)
const factoryBrainGenerated =
  /GetFactoryMonId\(lvlMode, challengeNum, FALSE\)/.test(brainParty) &&
  !/sFrontierBrainsMons/.test(brainParty) &&
  /TRAINER_FRONTIER_BRAIN\)\s*\{\s*FillFactoryBrainParty\(\);/.test(functionBody(tower, 'FillFactoryFrontierTrainerParty'))
expect(factoryBrainGenerated && brainIvOffset, 'FillFactoryBrainParty is no longer a GetFactoryMonId draw')

// SetPlayerAndOpponentParties (battle_factory.c): Open Level rentals are created
// at FRONTIER_MAX_LEVEL_OPEN, so GetFrontierEnemyMonLevel's "highest in party"
// is always that level for Factory opponents and Noland.
const factoryOpenLevel = /lvlMode != FRONTIER_LVL_50\)\s*monLevel = (FRONTIER_MAX_LEVEL_OPEN);/.exec(
  functionBody(factory, 'SetPlayerAndOpponentParties'),
)
expect(factoryOpenLevel, 'SetPlayerAndOpponentParties no longer creates Open Level rentals at FRONTIER_MAX_LEVEL_OPEN')

// The per-facility battleNum rules rules.ts hard-codes (trainerPoolForStreak):
// Dome entrants 1-5 from streak + 1 and 6-15 from the streak (InitDomeTrainers);
// Pike battleNum 1, or 6 for a Hard Battle room (PrepareOneTrainer); Pyramid
// battleNum = floor index (GetUniqueTrainerId).
expect(
  /GetRandomScaledFrontierTrainerId\(GetCurrentFacilityWinStreak\(\), 0\)/.test(dome) &&
    /GetRandomScaledFrontierTrainerId\(GetCurrentFacilityWinStreak\(\) \+ 1, 0\)/.test(dome) &&
    /if \(i > 5\)/.test(dome),
  'InitDomeTrainers: entrant ranges changed',
)
expect(
  /if \(!difficult\)\s*battleNum = 1;\s*else\s*battleNum = FRONTIER_STAGES_PER_CHALLENGE - 1;/.test(
    functionBody(src('src/battle_pike.c'), 'PrepareOneTrainer'),
  ),
  'PrepareOneTrainer: Pike battleNum rule changed',
)
expect(
  /u32 floor = gSaveBlock2Ptr->frontier\.curChallengeBattleNum;[\s\S]*GetRandomScaledFrontierTrainerId\(challengeNum, floor\)/.test(
    functionBody(src('src/battle_pyramid.c'), 'GetUniqueTrainerId'),
  ),
  'GetUniqueTrainerId: Pyramid battleNum rule changed',
)

// ------------------------------------------------------------- Frontier Brains

// sFrontierBrainStreakAppearances (frontier_util.c): {silver, gold, repeat, offset}.
// GetFrontierBrainStatus compares (win streak + offset) with them, singles only.
const facilityIndex = (k) => value(k)
const brainStreaks = new Map(
  designated(table(util, 'sFrontierBrainStreakAppearances')).map(([k, v]) => [
    facilityIndex(k),
    list(v).map(Number),
  ]),
)
const brainStatus = functionBody(util, 'GetFrontierBrainStatus')
expect(
  /if \(battleMode != FRONTIER_MODE_SINGLES\)\s*return FRONTIER_BRAIN_NOT_READY;/.test(brainStatus),
  'GetFrontierBrainStatus no longer limits Brains to singles',
)
// CreateFrontierBrainPokemon reads sFrontierBrainsMons; facilities.mjs parses it.
const brainTeams = emeraldBrains(dir)
const brainMonCount = brainTeams.reduce((n, t) => n + t.party.length, 0)
const brainIv = (facility, symbol) => {
  const team = brainTeams.find((t) => t.key === `brain-${facility}-${symbol}`)
  const ivs = new Set(team.party.flatMap((p) => Object.values(p.ivs)))
  expect(ivs.size === 1, `${team.key}: mixed IVs`)
  return [...ivs][0]
}

// ------------------------------------------------------------------ BP

// sBattlePointAwards (frontier_util.c), read by GiveBattlePoints: [row][facility][mode].
// row = (streak / per-set) - 1, clamped to the last row; +10 for a Brain win;
// the balance caps at MAX_BATTLE_FRONTIER_POINTS.
const awardRows = braceGroups(table(util, 'sBattlePointAwards')).map((row) =>
  braceGroups(row).map((f) => list(f).map(Number)),
)
const give = functionBody(util, 'GiveBattlePoints')
const brainBonus = Number(/TRAINER_FRONTIER_BRAIN\)\s*points \+= (\d+);/.exec(give)?.[1])
expect(brainBonus === 10, `Brain BP bonus ${brainBonus}`)
expect(
  /if \(challengeNum != 0\)\s*challengeNum--;/.test(give) && /ARRAY_COUNT\(sBattlePointAwards\) - 1/.test(give),
  'GiveBattlePoints row rule (decrement, clamp) changed',
)
/** How many streak units make one completed set, per facility, from GiveBattlePoints's switch. */
const perSetInGive = (facilityConst) => {
  const m = new RegExp(`case ${facilityConst}:\\s*challengeNum = [^;]*?(?:/ (\\w+))?;`).exec(give)
  return m?.[1] ? value(m[1]) : 1
}

// ------------------------------------------------------------- the facilities

const MODE_IDS = ['singles', 'doubles', 'multi', 'link-multi']
// sBattleTowerPartySizes2 (battle_tower.c) for the Tower; the other lobbies'
// scripts.inc ask for FRONTIER_PARTY_SIZE in every mode (checked below).
const towerSizes = designated(table(tower, 'sBattleTowerPartySizes2')).map(([, v]) => value(v))
const lobbyAsks = (map) =>
  [...read(join(dir, `data/maps/${map}/scripts.inc`)).matchAll(/setvar VAR_0x8005, (\w+)/g)].map((m) => m[1])

/*
 * Hand-written: names, units, rule sentences and symbol names live in strings
 * and map scripts, not in a table. Symbol names are the in-game ones; the
 * owner's log calls the Dome's "tactics" and the Factory's "knowledge".
 */
const FACILITIES = [
  {
    id: 'tower',
    constant: 'FRONTIER_FACILITY_TOWER',
    name: 'Battle Tower',
    lobby: 'BattleFrontier_BattleTowerLobby',
    unit: 'battle',
    rules: 'Seven battles per challenge. Single, Double, Multi (with a partner) and Link Multi battles.',
    brain: { name: 'Anabel', title: 'Salon Maiden', symbol_name: 'Ability Symbol' },
  },
  {
    id: 'dome',
    constant: 'FRONTIER_FACILITY_DOME',
    name: 'Battle Dome',
    lobby: 'BattleFrontier_BattleDomeLobby',
    unit: 'tournament',
    rules:
      'A 16-trainer single-elimination tournament: four rounds. Register three Pokémon, then choose two before each match; the bracket and every opponent’s team are shown in advance.',
    brain: { name: 'Tucker', title: 'Dome Ace', symbol_name: 'Tactics Symbol' },
  },
  {
    id: 'palace',
    constant: 'FRONTIER_FACILITY_PALACE',
    name: 'Battle Palace',
    lobby: 'BattleFrontier_BattlePalaceLobby',
    unit: 'battle',
    rules: 'Seven battles per challenge. The Pokémon choose their own moves, guided by their nature; the trainer only sends them out.',
    brain: { name: 'Spenser', title: 'Palace Maven', symbol_name: 'Spirits Symbol' },
  },
  {
    id: 'arena',
    constant: 'FRONTIER_FACILITY_ARENA',
    name: 'Battle Arena',
    lobby: 'BattleFrontier_BattleArenaLobby',
    unit: 'battle',
    rules:
      'Seven battles per challenge, one Pokémon against one, no switching. A match left standing after three turns is judged on Mind, Skill and Body.',
    brain: { name: 'Greta', title: 'Arena Tycoon', symbol_name: 'Guts Symbol' },
  },
  {
    id: 'factory',
    constant: 'FRONTIER_FACILITY_FACTORY',
    name: 'Battle Factory',
    lobby: 'BattleFrontier_BattleFactoryLobby',
    unit: 'battle',
    rules:
      'Seven battles per challenge with rental Pokémon: pick three of six, and after each win you may swap one for one of the beaten trainer’s.',
    brain: { name: 'Noland', title: 'Factory Head', symbol_name: 'Knowledge Symbol' },
  },
  {
    id: 'pike',
    constant: 'FRONTIER_FACILITY_PIKE',
    name: 'Battle Pike',
    lobby: 'BattleFrontier_BattlePikeLobby',
    unit: 'room',
    rules:
      'Fourteen rooms per challenge, each behind one of three doors: a trainer battle (single, hard or double), wild Pokémon, a status hazard, healing or nothing.',
    brain: { name: 'Lucy', title: 'Pike Queen', symbol_name: 'Luck Symbol' },
  },
  {
    id: 'pyramid',
    constant: 'FRONTIER_FACILITY_PYRAMID',
    name: 'Battle Pyramid',
    lobby: 'BattleFrontier_BattlePyramidLobby',
    unit: 'floor',
    rules:
      'Seven dark floors per challenge, trainers and wild Pokémon on each; only the Battle Bag’s items can be used, and there is no healing between battles.',
    brain: { name: 'Brandon', title: 'Pyramid King', symbol_name: 'Brave Symbol' },
  },
]

const factoryIdx = value('FRONTIER_FACILITY_FACTORY')
const facilities = FACILITIES.map((f) => {
  const index = value(f.constant)
  const modes = awardRows[0][index].length
  const lobbySizes = lobbyAsks(f.lobby)
  const formats = MODE_IDS.slice(0, modes).map((id, mode) => ({
    id,
    // Factory rentals: FRONTIER_PARTY_SIZE throughout battle_factory.c, both formats.
    party_size: f.id === 'tower' ? towerSizes[mode] : value('FRONTIER_PARTY_SIZE'),
    ...(f.id === 'dome' ? { battle_party_size: value('DOME_BATTLE_PARTY_SIZE') } : {}),
  }))
  if (f.id !== 'tower' && f.id !== 'factory') {
    expect(
      lobbySizes.length > 0 && lobbySizes.every((s) => s === 'FRONTIER_PARTY_SIZE'),
      `${f.lobby} asks for ${lobbySizes.join()}`,
    )
  }
  const perSet =
    f.id === 'dome' ? value('DOME_ROUNDS_COUNT') : f.id === 'pike' ? value('NUM_PIKE_ROOMS') : value('FRONTIER_STAGES_PER_CHALLENGE')
  const streakPerSet = perSetInGive(f.constant)
  expect(
    streakPerSet === (f.id === 'dome' ? 1 : perSet),
    `${f.id}: GiveBattlePoints divides the streak by ${streakPerSet}`,
  )
  const [silver, gold, repeat, offset] = brainStreaks.get(index)
  const generated = index === factoryIdx
  // Factory: FillFactoryBrainParty's IV is GetFactoryMonFixedIV(challenge + 2, FALSE),
  // challenge = (wins before the Brain battle) / 7; same row rule as rules.ts.
  const factoryIv = (streakValue) => {
    const row = Math.floor((streakValue - offset) / value('FRONTIER_STAGES_PER_CHALLENGE')) + Number(brainIvOffset[1])
    const clamped = row > ivTable.length ? ivTable.length - 1 : row
    return clamped === ivTable.length ? outOfBounds.normal : ivTable[clamped][0]
  }
  return {
    id: f.id,
    index,
    name: f.name,
    formats,
    unit: f.unit,
    per_set: perSet,
    streak_per_set: streakPerSet,
    rules: f.rules,
    ...(f.id === 'factory' ? { open_level: value(factoryOpenLevel[1]) } : {}),
    brain: {
      ...f.brain,
      team_kind: generated ? 'generated' : 'fixed',
      streak: { silver, gold, repeat, offset },
      iv: generated ? { silver: factoryIv(silver), gold: factoryIv(gold) } : { silver: brainIv(f.id, 'silver'), gold: brainIv(f.id, 'gold') },
      ...(generated ? { iv_rule: 'factory-table', iv_challenge_offset: Number(brainIvOffset[1]) } : {}),
    },
  }
})

// ------------------------------------------------------------- held items, shop, bans

// gBattleFrontierHeldItems (battle_tower.c): a set's itemTableId indexes it.
const heldItemRows = designated(table(tower, 'gBattleFrontierHeldItems'))
const heldItems = heldItemRows.map(([, item]) => (item === 'ITEM_NONE' ? null : names.item(item, 'frontier held items')?.id ?? null))
const heldItemIndex = new Map(heldItemRows.map(([k], i) => [k, i]))

// sFrontierExchangeCorner_* (battle_frontier_exchange_corner.h) say which clerk
// sells what; the price is the script's VAR_0x8008 (BattleFrontier_ExchangeServiceCorner scripts.inc).
const corner = stripComments(read(join(dir, 'src/data/battle_frontier/battle_frontier_exchange_corner.h')))
const CLERKS = { Decor1: 'decor-1', Decor2: 'decor-2', Vitamins: 'vitamins', HoldItems: 'hold-items' }
const clerkOf = new Map()
for (const [suffix, clerk] of Object.entries(CLERKS)) {
  for (const k of list(table(corner, `sFrontierExchangeCorner_${suffix}`))) if (k !== 'ITEM_LIST_END') clerkOf.set(k, clerk)
}
const shopScript = read(join(dir, 'data/maps/BattleFrontier_ExchangeServiceCorner/scripts.inc'))
const titleCase = (k) =>
  k
    .replace(/^DECOR_/, '')
    .toLowerCase()
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
const shop = [...shopScript.matchAll(/setvar VAR_0x8008, (\d+)\s*\n\s*setvar VAR_0x8009, (\w+)/g)].map(([, price, k]) => {
  const item = k.startsWith('ITEM_') ? names.item(k, 'exchange corner') : null
  return {
    clerk: clerkOf.get(k) ?? null,
    item_id: item?.id ?? null,
    decor: k.startsWith('DECOR_') ? k : null,
    name: item?.display_name ?? titleCase(k),
    price: Number(price),
  }
})
expect(shop.length === clerkOf.size && shop.every((e) => e.clerk), `shop: ${shop.length} priced of ${clerkOf.size} listed`)

// gFrontierBannedSpecies (frontier_util.c), 0xFFFF-terminated.
const banned = list(table(util, 'gFrontierBannedSpecies'))
  .filter((s) => s !== '0xFFFF')
  .map((s) => names.species(s, 'banned species')?.id ?? null)

// ------------------------------------------- cross-check the Trainer Dex bundle

const trainerBundle = JSON.parse(readFileSync(join(DATA, 'trainers/emerald.json'), 'utf8'))
const frontier = trainerBundle.facilities.find((f) => f.id === 'battle-frontier')
const regular = frontier.trainers.filter((t) => !t.party)
const bundleBrains = frontier.trainers.filter((t) => t.party)
const natureId = Object.fromEntries(
  Object.values(JSON.parse(readFileSync(join(DATA, 'natures.json'), 'utf8'))).map((n) => [n.name, n.id]),
)

const setOrder = frontier.sets.every((s, i) => C.get(s.key) === i)
expect(frontier.sets.length === value('NUM_FRONTIER_MONS'), `bundle sets ${frontier.sets.length}`)
expect(setOrder, 'bundle set order is not the decomp set index (FRONTIER_MON_* values)')

// gBattleFrontierTrainers (battle_frontier_trainers.h), designated by FRONTIER_TRAINER_*.
const decompTrainers = designated(table(src('src/data/battle_frontier/battle_frontier_trainers.h'), 'gBattleFrontierTrainers')).map(
  ([k, body]) => ({ id: C.get(k), key: k, ...fields(body) }),
)
const trainerOrder =
  decompTrainers.every((t, i) => t.id === i) &&
  regular.every((t, i) => t.name?.toUpperCase() === cString(decompTrainers[i]?.trainerName))
expect(regular.length === value('FRONTIER_TRAINERS_COUNT'), `bundle regular trainers ${regular.length}`)
expect(trainerOrder, 'bundle trainer order is not the decomp trainer id (FRONTIER_TRAINER_* values)')
expect(bundleBrains.length === 14 && brainMonCount === 42, `brains: ${bundleBrains.length} teams, ${brainMonCount} decomp mons`)
expect(
  bundleBrains.reduce((n, t) => n + t.party.length, 0) === 42,
  'bundle Brain Pokemon are not 42 (7 facilities x 2 symbols x 3)',
)

/** One set, field by field: decomp gBattleFrontierMons entry vs bundle. */
function checkSet(key) {
  const raw = designated(table(src('src/data/battle_frontier/battle_frontier_mons.h'), 'gBattleFrontierMons')).find(([k]) => k === key)
  const x = fields(raw[1])
  const bundle = frontier.sets[C.get(key)]
  const evKeys = { HP: 'hp', ATTACK: 'attack', DEFENSE: 'defense', SPEED: 'speed', SP_ATTACK: 'special-attack', SP_DEFENSE: 'special-defense' }
  const want = {
    key,
    species_id: names.species(x.species)?.id,
    moves: list(x.moves)
      .filter((m) => m !== 'MOVE_NONE')
      .map((m) => names.move(m)?.id),
    item_id: heldItems[heldItemIndex.get(x.itemTableId)],
    nature_id: natureId[x.nature.replace(/^NATURE_/, '').toLowerCase()],
    evs: evsFromFlags(x.evSpread.split('|').map((f) => evKeys[f.trim().replace(/^F_EV_SPREAD_/, '')])),
  }
  const got = {
    key: bundle.key,
    species_id: bundle.species_id,
    moves: bundle.moves,
    item_id: bundle.item_id,
    nature_id: bundle.nature_id,
    evs: bundle.evs,
  }
  const sorted = (o) => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v))
  return expect(sorted(want) === sorted(got), `set ${key}: decomp ${sorted(want)} vs bundle ${sorted(got)}`) && { index: C.get(key), ...want }
}

/** One trainer, field by field: class, name and its set list (macros expanded). */
function checkTrainer(key) {
  const t = decompTrainers.find((x) => x.key === key)
  const pools = expandMacros(src('src/data/battle_frontier/battle_frontier_trainer_mons.h'))
  const setName = t.monSet.trim()
  const m = new RegExp(`const\\s+u16\\s+${setName}\\s*\\[\\s*\\]\\s*=\\s*\\{([\\s\\S]*?)\\};`).exec(pools)
  const want = {
    class_id: t.facilityClass,
    name: cString(t.trainerName),
    set_keys: m[1]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== '-1'),
  }
  const b = regular[t.id]
  const got = { class_id: b.class_id, name: b.name?.toUpperCase(), set_keys: b.set_keys }
  // Decomp-side values, so verify:frontier-data can re-compare them with the bundle.
  return (
    expect(JSON.stringify(want) === JSON.stringify(got), `trainer ${key}: decomp ${JSON.stringify(want)} vs bundle ${JSON.stringify(got)}`) && {
      id: t.id,
      key,
      ...want,
    }
  )
}

/** Decomp keys and names at sample positions: the suite re-checks the bundle's order against them. */
const keyAt = new Map([...C].filter(([k, v]) => k.startsWith('FRONTIER_MON_') && typeof v === 'number').map(([k, v]) => [v, k]))
const orderSamples = {
  sets: Object.fromEntries([0, 109, 110, 371, 372, 849, 850, 881].map((i) => [i, keyAt.get(i)])),
  trainers: Object.fromEntries([0, 99, 100, 119, 200, 219, 220, 299].map((i) => [i, cString(decompTrainers[i].trainerName)])),
}

const namedSets = [checkSet('FRONTIER_MON_SUNKERN'), checkSet('FRONTIER_MON_SUICUNE_6')]
const namedTrainers = [checkTrainer('FRONTIER_TRAINER_BRADY'), checkTrainer('FRONTIER_TRAINER_GRETEL')]

// ---------------------------------------------------------------- counts

const counts = {
  sets: frontier.sets.length,
  open_only_sets: frontier.sets.length - (highTier + 1),
  trainers: regular.length,
  // gBattleFrontierHeldItems has 63 slots; slot 0 is BATTLE_FRONTIER_ITEM_NONE.
  held_item_slots: heldItems.length,
  held_items: heldItems.filter((x) => x != null).length,
  brain_pokemon: brainMonCount,
  banned_species: banned.filter((x) => x != null).length,
  shop_entries: shop.length,
}
expect(counts.sets === 882, `sets ${counts.sets}`)
expect(counts.trainers === 300, `trainers ${counts.trainers}`)
expect(
  counts.held_item_slots === 63 && heldItems[0] === null && counts.held_items === 62,
  `held items: ${counts.held_item_slots} slots, ${counts.held_items} items`,
)
expect(counts.brain_pokemon === 42, `brain Pokemon ${counts.brain_pokemon}`)
expect(counts.banned_species === 10 && banned.length === 10, `banned species ${counts.banned_species}`)
names.assertClean()

if (problems.length) {
  throw new Error(`build:frontier: ${problems.length} problem(s), nothing written:\n  ${problems.join('\n  ')}`)
}

// ---------------------------------------------------------------- write

const out = {
  version_group: 'emerald',
  generation: 3,
  source: `pret/pokeemerald@${REPOS.pokeemerald.sha.slice(0, 12)}`,
  levels,
  /** Set index > FRONTIER_MONS_HIGH_TIER: Open Level only. */
  open_only_from_index: highTier + 1,
  stages_per_challenge: value('FRONTIER_STAGES_PER_CHALLENGE'),
  trainer_count: value('FRONTIER_TRAINERS_COUNT'),
  trainer_id_ranges: trainerIdRanges,
  trainer_ivs: trainerIvs,
  factory: {
    iv_table: ivTable,
    iv_out_of_bounds: outOfBounds,
    rental_ranges: { lv50: rentalRows.slice(0, 8), open: rentalRows.slice(8) },
  },
  facilities,
  bp: {
    // awards[facility][format][row]: row = completed sets in the streak - 1, clamped to the last row.
    awards: Object.fromEntries(
      facilities.map((f) => [
        f.id,
        Object.fromEntries(f.formats.map((fmt, mode) => [fmt.id, awardRows.map((row) => row[f.index][mode] ?? 0)])),
      ]),
    ),
    brain_bonus: brainBonus,
    cap: value('MAX_BATTLE_FRONTIER_POINTS'),
  },
  shop,
  held_items: heldItems,
  banned_species: banned,
  counts,
  checks: {
    set_order_is_decomp_index: setOrder,
    trainer_order_is_decomp_id: trainerOrder,
    order_samples: orderSamples,
    named_sets: namedSets,
    named_trainers: namedTrainers,
  },
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, `${JSON.stringify(out)}\n`)
console.log(`wrote ${OUT.slice(ROOT.length + 1)} (${(JSON.stringify(out).length / 1024).toFixed(1)} KiB)`)
console.log(`  counts ${JSON.stringify(counts)}`)
console.log(`  brains ${facilities.map((f) => `${f.id} ${f.brain.team_kind} ${f.brain.iv.silver}/${f.brain.iv.gold}`).join(', ')}`)
