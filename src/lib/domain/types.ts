// ═══════════════════════════════════════════════════════════════
// NextTHUxk — 领域类型
// ═══════════════════════════════════════════════════════════════

/** 课程类型：必修/限选/任选/体育 */
export type Flag = 'bx' | 'xx' | 'rx' | 'ty';

/** 课程对象（池内行 / 搜索行，核心字段宽类型以兼容各数据源） */
export interface Course {
  code: string;
  seq: string;
  name: string;
  teacher?: string;
  teacherId?: string;
  time?: string;
  note?: string;
  xkTextNote?: string;
  credits?: number;
  attr?: string; // 必修/限选/任选（行内属性格 / 一级课表回填）
  group?: string;
  capacity?: number;
  remaining?: number;
  available?: boolean;
  selected?: boolean;
  isCandidate?: boolean;
  queue?: string;
  detailUrl?: string;
  courseFeature?: string;
  grade?: string;
  tongshiGroup?: string;
  gradCapacity?: number;
  gradRemaining?: number;
  typeCode?: string; // 006/008/007/ty
  typeLabel?: string;
  zy?: number; // 1/2/3
  flag?: Flag; // 草稿条目标记（预览行里存在）
  volRequired?: string;
  volElective?: string;
  volOptional?: string;
  volSports?: string;
  volCapacity?: number;
  volApplied?: number;
  department?: string;
  partial?: boolean; // 页签兜底行：元数据未全量补齐
  myPos?: number;
  queueTotal?: number;
  fromLevelTable?: boolean;
  _tbRef?: TbEntry | null;
  _scoreRef?: ScoreEntry | null; // 教务评教均分（校评，7 分制，行按 kch 唯一）
}

/** THU选课社区索引条目 */
export interface TbEntry {
  kcm: string;
  jsm: string;
  kkdw: string;
  sqid: string;
  tid: number | null;
  count: number;
  avg: number;
  nt?: string[];
}

/** 教务评教分数条目（校评，满分 7：avg=Σ(i×fsi)/Σfsi · count=Σfsi） */
export interface ScoreEntry {
  avg: number;
  count: number;
}

/** 草稿课程条目（快照字段，与 Course 子集同构） */
export interface DraftCourse {
  code: string;
  seq: string;
  name: string;
  teacher: string;
  time: string;
  note?: string;
  credits: number;
  flag: Flag;
  zy: number;
  baseFlag: Flag;
}

/** 草稿：命名课表方案快照（可直接编辑） */
export interface Draft {
  id: number;
  name: string;
  courses: DraftCourse[];
  createdAt: number;
}

/** 自定义时间占用（参与全部冲突检测） */
export interface ManualEvent {
  id: number;
  name: string;
  code: string;
  seq: string;
  day: number;
  begin: string;
  end: string;
  time: string;
  manual: true;
  credits: number;
}

/** 课余量行（队列阶段） */
export interface QueueDatum {
  code: string;
  seq: string;
  qCapacity: number;
  qRemaining: number;
  qQueue: number;
}

/** 志愿统计行（非队列阶段） */
export interface VolDatum {
  code: string;
  seq: string;
  department?: string;
  capacity: number;
  applied: number;
  volRequired?: string;
  volElective?: string;
  volOptional?: string;
  volSports?: string;
}

/** 培养方案课程 */
export interface PlanCourse {
  semester: string;
  code: string;
  name: string;
  attr: string;
  credits: number;
  group: string;
}

/** 服务端查询上下文 */
export interface Ctx {
  SEM: string;
  BASE: string;
  isZhjwxk: boolean;
  isZhjw: boolean;
  isWebvpn: boolean;
}

/** 服务端搜索返回 */
export interface ServerSearchResult {
  rows: Course[];
  page?: number;
  hasMore?: boolean;
  totalPages?: number;
  totalRows?: number;
  /** ok=有行 · empty=结果页但0行 · unknown=异常页 */
  pageKind: 'ok' | 'empty' | 'unknown';
  htmlHead?: string;
  viaTab?: boolean;
}

/** 学分级联模拟条目 */
export interface CreditSimItem {
  name: string;
  credits: number;
  flag?: Flag;
  zy?: number;
  liveProb: number | null;
  prob: number | null;
}

/** 概率结果 */
export interface ProbResult {
  prob: number;
  label: string;
  percentLabel?: string;
  ratioLabel?: string;
  color: string;
}
