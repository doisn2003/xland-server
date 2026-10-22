// DRAFT v0.1; reviewed and locked by Agent A after B feedback.
import 'common.dart';
import '../value_objects/vnd.dart';
import 'property.dart';

final class AvailabilitySlot {
  const AvailabilitySlot({
    required this.id,
    required this.propertyId,
    this.consultantId,
    required this.startsAt,
    required this.endsAt,
    required this.timeZone,
    required this.isAvailable,
    this.unavailableReason,
    required this.meetingArea,
    required this.maxAttendees,
  });
  final String id;
  final String propertyId;
  final String? consultantId;
  final DateTime startsAt;
  final DateTime endsAt;
  final String timeZone;
  final bool isAvailable;
  final String? unavailableReason;
  final ApproximateLocation meetingArea;
  final int maxAttendees;
}

final class BookingInput {
  const BookingInput({
    required this.propertyId,
    required this.slotId,
    this.sourceVideoId,
    required this.attendeeCount,
    required this.transportMode,
    required this.requestDocuments,
    required this.requestLoanAdvice,
    required this.contactName,
    required this.contactPhone,
    this.note,
  });
  final String propertyId;
  final String slotId;
  final String? sourceVideoId;
  final int attendeeCount;
  final TransportMode transportMode;
  final bool requestDocuments;
  final bool requestLoanAdvice;
  final String contactName;
  final String contactPhone;
  final String? note;
}

final class DepositPolicy {
  const DepositPolicy({
    required this.indicativeAmountVnd,
    this.policyVersion,
    this.chargeBasis,
    this.refundPolicyText,
    this.cancellationPolicyText,
    this.reschedulePolicyText,
    required this.livePaymentEnabled,
    required this.notice,
  });
  final Vnd indicativeAmountVnd;
  final String? policyVersion;
  final String? chargeBasis;
  final String? refundPolicyText;
  final String? cancellationPolicyText;
  final String? reschedulePolicyText;
  final bool livePaymentEnabled;
  final String notice;
}

final class BookingHistoryItem {
  const BookingHistoryItem({
    required this.id,
    required this.fromStatus,
    required this.toStatus,
    required this.occurredAt,
    required this.actorLabel,
    this.publicNote,
  });
  final String id;
  final BookingStatus fromStatus;
  final BookingStatus toStatus;
  final DateTime occurredAt;
  final String actorLabel;
  final String? publicNote;
}

final class Booking {
  const Booking({
    required this.id,
    required this.propertyId,
    this.sourceVideoId,
    this.consultantId,
    required this.slotId,
    required this.property,
    required this.requestedStartsAt,
    this.confirmedStartsAt,
    required this.timeZone,
    required this.proposedMeetingArea,
    this.confirmedMeetingLabel,
    required this.attendeeCount,
    required this.transportMode,
    required this.requestDocuments,
    required this.requestLoanAdvice,
    required this.contactName,
    required this.maskedContactPhone,
    required this.status,
    required this.paymentStatus,
    required this.depositPolicy,
    required this.history,
    required this.availableActions,
    required this.createdAt,
    required this.updatedAt,
    required this.isIllustrative,
  });
  final String id;
  final String propertyId;
  final String? sourceVideoId;
  final String? consultantId;
  final String slotId;
  final Property property;
  final DateTime requestedStartsAt;
  final DateTime? confirmedStartsAt;
  final String timeZone;
  final ApproximateLocation proposedMeetingArea;
  final String? confirmedMeetingLabel;
  final int attendeeCount;
  final TransportMode transportMode;
  final bool requestDocuments;
  final bool requestLoanAdvice;
  final String contactName;
  final String maskedContactPhone;
  final BookingStatus status;
  final PaymentStatus paymentStatus;
  final DepositPolicy depositPolicy;
  final List<BookingHistoryItem> history;
  final List<String> availableActions;
  final DateTime createdAt;
  final DateTime updatedAt;
  final bool isIllustrative;
}

final class PaymentInstructions {
  const PaymentInstructions({
    this.qrImageUrl,
    this.bankName,
    this.accountName,
    this.maskedAccountNumber,
    this.transferContent,
  });
  final Uri? qrImageUrl;
  final String? bankName;
  final String? accountName;
  final String? maskedAccountNumber;
  final String? transferContent;
}

final class PaymentRecord {
  const PaymentRecord({
    required this.id,
    required this.bookingId,
    this.amountVnd,
    required this.status,
    required this.mode,
    this.reference,
    this.expiresAt,
    this.receivedAt,
    this.instructions,
    this.policyVersion,
    required this.notice,
    required this.updatedAt,
  });
  final String id;
  final String bookingId;
  final Vnd? amountVnd;
  final PaymentStatus status;
  final PaymentMode mode;
  final String? reference;
  final DateTime? expiresAt;
  final DateTime? receivedAt;
  final PaymentInstructions? instructions;
  final String? policyVersion;
  final String notice;
  final DateTime updatedAt;
}

final class BookingChangeInput {
  const BookingChangeInput({required this.reason, this.requestedSlotId});
  final String reason;
  final String? requestedSlotId;
}
