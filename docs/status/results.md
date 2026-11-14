# Result: Frontier data layer

2026-11-14. Replaces the previous result; history is in git.

DONE. Branch `feature/frontier-data` (commits `6265f1c`, `e28a934`). `npm run check -- --since main`: 9/9 PASS (typecheck, lint, build, app, frontier-data, infra, pokedex, species-page, ux). Not merged, no preview.

- **Rules bundle:** `public/data/frontier/emerald.json` (13.6 KiB), built by `npm run build:frontier` (`scripts/frontier/build.mjs`).
  - It reads the same pinned `pret/pokeemerald@c925b8482d05`. No new clone: five more sparse paths at the same SHA, `scripts/trainers/sources.mjs`.
  - Every table is parsed from the source, never typed in. The build throws, and writes nothing, on any count or cross-check failure.
  - Running it again gives an identical file.
- **Loader:** `src/modules/battle-frontier/data/`: `types.ts`, `rules.ts` (pure), `index.ts` (lazy fetch, Gen 3 only).
- **Wiring:**
  - `frontier` is added to `PARTITION_DIRS` (runtime CacheFirst).
  - `frontier/*.json` is added to the precache globs (`vite.config.ts`).
  - `build:frontier` and `verify:frontier-data` are npm scripts.
  - The suite is in `suiteMap.mjs` and is browser-free in `check.mjs`.
- **Suite:** `verify:frontier-data`, 84 checks, Node only.
- **Review:** a fresh-context spec review checked every transcription against the disassembly. It found no blockers. One real gap and three weak tests were fixed in `e28a934` (see Assumptions).
- **Untouched:** no screen, no nav entry, no store; the Trainer Dex bundle and screens.

## (a) Audit: what `trainers/emerald.json` held

| Item | Before | Now |
|---|---|---|
| 882 Frontier sets (species, moves, item, nature, EVs) | have | Bundle order = decomp set index 0-881, verified (8 samples at range edges, 2 sets field by field) |
| 300 regular trainers + set lists | have | Bundle order = decomp trainer id 0-299, verified (8 samples, Brady and Gretel field by field) |
| 14 Brain teams (42 Pokémon) with IVs, EVs, nature, moves | have | Counted; IVs read back per facility |
| Brain streak table | partial: only Silver and Gold, inside the label text ("(35th challenge)"); no repeat and no offset column | `facilities[].brain.streak` {silver, gold, repeat, offset} |
| Facility table: formats, party size, set length, rule text | missing (one shared rule sentence) | Added. Party sizes from `sBattleTowerPartySizes2` and the lobby scripts; formats from the BP table |
| Trainer-id ranges per challenge, normal + Hard | missing | Added (`sFrontierTrainerIdRanges`, `...Hard`) |
| Open Level-only sets (index > 849) | missing | Added: `open_only_from_index` 850, 32 sets |
| Level rules | partial (prose) | Lv50 = 50. Open = highest in party, at least 60. Factory Open = 100 |
| Opponent IV by trainer id | missing | Added: 3/6/9/12/15/18/21, then 31 from id 220 |
| Factory IV table, off-by-one, rental ranges | missing | Added: `sFixedIVTable`, out-of-bounds row, `sInitialRentalMonRanges` |
| BP awards, Brain +10, 9999 cap | missing | Added: `sBattlePointAwards` (30 rows), +10, cap |
| BP shop | missing | Added: 30 entries over four clerks |
| Banned species | missing | Added: 10 |
| Held-item table | partial: sets carry the resolved `item_id`; the table is absent | Added: 63 slots |
| Factory Brain team kind | shown as a fixed team (see c) | `teamKind: 'generated'` |
| Set abilities | missing | Still open (see e) |

**Answers to the audit questions:**
- **The 314 trainers** are 300 regular trainers (`FRONTIER_TRAINER_BRADY` 0 … `GRETEL` 299) and 14 Brain teams (7 Brains × Silver and Gold).
- **Set order** maps one-to-one onto the decomp index: `bundle.sets[i].key` has the `FRONTIER_MON_*` value `i` for every `i`.
- **Brain streak data** is present for all 7 Brains, but only as the Silver/Gold numbers inside the label text.

**Trainer Dex labels:** those label numbers are the raw table values, not challenge numbers.
- "Battle Tower · Silver Symbol (35th challenge)" is the 35th *battle*.
- "Battle Dome · Silver Symbol (4th challenge)" means 4 tournaments won, so Tucker is in the 5th tournament.

I am reporting this, not changing it.

## (b) Frozen loader API

