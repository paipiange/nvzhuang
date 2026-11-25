export type OutfitLibrary = 'real' | 'anime'

export interface CharacterProfile {
  characterId: string
  displayName: string
  personaId: string
  voiceId: string
  faceId: string
  outfitId: string
  outfitLibrary: OutfitLibrary
  poseId: string
  avatarModelId: string
  avatarType: 'static' | 'live2d' | 'vrm'
}

export type CharacterAction
  = | { kind: 'character' | 'face' | 'pose', id: string }
    | { kind: 'outfit', id: string, library: OutfitLibrary }

export const POSES: readonly Readonly<{ id: string, label: string }>[]
export const CHARACTERS: readonly Readonly<CharacterProfile & { id: string, label: string }>[]

interface AssetId { id: string }
interface OutfitId extends AssetId { library: OutfitLibrary }

export function restoreCharacter(saved: unknown, faces: readonly AssetId[], outfits: readonly OutfitId[]): CharacterProfile
export function updateCharacter(profile: CharacterProfile, action: CharacterAction, faces: readonly AssetId[], outfits: readonly OutfitId[]): CharacterProfile | null
export function parseCharacterIntent(text: string, library: OutfitLibrary, outfits: readonly OutfitId[]): CharacterAction | null
