// DRAFT v0.1; reviewed and locked by Agent A after B feedback.
import 'common.dart';
import '../value_objects/vnd.dart';
import 'property.dart';

final class AgendaItem {
  const AgendaItem({
    required this.startsAt,
    required this.title,
    this.description,
  });
  final DateTime startsAt;
  final String title;
  final String? description;
}

final class Speaker {
  const Speaker({
    required this.name,
    required this.role,
    this.avatarUrl,
    this.description,
  });
  final String name;
  final String role;
  final Uri? avatarUrl;
  final String? description;
}

final class EventBenefit {
  const EventBenefit({required this.title, required this.description});
  final String title;
  final String description;
}

final class XlandEvent {
  const XlandEvent({
    required this.id,
    required this.title,
    required this.tags,
    required this.media,
    required this.startsAt,
    required this.endsAt,
    required this.timeZone,
    required this.venueName,
    required this.address,
    required this.maxSlots,
    required this.remainingSlots,
    required this.durationMinutes,
    required this.ticketPriceVnd,
    required this.status,
    required this.agenda,
    required this.speakers,
    required this.benefits,
    required this.isSaved,
    required this.isIllustrative,
  });
  final String id;
  final String title;
  final List<String> tags;
  final List<MediaAsset> media;
  final DateTime startsAt;
  final DateTime endsAt;
  final String timeZone;
  final String venueName;
  final String address;
  final int maxSlots;
  final int remainingSlots;
  final int durationMinutes;
  final Vnd ticketPriceVnd;
  final EventStatus status;
  final List<AgendaItem> agenda;
  final List<Speaker> speakers;
  final List<EventBenefit> benefits;
  final bool isSaved;
  final bool isIllustrative;
}

final class EventRegistrationInput {
  const EventRegistrationInput({
    required this.eventId,
    required this.contactName,
    required this.contactPhone,
    required this.attendeeCount,
  });
  final String eventId;
  final String contactName;
  final String contactPhone;
  final int attendeeCount;
}

final class EventRegistration {
  const EventRegistration({
    required this.id,
    required this.eventId,
    required this.status,
    required this.attendeeCount,
    required this.ticketPriceVnd,
    required this.paymentMode,
    required this.notice,
    required this.createdAt,
  });
  final String id;
  final String eventId;
  final RegistrationStatus status;
  final int attendeeCount;
  final Vnd ticketPriceVnd;
  final PaymentMode paymentMode;
  final String notice;
  final DateTime createdAt;
}
