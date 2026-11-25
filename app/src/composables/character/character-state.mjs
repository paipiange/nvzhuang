export const POSES = Object.freeze([
  { id: 'natural', label: '自然站姿' },
  { id: 'wave', label: '挥手打招呼' },
  { id: 'heart', label: '比心' },
  { id: 'peace', label: '俏皮剪刀手' },
  { id: 'sitting', label: '优雅坐姿' },
  { id: 'profile', label: '回眸侧身' },
].map(Object.freeze))

export const CHARACTERS = Object.freeze([
  { characterId: 'zhixia', displayName: '知夏', personaId: 'zhixia', voiceId: 'zhixia', faceId: 'f000a1c4200', outfitId: 'SPR-0001', outfitLibrary: 'real', poseId: 'natural', avatarModelId: 'zhixia-static', avatarType: 'static' },
  { characterId: 'linxi', displayName: '林溪', personaId: 'linxi', voiceId: 'linxi', faceId: 'f71f980dde3', outfitId: 'SPR-0002', outfitLibrary: 'anime', poseId: 'wave', avatarModelId: 'linxi-static', avatarType: 'static' },
].map(profile => Object.freeze({ ...profile, id: profile.characterId, label: profile.displayName })))

export function restoreCharacter(saved, faces, outfits) {
  const canonical = CHARACTERS.find(item => item.id === saved?.characterId) ?? CHARACTERS[0]
  const { id, label, ...profile } = canonical
  // The standalone studio previously saved these three fields under legacy names.
  if (!saved || (saved.characterId !== undefined && saved.characterId !== id))
    return profile
  const faceId = saved.faceId ?? saved.portraitId
  const outfitLibrary = saved.outfitLibrary ?? saved.library
  const poseId = saved.poseId ?? saved.pose
  return {
    ...profile,
    ...(faces.some(item => item.id === faceId) ? { faceId } : {}),
    ...(findOutfit(outfits, saved.outfitId, outfitLibrary) ? { outfitId: saved.outfitId, outfitLibrary } : {}),
    ...(POSES.some(item => item.id === poseId) ? { poseId } : {}),
  }
}

function findOutfit(outfits, id, library) {
  return (library === 'real' || library === 'anime') && outfits.find(item => item.id === id && item.library === library)
}

export function updateCharacter(profile, action, faces, outfits) {
  const { kind, id, library } = action
  if (kind === 'character') {
    const target = CHARACTERS.find(item => item.id === id)
    if (!target)
      return null
    if (id === profile.characterId)
      return profile
    const { id: _, label, ...next } = target
    return faces.some(item => item.id === next.faceId) && findOutfit(outfits, next.outfitId, next.outfitLibrary) ? next : null
  }
  if (kind === 'face' && faces.some(item => item.id === id))
    return id === profile.faceId ? profile : { ...profile, faceId: id }
  if (kind === 'outfit' && findOutfit(outfits, id, library))
    return id === profile.outfitId && library === profile.outfitLibrary ? profile : { ...profile, outfitId: id, outfitLibrary: library }
  if (kind === 'pose' && POSES.some(item => item.id === id))
    return id === profile.poseId ? profile : { ...profile, poseId: id }
  return null
}

export function parseCharacterIntent(text, library, outfits) {
  const command = text.trim().replace(/[。！!？?]$/, '')
  const outfit = /^换成\s*(?:(真人|二次元)\s*)?([A-Z]{3}-\d{4}|\d{1,4}\s*号)\s*衣服$/i.exec(command)
  if (outfit) {
    const selectedLibrary = outfit[1] === '真人' ? 'real' : outfit[1] === '二次元' ? 'anime' : library
    const id = outfit[2].endsWith('号')
      ? outfits.filter(item => item.library === selectedLibrary)[Number(outfit[2].slice(0, -1).trim()) - 1]?.id ?? ''
      : outfit[2].toUpperCase()
    return { kind: 'outfit', id, library: selectedLibrary }
  }
  const face = /^换成\s*([a-f0-9]{6,24})(?:\s*号)?\s*头像$/i.exec(command)
  if (face)
    return { kind: 'face', id: face[1].toLowerCase() }
  const pose = /^换成\s*([\p{Script=Han}a-z]{1,16})(?:\s*姿势)?$/iu.exec(command)
  if (pose) {
    const name = pose[1].replace(/姿势$/, '')
    const target = POSES.find(item => item.label === name || item.id === name.toLowerCase())
    if (target || command.endsWith('姿势'))
      return { kind: 'pose', id: target?.id ?? name }
  }
  const character = /^切换(?:角色)?(?:到|为)\s*([\p{Script=Han}a-z]{1,16})$/iu.exec(command)
  if (character)
    return { kind: 'character', id: CHARACTERS.find(item => item.label === character[1] || item.id === character[1].toLowerCase())?.id ?? character[1] }
  return null
}
