// Candidate v0.1 C-4 (A-07); pending B review and Agent A's final hash lock.
import 'dart:typed_data';

import 'common.dart';
import 'property.dart';

final class UserProfile {
  const UserProfile({
    required this.id,
    required this.displayName,
    this.avatarUrl,
    this.contactPhone,
    this.address,
    required this.contactVerified,
    required this.updatedAt,
  });
  final String id;
  final String displayName;
  final Uri? avatarUrl;
  final String? contactPhone;
  final String? address;
  final bool contactVerified;
  final DateTime updatedAt;
}

final class ProfileUpdate {
  const ProfileUpdate({
    this.displayName,
    this.avatarUrl,
    this.contactPhone,
    this.address,
    this.avatar,
    this.clearAddress = false,
    this.clearAvatar = false,
    this.clearContactPhone = false,
  });
  final String? displayName;
  final Uri? avatarUrl;
  final String? contactPhone;
  final String? address;
  final AvatarUpload? avatar;
  final bool clearAddress;
  final bool clearAvatar;
  final bool clearContactPhone;
}

final class AvatarUpload {
  const AvatarUpload({required this.bytes, required this.mimeType});
  final Uint8List bytes;
  final String mimeType;
}

final class UserSettings {
  const UserSettings({
    required this.notificationConsent,
    required this.locale,
    required this.timeZone,
    required this.feedAutoplay,
    required this.feedMutedByDefault,
    required this.updatedAt,
  });
  final bool notificationConsent;
  final String locale;
  final String timeZone;
  final bool feedAutoplay;
  final bool feedMutedByDefault;
  final DateTime updatedAt;
}

final class SettingsUpdate {
  const SettingsUpdate({
    this.notificationConsent,
    this.feedAutoplay,
    this.feedMutedByDefault,
  });
  final bool? notificationConsent;
  final bool? feedAutoplay;
  final bool? feedMutedByDefault;
}

final class Session {
  const Session({required this.profile, required this.expiresAt});
  final UserProfile profile;
  final DateTime expiresAt;
}

final class SignInInput {
  const SignInInput({required this.username, required this.password});
  final String username;
  final String password;
}

final class Club {
  const Club({
    required this.id,
    required this.title,
    required this.summary,
    required this.description,
    required this.regionLabel,
    required this.activities,
    required this.media,
    this.supportRecipientLabel,
    required this.isIllustrative,
  });
  final String id;
  final String title;
  final String summary;
  final String description;
  final String regionLabel;
  final List<String> activities;
  final List<MediaAsset> media;
  final String? supportRecipientLabel;
  final bool isIllustrative;
}

final class SupportRequestInput {
  const SupportRequestInput({
    required this.kind,
    this.propertyId,
    this.consultantId,
    required this.message,
    required this.contactName,
    required this.contactPhone,
    required this.consentToShareContact,
  });
  final SupportKind kind;
  final String? propertyId;
  final String? consultantId;
  final String message;
  final String contactName;
  final String contactPhone;
  final bool consentToShareContact;
}

final class SupportRequest {
  const SupportRequest({
    required this.id,
    required this.kind,
    required this.status,
    required this.recipientLabel,
    required this.notice,
    required this.createdAt,
  });
  final String id;
  final SupportKind kind;
  final SupportStatus status;
  final String recipientLabel;
  final String notice;
  final DateTime createdAt;
}
