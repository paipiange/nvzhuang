import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://ai-portrait-gallery.pages.dev/';
const DATA_URL = `${BASE_URL}data/images.js`;
const THUMBS_DIR = path.resolve('assets/portrait/thumbs');

fs.mkdirSync(THUMBS_DIR, { recursive: true });

// 发型大类映射
const HAIR_MAP = {
  'ショート': { zh: '短发', en: 'Short' },
  'ミディアム': { zh: '中发', en: 'Medium' },
  'セミロング': { zh: '中长发', en: 'Semi-long' },
  'ロング': { zh: '长发', en: 'Long' },
  '未分類': { zh: '其他', en: 'Other' }
};

// 分类映射
const SECTION_MAP = {
  'face': { zh: '脸部特写', en: 'Face (Portrait)' },
  'styling': { zh: '整体造型', en: 'Styling (Full Body)' }
};

// 50种精细发型风格字典
const STYLE_MAP = {
  'くびれショート（襟足長め・シースルーバング）': { zh: '收腰微卷短发（长后颈·空气刘海）', en: 'Waisted short hair (longer nape, see-through bangs)' },
  'ウェットヘアの前髪長めショートボブ': { zh: '湿发感长刘海短波波头', en: 'Wet-look short bob with long bangs' },
  'ショートウルフ（ミニウルフ）': { zh: '短发狼尾碎发（迷你狼尾）', en: 'Short wolf cut (mini wolf)' },
  'スパイラルパーマショートボブ（黒髪）': { zh: '螺旋烫卷短波波头（黑发）', en: 'Spiral perm short bob (black hair)' },
  'ハイトーンミルクティーショートボブ': { zh: '高明度奶茶色短波波头', en: 'High-tone milk tea short bob' },
  'ハイライト入り丸みショート': { zh: '挑染层次圆润短发', en: 'Rounded short hair with highlights' },
  'マッシュショート（前髪長め）': { zh: '蘑菇头短发（长刘海）', en: 'Mush short cut with long bangs' },
  'ミニボブパーマ（くせ毛風）': { zh: '迷你波波头烫发（自然微卷风）', en: 'Mini bob perm (natural wave)' },
  'ミニボブ（オン眉ぱっつん前髪）': { zh: '齐耳迷你波波（眉上齐刘海）', en: 'Mini bob with above-eyebrow blunt bangs' },
  'レイヤーショートボブ（顔まわりレイヤー）': { zh: '修颜层次短波波头（脸颊碎发）', en: 'Layered short bob with face-framing layers' },
  '丸みショートボブ（シースルーバング・ダークブラウン）': { zh: '圆润短波波头（空气刘海·深棕色）', en: 'Rounded short bob (see-through bangs, dark brown)' },
  '内巻きワンカールボブ（ラベンダーアッシュ）': { zh: '内扣C卷短波波（薰衣草冷灰）', en: 'Inward one-curl bob (lavender ash)' },
  '切りっぱなしストレートボブ（前髪なし）': { zh: '一刀切垂顺直短发（无刘海）', en: 'Blunt cut straight bob (no bangs)' },
  '前下がりひし形ショートボブ（黒髪）': { zh: '前倾菱形修颜短波波（黑发）', en: 'A-line diamond short bob (black hair)' },
  '外ハネボブ（暗髪）': { zh: '微翘发尾波波头（深色发）', en: 'Outward flicked bob (dark hair)' },
  '耳掛けハンサムショート（前髪なし）': { zh: '挂耳帅气超短发（无刘海）', en: 'Tucked-behind-ear handsome short cut (no bangs)' },
  '韓国風タッセルボブ（サイドバング）': { zh: '韩系流苏一刀切波波头（八字刘海）', en: 'Korean tassel bob with side bangs' },
  '2wayバングのワンカールミディアムボブ': { zh: '两用刘海内扣C卷中发波波', en: 'One-curl medium bob with 2-way bangs' },
  'くびれボブ（インナーカラー）': { zh: '收腰波波头（耳圈挂耳染）', en: 'Waisted bob with inner color highlights' },
  'くるくるハードパーマミディアム': { zh: '复古羊毛卷中长发', en: 'Tight spiral perm medium hair' },
  'ぱっつん前髪のミディアムストレート': { zh: '齐刘海中长垂顺直发', en: 'Blunt bangs medium straight hair' },
  'ハイトーンミルクティーグレージュミディアム': { zh: '高光奶茶灰棕色中长发', en: 'High-tone milk tea greige medium hair' },
  'ハッシュカット（韓国ヘア）': { zh: '韩系碎层次碎发（Hash Cut）', en: 'Korean hush cut' },
  'バタフライカット（ヘーゼルカラー）': { zh: '蝴蝶层次碎发（榛果色）', en: 'Butterfly cut (hazel color)' },
  'バーガンディのシースルーレイヤー': { zh: '勃艮第酒红空气层次剪', en: 'Burgundy see-through layered hair' },
  'ミディアムウルフパーマ': { zh: '中发狼尾卷发烫', en: 'Medium wolf cut with perm' },
  'ミディアムニュアンスパーマ（コテ巻き風）': { zh: '中发慵懒微卷烫（电棒卷风）', en: 'Medium nuance perm (iron-curl style)' },
  'ミディアムレイヤー内巻きワンカール（まろベージュ）': { zh: '中发层次内扣C卷（柔和米灰）', en: 'Medium layered inward curl (mellow beige)' },
  'ロブレイヤー（ミントベージュ）': { zh: '长波波头层次剪（薄荷米灰）', en: 'Long bob layers (mint beige)' },
  '切りっぱなし外ハネミディアムボブ': { zh: '一刀切外翘中长波波头', en: 'Blunt outward flipped medium bob' },
  '前下がりミディアムボブ（マロンベージュ）': { zh: '前倾修颜中长波波（栗子米色）', en: 'A-line medium bob (chestnut beige)' },
  '艶さらストレートミディアムボブ（前髪なし）': { zh: '顺滑光泽直发中长波波（无刘海）', en: 'Glossy silky straight medium bob (no bangs)' },
  '重めミディアムレイヤー（バレイヤージュ）': { zh: '厚重中发层次渐变染（法式巴黎画染）', en: 'Heavy medium layers with balayage' },
  '鎖骨丈ミディアムレイヤーボブ（アッシュグレージュ）': { zh: '锁骨长度层次波波头（冷灰米棕）', en: 'Collarbone medium layered bob (ash greige)' },
  '2wayバングの韓国レイヤー': { zh: '两用刘海韩系高层次剪', en: 'Korean layered hair with 2-way bangs' },
  'くびれセミロング（透明感カラー）': { zh: '收腰中长微卷发（通透感发色）', en: 'Waisted semi-long hair (translucent color)' },
  'たっぷりレイヤー（ラベンダーグレージュ）': { zh: '丰富蓬松层次剪（薰衣草灰棕）', en: 'Abundant layers (lavender greige)' },
  'シースルーぱっつん前髪のシャギーレイヤー': { zh: '空气齐刘海羽毛碎发剪', en: 'Shaggy layers with see-through blunt bangs' },
  'スパイラルパーマ韓国風セミロング': { zh: '韩系螺旋卷中长发', en: 'Korean spiral perm semi-long hair' },
  'セミロングウルフ（チェリーレッド）': { zh: '中长发狼尾剪（车厘子红）', en: 'Semi-long wolf cut (cherry red)' },
  'セミロングストレート（前髪あり・暗髪）': { zh: '中长垂顺直发（带刘海·自然深发）', en: 'Semi-long straight hair (with bangs, dark hair)' },
  'セミロングニュアンスパーマ': { zh: '中长慵懒氛围微卷发', en: 'Semi-long nuance wavy perm' },
  'セミロング顔まわりレイヤー（ミルクティーベージュ）': { zh: '中长发修颜层次剪（奶茶米色）', en: 'Face-framing semi-long layers (milk tea beige)' },
  'セミロング黒髪ツヤレイヤー': { zh: '中长黑发光泽层次直发', en: 'Semi-long glossy black layered hair' },
  'ハイレイヤー×裾カラー（ブロンド）': { zh: '高层次剪×发尾拼色挑染（金发）', en: 'High layers with hem dip-dye (blonde)' },
  'ハッシュカット（グレージュ）': { zh: '韩系碎层次碎发（灰米棕）', en: 'Korean hush cut (greige color)' },
  'バタフライカット（ミントベージュ・シースルーバング）': { zh: '蝴蝶层次碎发（薄荷米色·空气刘海）', en: 'Butterfly cut (mint beige, see-through bangs)' },
  'ロングウルフ（クラゲヘア）': { zh: '长发水母头狼尾剪', en: 'Long wolf jellyfish cut' },
  'ワンカールレイヤーと後れ毛（ショコラブラウン）': { zh: 'C卷层次碎发配修颜龙须（巧克力棕）', en: 'One-curl layers with wispy tendrils (chocolate brown)' },
  '斜めバングのエアリーカール': { zh: '斜刘海轻盈空气大卷', en: 'Side-swept bangs with airy curls' }
};

