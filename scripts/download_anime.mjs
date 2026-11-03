import fs from 'fs';
import path from 'path';

const BASE_URL = 'https://ai-costume-anime-gallery.pages.dev/';
const THUMBS_DIR = path.resolve('assets/anime/thumbs');
const IMG_DIR = path.resolve('assets/anime/img');

fs.mkdirSync(THUMBS_DIR, { recursive: true });
fs.mkdirSync(IMG_DIR, { recursive: true });

async function fetchPageData() {
  console.log('正在获取动漫图库网页数据...');
  const res = await fetch(BASE_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} 获取失败`);
  const html = await res.text();

  const metaMatch = html.match(/const META=([^;]+);/);
  const dMatch = html.match(/const D=(\[[\s\S]+?\]);\s*const PAGE/);
  if (!metaMatch || !dMatch) throw new Error('无法从页面解析 META 或 D 数据');

  const meta = JSON.parse(metaMatch[1]);
  const d = JSON.parse(dMatch[1]);
  return { meta, d };
}

async function downloadFile(url, destPath, retries = 3) {
  if (fs.existsSync(destPath)) {
    const stat = fs.statSync(destPath);
    if (stat.size > 0) return { skipped: true };
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
      await new Promise(r => setTimeout(r, 500 * attempt));
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
        process.stdout.write(`\r进度: ${finished}/${total} (${((finished / total) * 100).toFixed(1)}%)`);
      }
    }
  });
  await Promise.all(workers);
  console.log('\n全部完成！');
}

async function main() {
  const { meta, d } = await fetchPageData();
  console.log(`成功解析: 总计 ${d.length} 套服装数据`);

  // 生成 data-anime.js
  const animeD = d.map(item => ({
    id: item.id,
    カテゴリ: item.カテゴリ,
    キーワード: item.キーワード,
    サムネ: `anime/thumbs/${item.id}.webp`,
    画像: `anime/img/${item.id}.webp`,
    原寸: `${BASE_URL}png/${item.id}.png`
  }));

  const dataJsContent = `// COSTUME-ANIME-DB 动漫版服装数据
const META_ANIME = ${JSON.stringify(meta)};
const D_ANIME = ${JSON.stringify(animeD)};
`;
  fs.writeFileSync('data-anime.js', dataJsContent, 'utf-8');
  console.log('已生成并保存 data-anime.js');

  // 构建下载任务列表
  const tasks = [];
  for (const item of d) {
    tasks.push({
      url: `${BASE_URL}thumbs/${item.id}.webp`,
      dest: path.join(THUMBS_DIR, `${item.id}.webp`),
      type: 'thumb',
      id: item.id
    });
    tasks.push({
      url: `${BASE_URL}img/${item.id}.webp`,
      dest: path.join(IMG_DIR, `${item.id}.webp`),
      type: 'img',
      id: item.id
    });
  }

  console.log(`开始并发下载图片，共 ${tasks.length} 个文件...`);
  const startTime = Date.now();
  await runPool(tasks, 20, async (task) => {
    try {
      await downloadFile(task.url, task.dest);
    } catch (e) {
      console.error(`\n下载失败 [${task.id} ${task.type}]: ${e.message}`);
    }
  });
  console.log(`下载耗时: ${((Date.now() - startTime) / 1000).toFixed(1)} 秒`);
}

main().catch(console.error);
