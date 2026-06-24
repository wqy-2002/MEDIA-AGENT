import type { TaskStatus, TaskType } from '@/types';

// 状态与类型的中文展示标签，集中维护，便于 UI 复用。

export const STATUS_LABELS: Record<TaskStatus, string> = {
  created: '已创建',
  parsing: '解析任务中',
  planning: '生成计划中',
  checking_login: '检测登录中',
  waiting_login: '等待登录',
  waiting_verification: '等待验证',
  generating_content: '生成内容中',
  opening_page: '打开页面中',
  uploading_media: '上传素材中',
  filling_content: '填写内容中',
  submitting: '提交中',
  verifying_result: '校验结果中',
  success: '成功',
  failed: '失败',
  paused: '已暂停',
  cancelled: '已取消',
  retrying: '重试中',
};

export const TASK_TYPE_LABELS: Record<TaskType, string> = {
  publish: '发布',
  comment: '评论',
  like: '点赞',
  favorite: '收藏',
  follow: '关注',
};

/** 状态对应的徽标颜色（Tailwind class） */
export function statusColor(status: TaskStatus): string {
  switch (status) {
    case 'success':
      return 'bg-green-100 text-green-700';
    case 'failed':
      return 'bg-red-100 text-red-700';
    case 'cancelled':
      return 'bg-gray-100 text-gray-600';
    case 'waiting_login':
    case 'waiting_verification':
    case 'paused':
      return 'bg-amber-100 text-amber-700';
    default:
      return 'bg-brand-100 text-brand-700';
  }
}

/** 是否为等待用户处理的状态 */
export function isWaiting(status: TaskStatus): boolean {
  return status === 'waiting_login' || status === 'waiting_verification' || status === 'paused';
}

/** 是否为终态 */
export function isTerminal(status: TaskStatus): boolean {
  return status === 'success' || status === 'failed' || status === 'cancelled';
}
