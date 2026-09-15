// 通用数据回路（需求：前后端查表统一收口 + 主键索引 + 二级索引 + LRU 缓存 + query 算子）
// 复用既有 HERO_BY_ID / RELIC_BY_ID 等 Record 索引；为数组表（enemies/bosses）与 Record 表补建统一主键索引。
// 纯函数、零依赖、无 Math.random，可在 Node（parity/后端）与浏览器（Vite）共用，不破坏确定性契约。
import { HEROES } from './heroes';
import { ENEMIES, BOSSES } from './enemies';
import { RELICS } from './relics';
import { TRAITS } from './traits';
import { SUBCLASS_INFO, BODY_INFO } from './classes';
import { BUILDINGS } from './buildings';
import { CLIMB_STRATEGIES } from './climb';
import { CONSUMABLE_CFG } from './consumables';
import { AFFIX_POOL, RARITY_CFG } from './equipment';

type Row = Record<string, unknown>;
type Where = Record<string, unknown> | undefined;

interface QueryOpts {
  sort?: string;
  dir?: 1 | -1;
  limit?: number;
}

/** where 单字段匹配：支持等值，以及 $in/$nin/$ne/$gt/$gte/$lt/$lte 算子 */
function matchRow(row: Row, where: Where): boolean {
  if (!where) return true;
  for (const k of Object.keys(where)) {
    if (k.startsWith('$')) continue;
    const want = where[k];
    if (want && typeof want === 'object' && !(want instanceof Date) && !Array.isArray(want)) {
      const ops = want as Record<string, unknown>;
      for (const op of Object.keys(ops)) {
        const ov = ops[op];
        const rv = row[k];
        let ok = true;
        switch (op) {
          case '$in': ok = Array.isArray(ov) && (ov as unknown[]).includes(rv); break;
          case '$nin': ok = !(Array.isArray(ov) && (ov as unknown[]).includes(rv)); break;
          case '$ne': ok = rv !== ov; break;
          case '$gt': ok = (rv as number) > (ov as number); break;
          case '$gte': ok = (rv as number) >= (ov as number); break;
          case '$lt': ok = (rv as number) < (ov as number); break;
          case '$lte': ok = (rv as number) <= (ov as number); break;
          default: ok = rv === ov;
        }
        if (!ok) return false;
      }
    } else if (row[k] !== want) {
      return false;
    }
  }
  return true;
}

/** Record<Key, Def> → 带主键 key 的行数组（key 字段名为给定 pk） */
function fromRecord(rec: Record<string, unknown>, pk: string): Row[] {
  return Object.keys(rec).map((k) => ({ [pk]: k, ...(rec[k] as object) }));
}

class Table {
  readonly name: string;
  readonly pk: string;
  readonly rows: Row[];
  private byPk = new Map<unknown, Row>();
  constructor(name: string, pk: string, rows: Row[]) {
    this.name = name;
    this.pk = pk;
    this.rows = rows;
    for (const r of rows) this.byPk.set(r[pk], r);
  }
  get(id: unknown): Row | undefined {
    return this.byPk.get(id);
  }
  list(): Row[] {
    return this.rows;
  }
  query(where: Where, opts?: QueryOpts): Row[] {
    const res = this.rows.filter((r) => matchRow(r, where));
    if (opts?.sort) {
      const key = opts.sort;
      const dir = opts.dir ?? 1;
      res.sort((a, b) => {
        const av = a[key] as number | string;
        const bv = b[key] as number | string;
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }
    if (opts?.limit !== undefined) return res.slice(0, opts.limit);
    return res;
  }
}

/** LRU-ish 查询缓存：超上限即整体清空（简单、确定、无时钟依赖） */
class DBCore {
  private tables = new Map<string, Table>();
  private cache = new Map<string, Row[]>();
  private cacheMax = 512;

  register(name: string, pk: string, rows: Row[]): DBCore {
    this.tables.set(name, new Table(name, pk, rows));
    return this;
  }

  get(name: string, id: unknown): Row | undefined {
    return this.tables.get(name)?.get(id);
  }

  list(name: string): Row[] {
    return this.tables.get(name)?.list() ?? [];
  }

  query(name: string, where?: Where, opts?: QueryOpts): Row[] {
    const t = this.tables.get(name);
    if (!t) return [];
    const key = name + '|' + JSON.stringify(where ?? null) + '|' + JSON.stringify(opts ?? null);
    const hit = this.cache.get(key);
    if (hit) return hit;
    const res = t.query(where, opts);
    if (this.cache.size >= this.cacheMax) this.cache.clear();
    this.cache.set(key, res);
    return res;
  }

  clearCache(): void {
    this.cache.clear();
  }
}

/** 通用数据回路单例（前端 + 后端共用同一份注册表与查询语义） */
export const DB = new DBCore();

DB.register('heroes', 'id', HEROES as unknown as Row[])
  .register('enemies', 'id', ENEMIES as unknown as Row[])
  .register('bosses', 'id', BOSSES as unknown as Row[])
  .register('relics', 'id', RELICS as unknown as Row[])
  .register('traits', 'key', fromRecord(TRAITS as unknown as Record<string, unknown>, 'key'))
  .register('subclasses', 'key', fromRecord(SUBCLASS_INFO as unknown as Record<string, unknown>, 'key'))
  .register('bodies', 'key', fromRecord(BODY_INFO as unknown as Record<string, unknown>, 'key'))
  .register('buildings', 'key', fromRecord(BUILDINGS as unknown as Record<string, unknown>, 'key'))
  .register('climb', 'key', fromRecord(CLIMB_STRATEGIES as unknown as Record<string, unknown>, 'key'))
  .register('consumables', 'key', fromRecord(CONSUMABLE_CFG as unknown as Record<string, unknown>, 'key'))
  .register('affixes', 'key', fromRecord(AFFIX_POOL as unknown as Record<string, unknown>, 'key'))
  .register('rarities', 'key', fromRecord(RARITY_CFG as unknown as Record<string, unknown>, 'key'));
