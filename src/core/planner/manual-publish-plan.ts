import type { ActionName, PlatformName, TaskPlan } from '@/types';

/** 构建手动发布任务的固定执行计划（不调用 LLM） */
export function buildManualPublishPlan(
  platform: PlatformName,
  materialIds?: string[],
): TaskPlan {
  const hasMaterials = Boolean(materialIds?.length);
  const actions: ActionName[] = [
    'check_login',
    'open_publish_page',
  ];

  if (hasMaterials) {
    actions.push('upload_media');
  }

  actions.push('fill_title', 'fill_body', 'fill_hashtags', 'submit_publish', 'verify_result', 'save_record');

  return {
    taskType: 'publish',
    platform,
    contentType: hasMaterials ? 'note' : 'note',
    contentSource: 'manual',
    actions,
    ...(hasMaterials
      ? {
          materials: {
            images: materialIds,
          },
        }
      : {}),
  };
}
