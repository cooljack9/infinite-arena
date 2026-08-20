import { Gender } from '../types';
/**
 * 生成一个确定性随机姓名。
 * @param seed   种子（同 seed 必得同名，保证回放一致）
 * @param gender 性别（决定名用字池）
 * @param taken  已被占用的姓名（同队去重；撞名时换盐重摇，最多 64 次后接受重复）
 */
export declare function randomHeroName(seed: number, gender: Gender, taken?: Iterable<string>): string;
