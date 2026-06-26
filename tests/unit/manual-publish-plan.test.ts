import { describe, it, expect } from 'vitest';
import { buildManualPublishPlan } from '@/core/planner/manual-publish-plan';

describe('buildManualPublishPlan', () => {
  it('固定发布链路不含 generate_content', () => {
    const plan = buildManualPublishPlan('xiaohongshu');
    expect(plan.contentSource).toBe('manual');
    expect(plan.taskType).toBe('publish');
    expect(plan.platform).toBe('xiaohongshu');
    expect(plan.actions).not.toContain('generate_content');
    expect(plan.actions).toEqual([
      'check_login',
      'open_publish_page',
      'fill_title',
      'fill_body',
      'fill_hashtags',
      'submit_publish',
      'verify_result',
      'save_record',
    ]);
  });

  it('有素材时插入 upload_media', () => {
    const plan = buildManualPublishPlan('sohu', ['img-1', 'img-2']);
    expect(plan.actions).toContain('upload_media');
    expect(plan.actions.indexOf('upload_media')).toBeLessThan(
      plan.actions.indexOf('fill_title'),
    );
    expect(plan.materials?.images).toEqual(['img-1', 'img-2']);
  });

  it('无素材时不含 upload_media', () => {
    const plan = buildManualPublishPlan('xiaohongshu');
    expect(plan.actions).not.toContain('upload_media');
    expect(plan.materials).toBeUndefined();
  });
});
