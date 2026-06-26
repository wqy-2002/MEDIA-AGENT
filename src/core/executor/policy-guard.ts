import type { AppSettings, TaskPlan } from '@/types';
import { countTodayByType, getLastSuccessfulPublishTime } from '@/core/storage/db';

export interface PolicyResult {
  allowed: boolean;
  reason?: string;
}

/**
 * 检查任务计划是否允许执行。
 * - 校验对应平台开关是否开启。
 * - 校验自动化动作开关（自动发布/评论/点赞/收藏/关注）。
 * - 校验单日频率限制。
 */
export async function checkPolicy(
  plan: TaskPlan,
  settings: AppSettings,
): Promise<PolicyResult> {
  // 平台开关
  if (!settings.platformSwitch[plan.platform]) {
    return { allowed: false, reason: `平台「${plan.platform}」已在设置中关闭` };
  }

  const a = settings.automation;
  // 自动化开关
  if (plan.actions.includes('submit_publish') && !a.autoPublish) {
    return { allowed: false, reason: '自动发布开关未开启，请在设置页开启「自动发布」' };
  }
  if (plan.actions.includes('submit_comment') && !a.autoComment) {
    return { allowed: false, reason: '自动评论开关未开启，请在设置页开启「自动评论」' };
  }
  if (plan.actions.includes('execute_like') && !a.autoLike) {
    return { allowed: false, reason: '自动点赞开关未开启' };
  }
  if (plan.actions.includes('execute_favorite') && !a.autoFavorite) {
    return { allowed: false, reason: '自动收藏开关未开启' };
  }
  if (plan.actions.includes('execute_follow') && !a.autoFollow) {
    return { allowed: false, reason: '自动关注开关未开启' };
  }

  // 单日频率限制
  if (plan.taskType === 'comment') {
    const count = await countTodayByType('comment');
    if (count >= settings.rateLimit.maxCommentsPerDay) {
      return {
        allowed: false,
        reason: `已达单日评论上限（${settings.rateLimit.maxCommentsPerDay} 次）`,
      };
    }
  }
  if (plan.taskType === 'like' || plan.taskType === 'favorite' || plan.taskType === 'follow') {
    const [likes, favorites, follows] = await Promise.all([
      countTodayByType('like'),
      countTodayByType('favorite'),
      countTodayByType('follow'),
    ]);
    const total = likes + favorites + follows;
    if (total >= settings.rateLimit.maxEngagementsPerDay) {
      return {
        allowed: false,
        reason: `已达单日互动上限（${settings.rateLimit.maxEngagementsPerDay} 次）`,
      };
    }
  }

  if (plan.taskType === 'publish') {
    const publishCount = await countTodayByType('publish', plan.platform);
    if (publishCount >= settings.rateLimit.maxPublishesPerDay) {
      return {
        allowed: false,
        reason: `已达单日发布上限（${settings.rateLimit.maxPublishesPerDay} 次）`,
      };
    }

    const lastFinishedAt = await getLastSuccessfulPublishTime(plan.platform);
    const minGapMs = settings.rateLimit.minMinutesBetweenPublishes * 60 * 1000;
    if (lastFinishedAt != null && minGapMs > 0) {
      const elapsed = Date.now() - lastFinishedAt;
      if (elapsed < minGapMs) {
        const remainMin = Math.ceil((minGapMs - elapsed) / 60000);
        return {
          allowed: false,
          reason: `距上次成功发布未满 ${settings.rateLimit.minMinutesBetweenPublishes} 分钟，请约 ${remainMin} 分钟后再试`,
        };
      }
    }
  }

  return { allowed: true };
}
