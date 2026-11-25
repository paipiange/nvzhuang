import { MOCK_GARMENTS, MOCK_PORTRAITS } from '@/mock/data'
import { CHARACTERS } from './character-state.mjs'

export { CHARACTERS, POSES } from './character-state.mjs'

const GALLERY = 'https://paipiange.github.io/nvzhuang/assets'

export const FACES = Object.freeze([
  { id: CHARACTERS[0].faceId, label: '全身造型 · 知夏', src: `${GALLERY}/portrait/thumbs/${CHARACTERS[0].faceId}.webp` },
  ...MOCK_PORTRAITS.filter(item => /^[a-f0-9]{6,24}$/.test(item.id)).map(item => ({ id: item.id, label: item.name, src: `${GALLERY}/portrait/thumbs/${item.id}.webp` })),
].map(item => Object.freeze(item)))

const outfitCounts = { real: 0, anime: 0 }

export const OUTFITS = Object.freeze(MOCK_GARMENTS
  .filter(item => (item.library === 'real' || item.library === 'anime') && /^[A-Z]{3}-\d{4}$/.test(item.original_id))
  .map((item) => {
    const library = item.library
    const root = `${GALLERY}/${library === 'anime' ? 'anime/' : ''}`
    const number = ++outfitCounts[library]
    return Object.freeze({ id: item.original_id, label: `${library === 'anime' ? '二次元' : '真人'} ${number} 号 · ${item.title}`, library, src: `${root}thumbs/${item.original_id}.webp`, referenceSrc: `${root}img/${item.original_id}.webp` })
  }))
