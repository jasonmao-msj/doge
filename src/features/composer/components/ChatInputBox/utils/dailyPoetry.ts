export type DailyPoetryExcerpt = {
  text: string;
  author: string;
  title: string;
};

export type DailyPoetryBannerSnapshot = {
  dateKey: string;
  displayText: string;
  isVisible: boolean;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;
const DAILY_POETRY_ORDER_SEED = 0xd06e2026;
const LOCAL_DATE_KEY_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export const DAILY_POETRY_EXCERPTS = [
  { text: '长风破浪会有时，直挂云帆济沧海。', author: '李白', title: '行路难' },
  { text: '会当凌绝顶，一览众山小。', author: '杜甫', title: '望岳' },
  { text: '欲穷千里目，更上一层楼。', author: '王之涣', title: '登鹳雀楼' },
  { text: '自古逢秋悲寂寥，我言秋日胜春朝。', author: '刘禹锡', title: '秋词' },
  { text: '沉舟侧畔千帆过，病树前头万木春。', author: '刘禹锡', title: '酬乐天扬州初逢席上见赠' },
  { text: '山重水复疑无路，柳暗花明又一村。', author: '陆游', title: '游山西村' },
  { text: '纸上得来终觉浅，绝知此事要躬行。', author: '陆游', title: '冬夜读书示子聿' },
  { text: '不畏浮云遮望眼，自缘身在最高层。', author: '王安石', title: '登飞来峰' },
  { text: '千磨万击还坚劲，任尔东西南北风。', author: '郑燮', title: '竹石' },
  { text: '两岸猿声啼不住，轻舟已过万重山。', author: '李白', title: '早发白帝城' },
  { text: '俱怀逸兴壮思飞，欲上青天揽明月。', author: '李白', title: '宣州谢朓楼饯别校书叔云' },
  { text: '大鹏一日同风起，扶摇直上九万里。', author: '李白', title: '上李邕' },
  { text: '春风得意马蹄疾，一日看尽长安花。', author: '孟郊', title: '登科后' },
  { text: '问渠那得清如许？为有源头活水来。', author: '朱熹', title: '观书有感' },
  { text: '谁道人生无再少？门前流水尚能西！', author: '苏轼', title: '浣溪沙' },
  { text: '竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。', author: '苏轼', title: '定风波' },
  { text: '但愿人长久，千里共婵娟。', author: '苏轼', title: '水调歌头' },
  { text: '野火烧不尽，春风吹又生。', author: '白居易', title: '赋得古原草送别' },
  { text: '行到水穷处，坐看云起时。', author: '王维', title: '终南别业' },
  { text: '落红不是无情物，化作春泥更护花。', author: '龚自珍', title: '己亥杂诗' },
  { text: '路漫漫其修远兮，吾将上下而求索。', author: '屈原', title: '离骚' },
  { text: '生当作人杰，死亦为鬼雄。', author: '李清照', title: '夏日绝句' },
  { text: '老骥伏枥，志在千里；烈士暮年，壮心不已。', author: '曹操', title: '龟虽寿' },
  { text: '刑天舞干戚，猛志固常在。', author: '陶渊明', title: '读山海经' },
  { text: '天生我材必有用，千金散尽还复来。', author: '李白', title: '将进酒' },
  { text: '莫愁前路无知己，天下谁人不识君。', author: '高适', title: '别董大' },
  { text: '洛阳亲友如相问，一片冰心在玉壶。', author: '王昌龄', title: '芙蓉楼送辛渐' },
  { text: '接天莲叶无穷碧，映日荷花别样红。', author: '杨万里', title: '晓出净慈寺送林子方' },
  { text: '忽如一夜春风来，千树万树梨花开。', author: '岑参', title: '白雪歌送武判官归京' },
  { text: '等闲识得东风面，万紫千红总是春。', author: '朱熹', title: '春日' },
] as const satisfies readonly DailyPoetryExcerpt[];

function assertValidDate(date: Date): void {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError('Daily poetry requires a valid date.');
  }
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function createSeededOrder(length: number, seed: number): readonly number[] {
  const order = Array.from({ length }, (_, index) => index);
  const random = createSeededRandom(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [order[index], order[swapIndex]] = [order[swapIndex], order[index]];
  }
  return order;
}

const DAILY_POETRY_ORDER = createSeededOrder(
  DAILY_POETRY_EXCERPTS.length,
  DAILY_POETRY_ORDER_SEED,
);

function getLocalDayOrdinal(date: Date): number {
  assertValidDate(date);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_IN_MS);
}

export function getLocalDateKey(date: Date): string {
  assertValidDate(date);
  const year = `${date.getFullYear()}`.padStart(4, '0');
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function getDailyPoetry(date: Date): DailyPoetryExcerpt {
  const dayIndex = positiveModulo(getLocalDayOrdinal(date), DAILY_POETRY_ORDER.length);
  return DAILY_POETRY_EXCERPTS[DAILY_POETRY_ORDER[dayIndex]];
}

export function formatDailyPoetryExcerpt(excerpt: DailyPoetryExcerpt): string {
  return `“${excerpt.text}” —— ${excerpt.author}《${excerpt.title}》`;
}

export function isDailyPoetryBannerDismissed(value: unknown, date: Date): boolean {
  return (
    typeof value === 'string' &&
    LOCAL_DATE_KEY_PATTERN.test(value) &&
    value === getLocalDateKey(date)
  );
}

export function createDailyPoetryBannerSnapshot(
  date: Date,
  dismissedDateValue: unknown,
): DailyPoetryBannerSnapshot {
  return {
    dateKey: getLocalDateKey(date),
    displayText: formatDailyPoetryExcerpt(getDailyPoetry(date)),
    isVisible: !isDailyPoetryBannerDismissed(dismissedDateValue, date),
  };
}
