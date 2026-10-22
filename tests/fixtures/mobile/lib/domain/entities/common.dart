enum Region { north, central, south }

/// Following scope requires a verified session; recommended is newest first.
enum FeedScope { recommended, following }

enum PropertyCategory { residential, industrial, agricultural, other }

enum LandType { residential, agricultural, other }

enum PropertyStatus { listed, paused, sold }

enum ApprovalStatus { pending, approved }

enum SourceBadge { boardSource, standard }

enum LegalStatus { verified, pending }

enum DocumentAccess { publicRedacted, authenticated, granted }

enum MediaKind { image, video }

enum AmenityCategory { utility, traffic, living }

enum BookingStatus {
  draft,
  awaitingDeposit,
  pendingConfirmation,
  confirmed,
  completed,
  expired,
  cancelRequested,
  cancelled,
  rescheduleRequested,
  rejected,
  noShow,
}

enum PaymentStatus {
  unpaid,
  pending,
  succeeded,
  failed,
  expired,
  needsReview,
  refundPending,
  refunded,
}

enum PaymentMode { disabled, simulation, live }

enum TransportMode { selfArranged, needsAssistance }

enum RepaymentMethod { equalInstallment, decliningBalance }

enum SupportKind {
  chat,
  legalReview,
  loanAdvice,
  consultantAppointment,
  locationInquiry,
}

enum SupportStatus { received, pending, responded, closed }

enum EventStatus { open, soldOut, closed, cancelled }

enum RegistrationStatus { pending, registered, cancelled }

enum PropertySort { relevant, newest, priceAsc, priceDesc, areaAsc }

enum AreaBand { below100, from100To200, above200 }

final class PageQuery {
  const PageQuery({this.cursor, this.limit = 20});
  final String? cursor;
  final int limit; // Runtime validation in data/server: 1..50.
}

final class Page<T> {
  const Page({
    required this.items,
    required this.hasMore,
    this.nextCursor,
    this.total,
  });
  final List<T> items;
  final bool hasMore;
  final String? nextCursor;
  final int? total;
}

final class MutationResult {
  const MutationResult({required this.active, this.count});
  final bool active;
  final int? count;
}

final class ShareLink {
  const ShareLink({required this.url, required this.title});
  final Uri url;
  final String title;
}

final class DownloadGrant {
  const DownloadGrant({
    required this.url,
    required this.expiresAt,
    required this.fileName,
    required this.mimeType,
    required this.sizeBytes,
  });
  final Uri url;
  final DateTime expiresAt;
  final String fileName;
  final String mimeType;
  final int sizeBytes;
}
