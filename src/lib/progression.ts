/** Pure progression helpers — shared by server (authoritative) and client (display only). */

export type LevelDef = { level: number; xp: number; title: string };
export type StageDef = { name: string; minLevel: number; image: string; description: string };

const TITLES = [
  // Baby Goblin 1–4
  "Hatchling", "Mud Sprout", "Pebble Snatcher", "Tiny Trickster",
  // Young Goblin 5–8
  "Sneaky Scamp", "Hood Apprentice", "Alley Runner", "Coin Sniffer",
  // Cave Goblin 9–12
  "Tunnel Crawler", "Lantern Bearer", "Deep Delver", "Cave Scout",
  // Coin Hunter 13–16
  "Glimmer Seeker", "Treasure Tracker", "Vault Raider", "Gold Hunter",
  // Goblin Warrior 17–20
  "Shield Bearer", "Blade Grinner", "War Howler", "Battle Goblin",
  // Goblin Chief 21–25
  "Clan Elder", "Tribe Speaker", "War Chief", "High Chieftain", "Grand Chief",
  // Goblin King 26+
  "Crowned Heir", "Goblin King", "Golden Sovereign", "Emerald Monarch", "Lord of the Hoard",
  "King of Caves", "Gilded Tyrant", "Coin Emperor", "Eternal Grin", "Mythic Monarch",
  "Legend of Gold", "Ancient King", "Hoard Overlord", "Gold Immortal", "The Gop Supreme",
];

/** XP needed to reach level n: increasing curve. L2=140, L5=1040, L10=4140, L26=27500. */
export function defaultXpForLevel(n: number): number {
  const k = n - 1;
  return 100 * k + 40 * k * k;
}

export const DEFAULT_LEVELS: LevelDef[] = TITLES.map((title, i) => ({
  level: i + 1,
  xp: defaultXpForLevel(i + 1),
  title,
}));

export const DEFAULT_STAGES: StageDef[] = [
  { name: "Baby Goblin", minLevel: 1, image: "/art/goblin-1.webp", description: "Small body, oversized ears and a playful grin." },
  { name: "Young Goblin", minLevel: 5, image: "/art/goblin-2.webp", description: "Taller, prouder, and wearing a first real hood." },
  { name: "Cave Goblin", minLevel: 9, image: "/art/goblin-3.webp", description: "A rugged explorer of the deep tunnels." },
  { name: "Coin Hunter", minLevel: 13, image: "/art/goblin-4.webp", description: "Gold accessories and a nose for treasure." },
  { name: "Goblin Warrior", minLevel: 17, image: "/art/goblin-5.webp", description: "Armored, fearless and ready for battle." },
  { name: "Goblin Chief", minLevel: 21, image: "/art/goblin-6.webp", description: "Rare ornaments and the respect of the clan." },
  { name: "Goblin King", minLevel: 26, image: "/art/goblin-7.webp", description: "A golden crown for the ruler of the hoard." },
];

/** Highest level whose threshold is <= xp. Levels must be sorted ascending. */
export function levelForXp(xp: number, levels: LevelDef[]): number {
  let lvl = 1;
  for (const l of levels) {
    if (xp >= l.xp) lvl = l.level;
    else break;
  }
  return lvl;
}

export function stageForLevel(level: number, stages: StageDef[]): StageDef {
  let s = stages[0];
  for (const st of stages) if (level >= st.minLevel) s = st;
  return s;
}

export function nextStage(level: number, stages: StageDef[]): StageDef | null {
  return stages.find((s) => s.minLevel > level) ?? null;
}

export function levelProgress(xp: number, levels: LevelDef[]) {
  const level = levelForXp(xp, levels);
  const cur = levels.find((l) => l.level === level) ?? levels[0];
  const next = levels.find((l) => l.level === level + 1) ?? null;
  const span = next ? next.xp - cur.xp : 1;
  const into = xp - cur.xp;
  return {
    level,
    title: cur.title,
    currentLevelXp: cur.xp,
    nextLevelXp: next?.xp ?? null,
    xpToNext: next ? Math.max(0, next.xp - xp) : 0,
    progress: next ? Math.min(1, Math.max(0, into / span)) : 1,
    maxed: !next,
  };
}
