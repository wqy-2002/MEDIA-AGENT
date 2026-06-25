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