```ts
// src/modules/battle-frontier/data/index.ts
export const FRONTIER_GENERATION = 3
export function isFrontierGeneration(generation: number | null | undefined): boolean
export function loadFrontierData(generation: number | null | undefined): Promise<FrontierData | null> // null unless 3; fetches nothing then
export function peekFrontierData(generation: number | null | undefined): FrontierData | null
export function speciesKey(name: string): string

export interface FrontierData {
  facilities(): FrontierFacility[]          // { id, name, formats: { id, partySize, battlePartySize? }[], unit, perSet, rules }
  brains(): FrontierBrain[]                 // { facility, name, title, symbolName, teamKind, streak, silver, gold, ivs, teams | null, note? }
  sets(): FrontierSet[]                     // FacilitySet & { index: number /* 0-881 */; openOnly: boolean }
  trainers(): FrontierTrainer[]             // { id /* 0-299 */, key, classId, className, name, setIndices }
  trainerSets(trainerId: number, levelMode: LevelMode): FrontierSet[]   // Lv50 drops openOnly
  trainerPoolForStreak(args: TrainerPoolArgs): TrainerPool
  nextBrainAt(args: NextBrainArgs): BrainAppearance | null
  bpAward(args: BpAwardArgs): BpAward | null       // null: no such format at that facility
  addBattlePoints(balance: number, points: number): number   // capped at 9999
  bpShop(): BpShopEntry[]                   // { clerk, itemId, decor, name, price }
  bannedSpecies(): number[]
  resolveSpecies(name: string): number | null      // Gen 3 species id
}

type FacilityId = 'tower' | 'dome' | 'palace' | 'arena' | 'factory' | 'pike' | 'pyramid'
type FrontierFormat = 'singles' | 'doubles' | 'multi' | 'link-multi'
type LevelMode = 'lv50' | 'open'
type StreakUnit = 'battle' | 'tournament' | 'room' | 'floor'

interface TrainerPoolArgs { facility: FacilityId; levelMode: LevelMode; streak: number; format?: FrontierFormat; symbols?: 0 | 1 | 2; towerLv50Streak?: number }
interface TrainerPool {
  facility; levelMode; streak; challenge: number      // the game's u8 challenge number
  idRange: { from: number; to: number }; hard: boolean
  ivBand: { min: number; max: number; rule: 'trainer-id' | 'factory-table'; byTrainerId?: { from; to; iv }[]; readsTowerStreak?: true; random?: true }
  level: { mode: 'lv50'; level: number } | { mode: 'open'; min: number; max: number; rule: 'highest-in-party' }
  draws: { idRange; hard: boolean; count?: number; when: string }[]
  factorySetRange?: { from: number; to: number }
  brain?: BrainAppearance                              // the Brain is due instead (needs `symbols`)
  note?: string
}
interface NextBrainArgs { facility: FacilityId; format: FrontierFormat; levelMode: LevelMode; streak: number; symbols: 0 | 1 | 2 }
interface BrainAppearance { symbol: 'silver' | 'gold'; battle: number; unit: StreakUnit; unitNumber: number; repeat: boolean }
interface BpAwardArgs { facility: FacilityId; format: FrontierFormat; completedSets: number; brain?: boolean }
interface BpAward { base: number; brainBonus: number; points: number }
```

**`streak` everywhere** is the game's own counter for that facility:
- battles won (Tower, Palace, Arena, Factory);
- tournaments won (Dome);
- rooms cleared (Pike);
- floors cleared (Pyramid).

**`nextBrainAt().battle`** counts the way your log does:
- Dome: battles, at 4 per tournament.
- Pike: rooms.
- Pyramid: floors.

**Checked results:**
- Tower 35/70, Dome 20/40 (5th and 10th tournament), Palace 21/42, Arena 28/56, Factory 21/42, Pike room 28/140, Pyramid floor 21/70.
- Repeats come every 35/5/21/28/21/56/35 after Gold.

## (c) Factory Brain: generated

**Conclusion:** `teamKind: 'generated'`.

**Code evidence:**
- `FillFactoryFrontierTrainerParty` (battle_tower.c) routes `TRAINER_FRONTIER_BRAIN` to `FillFactoryBrainParty` (battle_factory.c).
- That function never reads `sFrontierBrainsMons`.
- It draws three sets with `GetFactoryMonId(lvlMode, challengeNum, FALSE)`. That is the same rental-range draw a regular Factory opponent gets, with the same Unown, duplicate-species and duplicate-item rules.
- The IV is `GetFactoryMonFixedIV(challengeNum + 2, FALSE)`: 15 at battle 21 and 31 at battle 42.
- The decomp's own comment on the table entry: "Because Factory's Pokémon are random, this facility's Brain also uses random Pokémon. … this team is actually the one Steven uses in the multi tag battle".

