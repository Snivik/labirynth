/**
 * The 24 treasures of the labyrinth.
 *
 * Twelve of them sit on the fixed tiles glued to the board; twelve travel
 * around on loose tiles. That split matches the physical game, and it means a
 * treasure card can send you chasing a target that is itself moving.
 */

export interface Treasure {
  id: string;
  /** Name shown on the treasure card. */
  name: string;
  /** Key into the icon table in the client. */
  icon: string;
}

/** Treasures printed on the twelve fixed T-junctions. */
export const FIXED_TREASURES: Treasure[] = [
  { id: "chest", name: "The Treasure Chest", icon: "chest" },
  { id: "crown", name: "The Golden Crown", icon: "crown" },
  { id: "ring", name: "The Ruby Ring", icon: "ring" },
  { id: "keys", name: "The Ring of Keys", icon: "keys" },
  { id: "sword", name: "The Broadsword", icon: "sword" },
  { id: "dagger", name: "The Jewelled Dagger", icon: "dagger" },
  { id: "candelabra", name: "The Candelabra", icon: "candelabra" },
  { id: "map", name: "The Old Map", icon: "map" },
  { id: "purse", name: "The Purse of Gold", icon: "purse" },
  { id: "emerald", name: "The Emerald", icon: "emerald" },
  { id: "grimoire", name: "The Grimoire", icon: "grimoire" },
  { id: "helmet", name: "The Winged Helmet", icon: "helmet" },
];

/** Treasures printed on six loose corner tiles. */
export const CORNER_TREASURES: Treasure[] = [
  { id: "skull", name: "The Skull", icon: "skull" },
  { id: "ghost", name: "The Ghost", icon: "ghost" },
  { id: "bat", name: "The Bat", icon: "bat" },
  { id: "spider", name: "The Spider", icon: "spider" },
  { id: "moth", name: "The Moth", icon: "moth" },
  { id: "rat", name: "The Rat", icon: "rat" },
];

/** Treasures printed on the six loose T-junctions. */
export const TEE_TREASURES: Treasure[] = [
  { id: "owl", name: "The Owl", icon: "owl" },
  { id: "dragon", name: "The Dragon", icon: "dragon" },
  { id: "genie", name: "The Genie's Lamp", icon: "genie" },
  { id: "beetle", name: "The Scarab", icon: "beetle" },
  { id: "salamander", name: "The Salamander", icon: "salamander" },
  { id: "bones", name: "The Bones", icon: "bones" },
];

export const ALL_TREASURES: Treasure[] = [
  ...FIXED_TREASURES,
  ...CORNER_TREASURES,
  ...TEE_TREASURES,
];

export const MAX_COLLECTIBLES = ALL_TREASURES.length;

/**
 * Order in which treasures get handed out to recordings. Fixed and loose
 * treasures alternate, so even a short deck is spread across the whole board
 * instead of clustering in one quarter of it.
 */
export const ASSIGNMENT_ORDER: string[] = [
  "chest", "ghost",
  "crown", "spider",
  "keys", "dragon",
  "emerald", "bat",
  "candelabra", "owl",
  "ring", "rat",
  "map", "genie",
  "sword", "moth",
  "purse", "beetle",
  "grimoire", "skull",
  "dagger", "salamander",
  "helmet", "bones",
];

const BY_ID = new Map(ALL_TREASURES.map((t) => [t.id, t]));

export function treasureById(id: string): Treasure | undefined {
  return BY_ID.get(id);
}
