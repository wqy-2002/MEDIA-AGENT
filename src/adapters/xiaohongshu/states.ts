// 小红书页面状态定义。
// 这些状态来自真实 MCP 采样：默认视频页签、图文入口、文字配图编辑器、生成预览、最终表单。

export type XhsPublishState =
  | 'login_wall'
  | 'video_tab'
  | 'image_entry'
  | 'text_image_editor'
  | 'image_generating'
  | 'image_preview'
  | 'image_editing'
  | 'final_form'
  | 'publish_button_ready'
  | 'submit_confirm'
  | 'submitting'
  | 'success'
  | 'blocked'
  | 'unknown';

export type XhsDetailState =
  | 'login_wall'
  | 'feed_page'
  | 'detail_page'
  | 'detail_modal'
  | 'loading_detail'
  | 'like_ready'
  | 'liked'
  | 'favorite_ready'
  | 'favorited'
  | 'follow_ready'
  | 'followed'
  | 'comment_ready'
  | 'blocked'
  | 'unknown';