**Evidence from your log:**
- At Factory battle 21 (attempt 4), Noland fielded Roselia / Venomoth / Weepinbell.
- The table's team is Metang / Skarmory / Aggron, so none of the three is on it.
- All three have a set in the Lv50 challenge-3 rental range, sets 267-371.
- They do not fit the Open Level range (564-659), so your log is Lv50.

**Trainer Dex (reported, not changed):**
- The Trainer Dex does present a fixed Noland team.
- `brain-factory-silver` and `brain-factory-gold` both show Steven's Metang / Skarmory / Aggron as Noland's party, at 31 IVs.
- A "Note" line says he uses rentals.
- `verify:trainers` asserts that note.

## (d) Fixture names that did not resolve

None.
- I parsed 500 species cells (175 distinct names) from both blocks, plus the Dome team in row 3. All of them resolve through `resolveSpecies`, including `mr. mime`, `farfetch'd` and `porygon2`.
- Your log's Tucker teams at battles 20 and 40 equal the bundle's fixed Silver and Gold teams.

## (e) Known gaps still open

- **No ability on sets.** The bundle carries none; Gen 3 Frontier Pokémon get one of their two abilities at random.
- **Pike: which room type comes up is not traced.**
  - The pools per room type are encoded: Single/Double rooms use battleNum 1, Hard rooms use the Hard row.
  - Wild Pokémon rooms are not modelled.
- **Pyramid: how many trainers per floor, and the wild Pokémon tables, are not traced.**
  - The trainer pool per floor is encoded: floor index 0-6, and the 7th floor uses the Hard row.
- **Dome: CPU-vs-CPU match resolution is not traced.**
  - So which entrant you meet, and whether Tucker always reaches the final, is not modelled.
  - Your log has him in the final both times.
- **Tower record-mixing, Apprentice and e-Reader trainers are not modelled.** `ChooseSpecialBattleTowerTrainer` can replace a random Tower opponent.
- **The Factory rentals offered to the player** (their range and IVs) are not encoded. Only opponents and Noland are.

## Assumptions (decided, not asked)

**The brief's "63 held items":**
- `gBattleFrontierHeldItems` has **63 slots**, but slot 0 is `ITEM_NONE`, so it holds **62 real items**.
- The build asserts both numbers.

**`ivBand` for streak 49:**
- Ids 200-299 span two IV bands, so the result is `{ min: 21, max: 31, byTrainerId: [200-219 → 21, 220-299 → 31] }`.
- "ivBand 21" in the brief is `min`.

**Changes to the brief's API sketch:**
- `facilities()` … `resolveSpecies()` are methods of the object `loadFrontierData` resolves to. They cannot be called before loading, or outside Gen 3.
- `loadFrontierData` takes the generation.
- `bpAward` takes `brain?: boolean`. It returns `{ base, brainBonus, points }`, and the cap is applied by `addBattlePoints`.
- Added beyond the brief: `trainerSets`, `addBattlePoints`, `peekFrontierData`, `speciesKey`, and the optional pool args `symbols`, `format` and `towerLv50Streak`.

**`bpAward(completedSets)`:**
- It counts the set just won: row = sets − 1, clamped.
- The review confirmed the streak is already incremented when `GiveBattlePoints` runs.

**Factory regular-trainer IVs read the Tower Lv50 streak** (a documented decomp mistake).
- Without `towerLv50Streak`, the band spans the whole table and is flagged `readsTowerStreak`.
- Tower challenge 8 hits the off-by-one row:
  - Battles 1-6 get random IVs; the decomp comment says so.
  - The 7th battle gets IV 0. That value is derived from the ROM layout (the next table's first byte), not observed, and is flagged `derived: true`.

**Review fixes in `e28a934`:**
- Factory Open Level opponents are fixed at 100.
- Challenge numbers wrap as the game's u8 (streak 1792 reads as challenge 0).
- A due Brain is flagged on the pool when `symbols` is passed.
- Drift checks for the hard-coded Dome, Pike and Pyramid rules.
- The suite now compares decomp-side samples, set lists and EVs instead of build-written booleans. It pins the fixture's 500 cells and Noland's Lv50 range.

**Hand-written, not parsed:**
- The rule sentences.
- The symbol names: Ability, Tactics, Spirits, Guts, Knowledge, Luck, Brave. The strings are not in the sparse checkout; your log's "tactics" and "knowledge" match.

**Files:**
- `frontier/*.json` is precached, like the trainers partition (offline before first view).
- The entry chunk does not contain the loader (asserted on `dist/`).
- `docs/fixtures/bf-tracker.xlsx` is committed, because the suite reads it.
- This file is force-added, because `docs/status/` is gitignored.

## Open items

- Nothing blocks handoff 2.
- If the Trainer Dex labels or Noland's displayed team should change, that is a separate request: Trainer Dex screens were out of scope.
