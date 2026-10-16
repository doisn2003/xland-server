ALTER POLICY comment_read ON xland.video_comments USING(deleted_at IS NULL OR author_id=xland.current_user_id());
