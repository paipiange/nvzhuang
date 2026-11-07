import type { KnowledgeArticle, KnowledgeCategoryItem } from '@/types/knowledge'

export const KNOWLEDGE_CATEGORIES: KnowledgeCategoryItem[] = [
  {
    key: 'all',
    name: '全部知识',
    icon: '✦',
    desc: '系统化探索 AI 穿搭与生图全攻略',
  },
  {
    key: 'anime-guide',
    name: '二次元穿搭',
    icon: '🌸',
    desc: '1320 套二次元服饰风格与破壁穿搭',
  },
  {
    key: 'tryon-tips',
    name: '换装避坑秘籍',
    icon: '💡',
    desc: '高成功率虚拟试穿与人像光影融合',
  },
  {
    key: 'prompt-lexicon',
    name: '提示词词典',
    icon: '📖',
    desc: '中英双语画风、面料与正负向词库',
  },
  {
    key: 'pose-gallery',
    name: '姿势工坊联动',
    icon: '💃',
    desc: '搭配兄弟项目姿势库打造杂志级大片',
  },
  {
    key: 'models-workflow',
    name: '模型与工作流',
    icon: '⚙️',
    desc: '豆包 / Gemini / GPT / ComfyUI 选型实战',
  },
]

export const KNOWLEDGE_ARTICLES: KnowledgeArticle[] = [
  {
    id: 'kb-anime-style-guide',
    slug: 'anime-style-guide',
    title: '二次元穿搭图鉴与破壁指南：1320 套动漫服饰深度解析',
    subtitle: '打破次元壁！从甜美 Lolita、学院 JK 到机能赛博，让二次元衣橱跃然纸上',
    category: 'anime-guide',
    categoryZh: '二次元穿搭',
    readTime: '6 分钟',
    featured: true,
    coverImage: 'https://paipiange.github.io/nvzhuang/assets/anime/img/SPR-0001.webp',
    summary:
      '深入剖析拍片哥女装收录的 1320 套纯净二次元动漫服装，系统归纳 Lolita、JK 制服、未来机能、新国风与魔法幻想五大经典风格体系，传授真人神貌与二次元服装完美融合的“破次元”关键秘诀。',
    tags: ['二次元穿搭', 'Lolita', 'JK制服', '赛博机能', '破次元壁'],
    updatedAt: '2026-11-07',
    relatedGarmentIds: ['anime:SPR-0001', 'anime:SPR-0002', 'anime:SPR-0003'],
    sections: [
      {
        heading: '一、为什么需要专属的「二次元服装库」？',
        content: [
          '传统 AI 虚拟换装大多局限于真实拍摄的常服，遇到繁复的动漫华服往往会出现蕾丝糊成色块、褶皱失真、饱和度塌陷等问题。',
          '「拍片哥女装」专门收录了 1320 套人物不入镜的 2:3 纯服装图像。每套服装都经过精细的高光剪裁与动漫赛璐珞/插画级质感分层，保证换装大模型在特征提取时能够清晰捕获衣领、蝴蝶结、裙撑褶皱等精细结构。',
        ],
        highlight: '二次元纯服装图去除了真人背景杂讯，极大提升了 AI 提取形制线条与配色的纯净度。',
      },
      {
        heading: '二、五大高分二次元风格与搭配心法',
        content: [
          '1. 甜美与古典 Lolita (Lolita Fashion)：大裙摆与华丽蕾丝、层叠花边（Frills）是灵魂。AI 试衣时建议挑选发型偏丰盈（如双马尾、法式大波浪卷发）的模特，视觉重心更加平衡。',
          '2. 学院青春与 JK 体系：水手领、规整百褶短裙与日系领结。建议搭配清透齐刘海或元气短发，呈现纯正高校轻音少女感。',
          '3. 赛博霓虹与机能未来风 (Techwear / Cyberpunk)：反光织带、金属扣件与半透明战术风衣。这类风格非常适合搭配冷色调背景与干练利落的高马尾模特。',
          '4. 新国风与仙侠幻想：汉服改良云肩、对襟刺绣与飘逸挽纱。生图时搭配轻柔侧逆光，仙气感即刻拉满。',
          '5. 奇幻女仆与魔法少女：黑白高对比围裙、蓬蓬袖与猫耳发饰，适合明亮棚拍与高饱和插画渲染。',
        ],
        tips: [
          '二次元服饰换装时，若希望保留动漫插画质感，模型推荐优先选择火山豆包或配合特调二次元 Checkpoint 的 ComfyUI 工作流。',
          '若希望真人模特穿出“现实中真能穿的精致 Cosplay 质感”，推荐选用 Gemini 或 GPT Image 2 并启用写实面料增强词。',
        ],
      },
      {
        heading: '三、二次元生图高能提示词（可一键复制）',
        content: [
          '将以下精心调优的中英双语提示词加入到你的提示词输入框或工作流中，能显著提升服装细节表现力：',
        ],
        prompts: [
          {
            label: '二次元插画高级质感',
            zh: '二次元插画美学，大师级杰作，极其细腻的线条，赛璐珞上色，鲜艳灵动的动漫色盘',
            en: 'anime aesthetic, masterpiece, exceptionally detailed lineart, clean cel shading, vibrant anime color palette, 8k resolution',
            category: '画风质感',
          },
          {
            label: '甜美洛丽塔服饰细节',
            zh: '精致多层蕾丝荷叶边，蓬松褶皱裙摆，缎面蝴蝶结系带，精美刺绣细节，高光立体剪裁',
            en: 'intricate multi-layered lace frills, voluminous pleated skirt, satin ribbon bowties, delicate embroidery, crisp clothing details',
            category: '服饰细节',
          },
          {
            label: '轻快灵动氛围光影',
            zh: '柔和边缘光，微风吹拂衣摆飘逸，电影级柔光漫射，梦幻光斑',
            en: 'soft studio rim light, gentle breeze blowing fabric, cinematic diffuse lighting, dreamy bokeh sparkles',
            category: '光影氛围',
          },
        ],
        action: {
          text: '前往二次元专区挑衣服',
          type: 'gallery',
          payload: 'anime',
        },
      },
    ],
  },
  {
    id: 'kb-tryon-secrets',
    slug: 'tryon-secrets',
    title: 'AI 虚拟换装高成功率秘籍：从人像选择到光影融合',
    subtitle: '避开 90% 用户的换装翻车坑！模特选型、服饰贴合与防融衣技巧全解析',
    category: 'tryon-tips',
    categoryZh: '换装避坑秘籍',
    readTime: '5 分钟',
    featured: true,
    coverImage: 'https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0001.webp',
    summary:
      '为什么有时换装会出现融衣、肢体畸变或脸庞失真？本文全面总结自建后端与线上各大生图模型的实测经验，提供保姆级人像拍摄标准、AI 模特挑选诀窍与提示词调校指南。',
    tags: ['虚拟试穿', '避坑指南', '人像打光', 'AI模特选型', '图像生成技巧'],
    updatedAt: '2026-11-07',
    sections: [
      {
        heading: '一、人像照片挑选的「黄金三法则」',
        content: [
          '换装模型的底层逻辑是：识别人物原图的姿势骨骼与面部特征，再根据服装图做纹理遮罩形变贴合。输入人像的质量直接决定了 70% 的成片上限。',
          '1. 【姿态端正】：正面微侧 15° 的站立姿势成功率最高。尽量避免深度交叉双手、双手插袋遮挡胸前腹部，这会导致模型无法判断衣物下摆走向。',
          '2. 【原着装轻便】：拍摄自拍或选择模特时，原着装尽量为贴身白 T 恤、吊带或浅色打底。若原图穿着厚重羽绒服或复杂大风衣，模型容易把原衣物纹理与新裙装融合在一起产生“融衣”翻车。',
          '3. 【采光均匀】：使用明亮的自然漫反射光或环形补光灯，避免顶光造成的大面积死黑阴影。',
        ],
        highlight: '原图背景越干净（浅灰纯色墙面或极简居室），AI 对人物轮廓和衣物质感的提取越精准。',
      },
      {
        heading: '二、内置 1499 位 CC0 模特挑选窍门',
        content: [
          '无需担心没有合适自拍照！拍片哥女装完整本地化内置了 CC0 授权的 1499 位专业 AI 模特。',
          '挑选模特时，建议按服装领口与风格进行搭配：',
          '• 大圆领 / 抹胸 / 吊带裙：优先挑选盘发、波浪卷发或披肩长发的模特，锁骨线条更舒展。',
          '• 高领针织衫 / 西装大衣：搭配干练短发、丸子头或马尾辫，避免头发遮掩衣领细节。',
          '• 二次元 Lolita / JK 款：选择眼神灵动、妆造偏清透的年轻感模特，违和感降至最低。',
        ],
        tips: [
          '在试衣间中，点击「选AI模特」即可通过发型与风格标签秒级筛选 1499 位模特。',
          '默认已开启「保持面容相似度」开关，确保换装后依然是同一位主角。',
        ],
      },
      {
        heading: '三、万能防崩负向词库（Negative Prompts）',
        content: [
          '生图模型偶尔会出现“画多一只手”或“衣服花纹混成一团”的情况。将以下通用负向词填入提示词配置中，即可大幅降低错误率：',
        ],
        prompts: [
          {
            label: '通用防融衣与防畸变负向词',
            zh: '融衣，重叠衣物，畸形肢体，多余的手指，模糊失真，文字水印，面部走形',
            en: 'fused clothes, overlapping garments, deformed limbs, extra fingers, mutated hands, blurry textures, text, watermark, bad anatomy, distorted face',
            category: '负向提示词',
          },
        ],
        action: {
          text: '立刻前往 AI 试衣间体验',
          type: 'tryon',
        },
      },
    ],
  },
  {
    id: 'kb-prompt-lexicon',
    slug: 'prompt-lexicon',
    title: '二次元 vs 写实生图提示词宝典（中英双语词典）',
    subtitle: '调优你的 AI 灵感引擎！面料质感、光影镜头、二次元画风关键词一网打尽',
    category: 'prompt-lexicon',
    categoryZh: '提示词词典',
    readTime: '8 分钟',
    featured: true,
    coverImage: 'https://paipiange.github.io/nvzhuang/assets/anime/img/SPR-0002.webp',
    summary:
      '收录数百个高频高质量 AI 生图与换装关键词，覆盖二次元赛璐珞、顶级写实奢华面料、商业时尚摄影布光与构图控制，均提供中英双语对照，支持轻触一键复制。',
    tags: ['提示词词典', '二次元Prompt', '写实摄影', '材质面料', '一键复制'],
    updatedAt: '2026-11-07',
    sections: [
      {
        heading: '一、二次元风格关键词（Anime Styles）',
        content: [
          '想要动漫插画感还是轻小说插图质感？在提示词开头加上核心画风修饰语，能迅速锚定视觉基调：',
        ],
        prompts: [
          {
            label: '赛璐珞经典动漫画风',
            zh: '经典赛璐珞上色，清晰勾线，透亮高光，轻小说精美插画，新海诚唯美光影',
            en: 'cel shaded style, clean line art, luminous anime highlights, light novel illustration, Makoto Shinkai style lighting',
            category: '二次元风格',
          },
          {
            label: '唯美京都动画质感',
            zh: '京都动画风格，微风拂发，柔和色彩渐变，电影级精细景深，眼眸星光闪烁',
            en: 'Kyoto Animation style, hair flowing in gentle wind, pastel gradient tones, cinematic depth of field, detailed starry eyes',
            category: '二次元风格',
          },
          {
            label: '赛博朋克二次元都市',
            zh: '赛博霓虹动漫，全息投影光晕，雨夜倒影反光，高科技机能面料，强对比色彩',
            en: 'cyberpunk anime aesthetic, holographic neon glow, wet pavement reflections, futuristic techwear fabric, high contrast colors',
            category: '二次元风格',
          },
        ],
      },
      {
        heading: '二、高端写实服装面料词库（Fabric Textures）',
        content: [
          '写实换装最怕衣服发塑料反光。明确指定布料材质与编织纹理，AI 会自动渲染出细腻的重磅垂感与织物微绒毛：',
        ],
        prompts: [
          {
            label: '重磅法式粗花呢（小香风）',
            zh: '奢华粗花呢面料，金丝混纺交织，立体编织纹理，金属复古浮雕扣，精致滚边',
            en: 'luxurious heavy tweed fabric, metallic thread intertwining, tactile woven texture, vintage embossed gold buttons, tailored braided trim',
            category: '面料质感',
          },
          {
            label: '垂坠桑蚕丝雪纺',
            zh: '天然桑蚕丝雪纺，轻盈半透明飘逸感，哑光珍珠微光，微风褶皱流光溢彩',
            en: 'natural mulberry silk chiffon, ethereal semi-sheer drape, subtle pearlescent sheen, flowing ripple folds in breeze',
            category: '面料质感',
          },
          {
            label: '哑光小羊皮与风衣斜纹',
            zh: '细腻哑光小羊皮革，自然柔软皮纹折痕，精湛双明线车缝，重磅防风斜纹棉',
            en: 'supple matte lambskin leather, natural soft crease folds, exquisite double topstitching, heavy windproof twill cotton',
            category: '面料质感',
          },
        ],
      },
      {
        heading: '三、时尚大片摄影镜头与布光词库（Camera & Lighting）',
        content: [
          '商业型录出片的核心在于布光控制。使用以下摄影词可将画质提升至时尚杂志封面水准：',
        ],
        prompts: [
          {
            label: '时尚杂志棚拍光影',
            zh: 'Vogue 杂志封面级时尚型录，85mm 人像定焦镜头，柔光箱侧向漫射光，立体轮廓高光，胶片细腻颗粒感',
            en: 'Vogue editorial fashion photoshoot, 85mm portrait prime lens, f/1.8, softbox directional diffuse light, sculpted facial contour highlights, subtle film grain',
            category: '摄影布光',
          },
          {
            label: '落日黄金时刻户外采光',
            zh: '落日黄金时刻，温暖侧逆光勾勒人物发丝金边，自然温暖暖色温，城市街道梦幻虚化背景',
            en: 'golden hour sunset light, warm rim light outlining hair strands, natural warm color temperature, creamy urban street bokeh background',
            category: '摄影布光',
          },
        ],
      },
    ],
  },
  {
    id: 'kb-pose-coordination',
    slug: 'pose-coordination',
    title: '兄弟项目联动：AI 姿势参考工坊 × 女装换装双剑合璧',
    subtitle: '解锁神仙级出片玩法！从骨骼姿态、动作张力到服装版型完美协调',
    category: 'pose-gallery',
    categoryZh: '姿势工坊联动',
    readTime: '6 分钟',
    coverImage: 'https://paipiange.github.io/nvzhuang/assets/portraits/thumbs/PORTRAIT-0001.webp',
    summary:
      '探索拍片哥女装 2727 套服饰、1499 位模特与兄弟项目《AI 姿势参考与生图工坊》(ai-pose-gallery-zh) 的深度协同方案。手把手教你利用 ControlNet OpenPose 锁定灵动体态，搭配心动女装生成商业级画报。',
    tags: ['姿势工坊', 'OpenPose', 'ControlNet', '版型搭配', '模特体态'],
    updatedAt: '2026-11-07',
    sections: [
      {
        heading: '一、为什么姿势对穿搭效果至关重要？',
        content: [
          '在现实时尚摄影中，不同版型的服装必须搭配相应的身体姿态：',
          '• 优雅长裙需要延展挺拔的 S 型站姿来凸显腰臀比与裙摆垂坠。',
          '• 运动卫衣或 JK 百褶裙需要充满活力的跑动、回眸、微屈膝等动感姿态。',
          '• 宽松西装外套则适合双手插袋、单肩倚靠的松弛感与气场。',
          '兄弟项目《AI 姿势参考与生图工坊》收录了海量专业站姿、坐姿、动态透视与双人互动骨骼图，与拍片哥女装的服装图天然互补！',
        ],
        highlight: '通过姿势工坊确定骨骼框架，再用拍片哥女装挑选衣物材质，两相结合即可产出零崩坏的专业级成片。',
      },
      {
        heading: '二、三步联动神仙工作流',
        content: [
          '第 1 步【定姿势】：打开兄弟项目姿势图集，根据你想要的情绪（元气甜美、高冷御姐、都市通勤）挑选一张姿势参考图，导出骨骼图或 OpenPose 控制图。',
          '第 2 步【选服饰】：在拍片哥女装图库中挑选心仪的写实（1407套）或二次元（1320套）服装图，记录或下载高清 PNG。',
          '第 3 步【合力生图】：在 ComfyUI 或 WebUI 中，将姿势图连入 ControlNet (openpose)，将服装图连入 IP-Adapter 或 CatVTON 服装引导，一键生成兼具神仙骨相与顶级穿搭的大片！',
        ],
        tips: [
          '二次元动漫服装搭配微俯视或 45° 仰视的动态姿势，能极大强化“插画主角登场”的视觉震撼。',
        ],
        action: {
          text: '查看 AI 模特库寻找身姿灵感',
          type: 'models',
        },
      },
    ],
  },
  {
    id: 'kb-engine-comparison',
    slug: 'engine-comparison',
    title: '主流生图模型换装横评：Gemini / 豆包 / GPT Image 2 / ComfyUI',
    subtitle: '多维度实测！生成速度、人像一致性、二次元还原度与成本选型指南',
    category: 'models-workflow',
    categoryZh: '模型与工作流',
    readTime: '7 分钟',
    coverImage: 'https://paipiange.github.io/nvzhuang/assets/thumbs/SPR-0004.webp',
    summary:
      '不知道该用哪个模型换装？本文横向测评了拍片哥女装接入的四大主流引擎：Gemini、火山豆包、GPT Image 2 与本地 ComfyUI，详细拆解各大模型的特色、适用场景与提示词策略。',
    tags: ['模型测评', '豆包', 'Gemini', 'GPT-Image', 'ComfyUI', '成本与性能'],
    updatedAt: '2026-11-07',
    sections: [
      {
        heading: '一、四大引擎横向综合对比表',
        content: [
          '• 火山豆包 (Doubao SeedEdit)：国内直连，响应最快（通常 5~10 秒）。对中文提示词理解极佳，二次元动漫服饰与写实服装均能稳定出图，日常高频换装首选。',
          '• Gemini (Nano Banana 2)：人像结构还原度高，面部神采自然，光影过渡细腻。在写实服装与通勤穿搭表现尤为惊艳。',
          '• GPT Image 2：具备极强的指令遵循能力，服装细节与小饰品（耳坠、皮带扣、领花）刻画到位。系统已自动内置防封控安全提示词，以端庄商用型录风格稳定输出。',
          '• ComfyUI (本地私有化)：极客玩家首选，支持 CatVTON / IDM-VTON 与任意自选 LoRA，零 API 消耗，完全保护人像隐私。',
        ],
      },
      {
        heading: '二、风格选型推荐指南',
        content: [
          '1. 【二次元动漫穿搭换装】：推荐 豆包 或 本地 ComfyUI（加载二次元 checkpoint 如 Anything / Counterfeit）。',
          '2. 【写实名媛与通勤型录】：推荐 Gemini 或 GPT Image 2，成片质感媲美天猫大牌旗舰店精修实拍。',
          '3. 【低配设备与极速预览】：推荐 豆包 或 本地 Mock 模式，随时随地秒级出图体验。',
        ],
        action: {
          text: '在设置中配置你的模型引擎',
          type: 'external',
          payload: '/pages/mine/settings',
        },
      },
    ],
  },
  {
    id: 'kb-comfyui-setup',
    slug: 'comfyui-setup',
    title: 'ComfyUI 本地私有化换装工作流搭建全攻略',
    subtitle: '极客专属！利用 CatVTON / IDM-VTON 与 ControlNet 实现零成本批量试穿',
    category: 'models-workflow',
    categoryZh: '模型与工作流',
    readTime: '9 分钟',
    coverImage: 'https://paipiange.github.io/nvzhuang/assets/anime/img/SPR-0003.webp',
    summary:
      '手把手教你在个人显卡电脑上部署 ComfyUI 虚拟换装节点，将拍片哥女装 2727 套 2:3 原图无缝载入工作流，实现完全离线、零 API 成本的高清服装迁移。',
    tags: ['ComfyUI', 'CatVTON', 'IDM-VTON', '本地部署', '隐私安全'],
    updatedAt: '2026-11-07',
    sections: [
      {
        heading: '一、必备节点与环境要求',
        content: [
          '硬件建议：NVIDIA 显卡（显存 8GB 以上，12GB+ 体验更佳）。',
          '核心节点推荐：',
          '1. ComfyUI-CatVTON 或 ComfyUI-IDM-VTON：目前开源界表现最顶级的虚拟试穿算法，能极高精度地将服装形变贴合至人体。',
          '2. ComfyUI_LayerStyle：用于前景与背景图层的光影无缝重融与边缘羽化。',
          '3. ControlNet OpenPose：保持人物骨骼姿势分毫不差。',
        ],
        highlight: '拍片哥女装提供人物不入镜的 2:3 原图，正是虚拟换装算法最渴望的高纯度衣物参考源。',
      },
      {
        heading: '二、工作流搭建核心连线逻辑',
        content: [
          '第一步：Load Image 节点加载真人或 AI 模特照片，通过 Segment Anything 或 Mask 节点圈出需要替换的衣物区域。',
          '第二步：Load Image 节点载入拍片哥女装服饰原图，送入 CatVTON 节点的 garment_image 输入端。',
          '第三步：连接 KSampler，步数设为 25~30，CFG 设为 2.5~3.5，选择 DPM++ 2M Karras 采样器。',
          '第四步：输出图像接入 Face Detailer 进行面容精修，成片惊艳度提升 200%！',
        ],
      },
    ],
  },
]

export function getKnowledgeArticles(category: string = 'all'): KnowledgeArticle[] {
  if (!category || category === 'all') {
    return KNOWLEDGE_ARTICLES
  }
  return KNOWLEDGE_ARTICLES.filter(item => item.category === category)
}

export function getKnowledgeArticleById(id: string): KnowledgeArticle | undefined {
  return KNOWLEDGE_ARTICLES.find(item => item.id === id || item.slug === id)
}

export function getFeaturedKnowledgeArticles(): KnowledgeArticle[] {
  return KNOWLEDGE_ARTICLES.filter(item => item.featured)
}
