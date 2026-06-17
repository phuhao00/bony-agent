/** Desktop pet visual character (skin) selection. */

export type PetCharacterId = "star" | "hello_kitty" | "peppa_pig" | "xiong_er" | "gg_bond";

const STORAGE_KEY = "ama_pet_character_v1";
const HINT_STORAGE_KEY = "ama_pet_character_hint_v1";

export const PET_CHARACTERS: {
  id: PetCharacterId;
  label: string;
  shortLabel: string;
}[] = [
  { id: "star", label: "波尼星星", shortLabel: "星星" },
  { id: "hello_kitty", label: "Hello Kitty", shortLabel: "Kitty" },
  { id: "peppa_pig", label: "小猪佩奇", shortLabel: "佩奇" },
  { id: "xiong_er", label: "熊二", shortLabel: "熊二" },
  { id: "gg_bond", label: "猪猪侠", shortLabel: "猪猪侠" },
];

export function loadPetCharacter(): PetCharacterId {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (
      raw === "hello_kitty" ||
      raw === "star" ||
      raw === "peppa_pig" ||
      raw === "xiong_er" ||
      raw === "gg_bond"
    )
      return raw;
  } catch {
    /* ignore */
  }
  return "star";
}

export function savePetCharacter(id: PetCharacterId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* ignore */
  }
}

export function characterShortLabel(id: PetCharacterId): string {
  return PET_CHARACTERS.find((c) => c.id === id)?.shortLabel ?? "星星";
}

export function characterWakeLabel(id: PetCharacterId): string {
  if (id === "hello_kitty") return "唤醒 Kitty";
  if (id === "peppa_pig") return "唤醒佩奇";
  if (id === "xiong_er") return "唤醒熊二";
  if (id === "gg_bond") return "唤醒猪猪侠";
  return "唤醒波尼";
}

export function shouldShowCharacterHint(): boolean {
  try {
    return localStorage.getItem(HINT_STORAGE_KEY) !== "1";
  } catch {
    return false;
  }
}

export function dismissCharacterHint(): void {
  try {
    localStorage.setItem(HINT_STORAGE_KEY, "1");
  } catch {
    /* ignore */
  }
}
