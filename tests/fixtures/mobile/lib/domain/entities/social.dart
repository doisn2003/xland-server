// DRAFT v0.1; reviewed and locked by Agent A after B feedback.
import 'property.dart';

final class PublicAuthor {
  const PublicAuthor({
    required this.id,
    required this.displayName,
    this.role,
    this.avatarUrl,
    required this.isVerified,
    required this.isFollowing,
  });
  final String id;
  final String displayName;
  final String? role;
  final Uri? avatarUrl;
  final bool isVerified;
  final bool isFollowing;
}

final class AuthorProfile {
  const AuthorProfile({
    required this.author,
    required this.videoCount,
    required this.followerCount,
    this.consultantId,
    required this.isIllustrative,
  });
  final PublicAuthor author;
  final int videoCount;
  final int followerCount;
  final String? consultantId;
  final bool isIllustrative;
}

final class FeedVideo {
  const FeedVideo({
    required this.id,
    required this.propertyId,
    required this.author,
    required this.media,
    required this.caption,
    required this.approximateArea,
    required this.property,
    required this.likeCount,
    required this.commentCount,
    required this.viewCount,
    required this.isLiked,
    required this.isSaved,
    required this.publishedAt,
    required this.isIllustrative,
  });
  final String id;
  final String propertyId;
  final PublicAuthor author;
  final MediaAsset media;
  final String caption;
  final String approximateArea;
  final Property property;
  final int likeCount;
  final int commentCount;
  final int viewCount;
  final bool isLiked;
  final bool isSaved;
  final DateTime publishedAt;
  final bool isIllustrative;
}

final class VideoComment {
  const VideoComment({
    required this.id,
    required this.videoId,
    required this.author,
    required this.text,
    required this.createdAt,
    required this.canDelete,
  });
  final String id;
  final String videoId;
  final PublicAuthor author;
  final String text;
  final DateTime createdAt;
  final bool canDelete;
}
