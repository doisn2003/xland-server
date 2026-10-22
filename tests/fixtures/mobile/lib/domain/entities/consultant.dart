// DRAFT v0.1; reviewed and locked by Agent A after B feedback.
import '../value_objects/decimal_value.dart';

final class Consultant {
  const Consultant({
    required this.id,
    required this.name,
    required this.role,
    required this.location,
    required this.isVerified,
    this.avatarUrl,
    this.coverUrl,
    required this.videoCount,
    required this.followerCount,
    this.rating,
    required this.isFollowing,
    this.nextAvailableAt,
    this.supportRecipientLabel,
    required this.isIllustrative,
  });
  final String id;
  final String name;
  final String role;
  final String location;
  final bool isVerified;
  final Uri? avatarUrl;
  final Uri? coverUrl;
  final int videoCount;
  final int followerCount;
  final DecimalValue? rating;
  final bool isFollowing;
  final DateTime? nextAvailableAt;
  final String? supportRecipientLabel;
  final bool isIllustrative;
}

final class ConsultantReview {
  const ConsultantReview({
    required this.id,
    required this.consultantId,
    required this.authorDisplayName,
    required this.rating,
    required this.text,
    required this.createdAt,
    required this.isIllustrative,
  });
  final String id;
  final String consultantId;
  final String authorDisplayName;
  final DecimalValue rating;
  final String text;
  final DateTime createdAt;
  final bool isIllustrative;
}