async function fetchSourceData() {
  console.log('正在获取 AI 模特人像数据源:', DATA_URL);
  const res = await fetch(DATA_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} 获取失败`);
  const text = await res.text();

  const sandbox = {};
  new Function('window', text)(sandbox);
  if (!Array.isArray(sandbox.GALLERY_IMAGES)) {
    throw new Error('未找到 GALLERY_IMAGES 数组');
  }
  return sandbox.GALLERY_IMAGES;
}

async function downloadFile(url, destPath, retries = 3) {
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 500) return { skipped: true };
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      fs.writeFileSync(destPath, buffer);
      return { success: true };
    } catch (err) {
      if (attempt === retries) throw err;
      await new Promise(r => setTimeout(r, 400 * attempt));
    }
  }
}

async function runPool(items, concurrency, fn) {
  let index = 0;
  let finished = 0;
  const total = items.length;
  const workers = Array.from({ length: concurrency }, async () => {
    while (true) {
      const current = index++;
      if (current >= total) break;
      await fn(items[current], current, total);
      finished++;
      if (finished % 100 === 0 || finished === total) {
        process.stdout.write(`\r下载进度: ${finished}/${total} (${((finished / total) * 100).toFixed(1)}%)`);
      }
    }
  });
  await Promise.all(workers);
  console.log('\n下载任务完成！');
}

async function main() {
  const images = await fetchSourceData();
  console.log(`成功获取: 共 ${images.length} 张模特参考图数据`);

  const meta = {
    total: images.length,
    cats: ['短发', '中发', '中长发', '长发'],
    counts: {
      '短发': 0,
      '中发': 0,
      '中长发': 0,
      '长发': 0
    },
    sections: ['face', 'styling'],
    sectionCounts: { face: 0, styling: 0 }
  };

  const processedList = images.map(item => {
    const sec = item.section === 'styling' ? 'styling' : 'face';
    meta.sectionCounts[sec] = (meta.sectionCounts[sec] || 0) + 1;

    const hairInfo = HAIR_MAP[item.hair] || { zh: item.hair || '短发', en: item.hair || 'Short' };
    const hairZh = hairInfo.zh;
    if (meta.counts[hairZh] !== undefined) {
      meta.counts[hairZh]++;
    }

    const styleInfo = STYLE_MAP[item.style] || { zh: item.style || '', en: item.style || '' };
    const keywords = [
      hairZh, hairInfo.en, item.hair,
      SECTION_MAP[sec].zh, SECTION_MAP[sec].en, sec,
      styleInfo.zh, styleInfo.en, item.style
    ].filter(Boolean).join(' ');

    return {
      id: item.id,
      カテゴリ: hairZh,
      キーワード: keywords,
      サムネ: `portrait/thumbs/${item.id}.webp`,
      画像: `portrait/thumbs/${item.id}.webp`,
      原寸: `${BASE_URL}img/full/${item.id}.png`,
      isPortrait: true,
      sec: sec,
      secZh: SECTION_MAP[sec].zh,
      hair: item.hair,
      hairZh: hairZh,
      hairEn: hairInfo.en,
      style: item.style || '',
      styleZh: styleInfo.zh,
      styleEn: styleInfo.en,
      w: item.w || 1122,
      h: item.h || 1402
    };
  });

  const dataFileContent = `// AI-PORTRAIT-DB AI模特人脸与造型数据库 (CC0 1.0)
// Source: https://ai-portrait-gallery.pages.dev/ (by @agi_aibusi)
const META_PORTRAIT = ${JSON.stringify(meta)};
const D_PORTRAIT = ${JSON.stringify(processedList)};
`;

  fs.writeFileSync('data-portrait.js', dataFileContent, 'utf-8');
  console.log('已成功更新并优化本地数据文件: data-portrait.js');

  // 检查是否已有未下载的图片
  const missingTasks = [];
  for (const item of images) {
    const dest = path.join(THUMBS_DIR, `${item.id}.webp`);
    if (!fs.existsSync(dest) || fs.statSync(dest).size < 500) {
      missingTasks.push({
        url: `${BASE_URL}img/thumb/${item.id}.webp`,
        dest,
        id: item.id
      });
    }
  }

  if (missingTasks.length > 0) {
    console.log(`发现 ${missingTasks.length} 张待下载图片，开始并发下载...`);
    await runPool(missingTasks, 12, async (task) => {
      await downloadFile(task.url, task.dest);
    });
  } else {
    console.log('所有 1499 张模特缩略图均已在本地就绪！');
  }
}

main().catch(err => {
  console.error('执行失败:', err);
  process.exit(1);
});
