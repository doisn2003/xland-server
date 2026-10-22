// Generated from the locked domain. Run node tool/generate_wire_mappers.mjs after reviewed model changes.
import '../../domain/xland_domain.dart';
import 'wire_values.dart';

Map<String, Object?> wireObject(Object? value) {
  if (value is! Map<String, Object?>) {
    throw const FormatException('Expected object');
  }
  return value;
}

Object? wireField(Map<String, Object?> value, String key) {
  if (!value.containsKey(key)) {
    throw FormatException('Missing field: $key');
  }
  return value[key];
}

String wireString(Object? value) {
  if (value is! String) {
    throw const FormatException('Expected string');
  }
  return value;
}

int wireInt(Object? value) {
  if (value is! int || value < 0 || value > 9007199254740991) {
    throw const FormatException('Expected nonnegative safe integer');
  }
  return value;
}

bool wireBool(Object? value) {
  if (value is! bool) {
    throw const FormatException('Expected boolean');
  }
  return value;
}

double wireDouble(Object? value) {
  if (value is! num || !value.isFinite) {
    throw const FormatException('Expected finite number');
  }
  return value.toDouble();
}

Uri wireUri(Object? value) {
  final uri = Uri.parse(wireString(value));
  if (uri.scheme != 'https' || uri.host.isEmpty) {
    throw const FormatException('Expected HTTPS URL');
  }
  return uri;
}

T? wireNullable<T>(Object? value, T Function(Object?) map) =>
    value == null ? null : map(value);
List<T> wireList<T>(Object? value, T Function(Object?) map) {
  if (value is! List<Object?>) {
    throw const FormatException('Expected list');
  }
  return List.unmodifiable(value.map(map));
}

Region mapRegion(Object? value) {
  switch (value) {
    case 'north':
      return Region.north;
    case 'central':
      return Region.central;
    case 'south':
      return Region.south;
    default:
      throw const FormatException('Unknown Region');
  }
}

String writeRegion(Region value) => switch (value) {
  Region.north => 'north',
  Region.central => 'central',
  Region.south => 'south',
};
FeedScope mapFeedScope(Object? value) {
  switch (value) {
    case 'recommended':
      return FeedScope.recommended;
    case 'following':
      return FeedScope.following;
    default:
      throw const FormatException('Unknown FeedScope');
  }
}

String writeFeedScope(FeedScope value) => switch (value) {
  FeedScope.recommended => 'recommended',
  FeedScope.following => 'following',
};
PropertyCategory mapPropertyCategory(Object? value) {
  switch (value) {
    case 'residential':
      return PropertyCategory.residential;
    case 'industrial':
      return PropertyCategory.industrial;
    case 'agricultural':
      return PropertyCategory.agricultural;
    case 'other':
      return PropertyCategory.other;
    default:
      throw const FormatException('Unknown PropertyCategory');
  }
}

String writePropertyCategory(PropertyCategory value) => switch (value) {
  PropertyCategory.residential => 'residential',
  PropertyCategory.industrial => 'industrial',
  PropertyCategory.agricultural => 'agricultural',
  PropertyCategory.other => 'other',
};
LandType mapLandType(Object? value) {
  switch (value) {
    case 'residential':
      return LandType.residential;
    case 'agricultural':
      return LandType.agricultural;
    case 'other':
      return LandType.other;
    default:
      throw const FormatException('Unknown LandType');
  }
}

String writeLandType(LandType value) => switch (value) {
  LandType.residential => 'residential',
  LandType.agricultural => 'agricultural',
  LandType.other => 'other',
};
PropertyStatus mapPropertyStatus(Object? value) {
  switch (value) {
    case 'listed':
      return PropertyStatus.listed;
    case 'paused':
      return PropertyStatus.paused;
    case 'sold':
      return PropertyStatus.sold;
    default:
      throw const FormatException('Unknown PropertyStatus');
  }
}

String writePropertyStatus(PropertyStatus value) => switch (value) {
  PropertyStatus.listed => 'listed',
  PropertyStatus.paused => 'paused',
  PropertyStatus.sold => 'sold',
};
ApprovalStatus mapApprovalStatus(Object? value) {
  switch (value) {
    case 'pending':
      return ApprovalStatus.pending;
    case 'approved':
      return ApprovalStatus.approved;
    default:
      throw const FormatException('Unknown ApprovalStatus');
  }
}

String writeApprovalStatus(ApprovalStatus value) => switch (value) {
  ApprovalStatus.pending => 'pending',
  ApprovalStatus.approved => 'approved',
};
SourceBadge mapSourceBadge(Object? value) {
  switch (value) {
    case 'board_source':
      return SourceBadge.boardSource;
    case 'standard':
      return SourceBadge.standard;
    default:
      throw const FormatException('Unknown SourceBadge');
  }
}

String writeSourceBadge(SourceBadge value) => switch (value) {
  SourceBadge.boardSource => 'board_source',
  SourceBadge.standard => 'standard',
};
LegalStatus mapLegalStatus(Object? value) {
  switch (value) {
    case 'verified':
      return LegalStatus.verified;
    case 'pending':
      return LegalStatus.pending;
    default:
      throw const FormatException('Unknown LegalStatus');
  }
}

String writeLegalStatus(LegalStatus value) => switch (value) {
  LegalStatus.verified => 'verified',
  LegalStatus.pending => 'pending',
};
DocumentAccess mapDocumentAccess(Object? value) {
  switch (value) {
    case 'public_redacted':
      return DocumentAccess.publicRedacted;
    case 'authenticated':
      return DocumentAccess.authenticated;
    case 'granted':
      return DocumentAccess.granted;
    default:
      throw const FormatException('Unknown DocumentAccess');
  }
}

String writeDocumentAccess(DocumentAccess value) => switch (value) {
  DocumentAccess.publicRedacted => 'public_redacted',
  DocumentAccess.authenticated => 'authenticated',
  DocumentAccess.granted => 'granted',
};
MediaKind mapMediaKind(Object? value) {
  switch (value) {
    case 'image':
      return MediaKind.image;
    case 'video':
      return MediaKind.video;
    default:
      throw const FormatException('Unknown MediaKind');
  }
}

String writeMediaKind(MediaKind value) => switch (value) {
  MediaKind.image => 'image',
  MediaKind.video => 'video',
};
AmenityCategory mapAmenityCategory(Object? value) {
  switch (value) {
    case 'utility':
      return AmenityCategory.utility;
    case 'traffic':
      return AmenityCategory.traffic;
    case 'living':
      return AmenityCategory.living;
    default:
      throw const FormatException('Unknown AmenityCategory');
  }
}

String writeAmenityCategory(AmenityCategory value) => switch (value) {
  AmenityCategory.utility => 'utility',
  AmenityCategory.traffic => 'traffic',
  AmenityCategory.living => 'living',
};
BookingStatus mapBookingStatus(Object? value) {
  switch (value) {
    case 'draft':
      return BookingStatus.draft;
    case 'awaiting_deposit':
      return BookingStatus.awaitingDeposit;
    case 'pending_confirmation':
      return BookingStatus.pendingConfirmation;
    case 'confirmed':
      return BookingStatus.confirmed;
    case 'completed':
      return BookingStatus.completed;
    case 'expired':
      return BookingStatus.expired;
    case 'cancel_requested':
      return BookingStatus.cancelRequested;
    case 'cancelled':
      return BookingStatus.cancelled;
    case 'reschedule_requested':
      return BookingStatus.rescheduleRequested;
    case 'rejected':
      return BookingStatus.rejected;
    case 'no_show':
      return BookingStatus.noShow;
    default:
      throw const FormatException('Unknown BookingStatus');
  }
}

String writeBookingStatus(BookingStatus value) => switch (value) {
  BookingStatus.draft => 'draft',
  BookingStatus.awaitingDeposit => 'awaiting_deposit',
  BookingStatus.pendingConfirmation => 'pending_confirmation',
  BookingStatus.confirmed => 'confirmed',
  BookingStatus.completed => 'completed',
  BookingStatus.expired => 'expired',
  BookingStatus.cancelRequested => 'cancel_requested',
  BookingStatus.cancelled => 'cancelled',
  BookingStatus.rescheduleRequested => 'reschedule_requested',
  BookingStatus.rejected => 'rejected',
  BookingStatus.noShow => 'no_show',
};
PaymentStatus mapPaymentStatus(Object? value) {
  switch (value) {
    case 'unpaid':
      return PaymentStatus.unpaid;
    case 'pending':
      return PaymentStatus.pending;
    case 'succeeded':
      return PaymentStatus.succeeded;
    case 'failed':
      return PaymentStatus.failed;
    case 'expired':
      return PaymentStatus.expired;
    case 'needs_review':
      return PaymentStatus.needsReview;
    case 'refund_pending':
      return PaymentStatus.refundPending;
    case 'refunded':
      return PaymentStatus.refunded;
    default:
      throw const FormatException('Unknown PaymentStatus');
  }
}

String writePaymentStatus(PaymentStatus value) => switch (value) {
  PaymentStatus.unpaid => 'unpaid',
  PaymentStatus.pending => 'pending',
  PaymentStatus.succeeded => 'succeeded',
  PaymentStatus.failed => 'failed',
  PaymentStatus.expired => 'expired',
  PaymentStatus.needsReview => 'needs_review',
  PaymentStatus.refundPending => 'refund_pending',
  PaymentStatus.refunded => 'refunded',
};
PaymentMode mapPaymentMode(Object? value) {
  switch (value) {
    case 'disabled':
      return PaymentMode.disabled;
    case 'simulation':
      return PaymentMode.simulation;
    case 'live':
      return PaymentMode.live;
    default:
      throw const FormatException('Unknown PaymentMode');
  }
}

String writePaymentMode(PaymentMode value) => switch (value) {
  PaymentMode.disabled => 'disabled',
  PaymentMode.simulation => 'simulation',
  PaymentMode.live => 'live',
};
TransportMode mapTransportMode(Object? value) {
  switch (value) {
    case 'self_arranged':
      return TransportMode.selfArranged;
    case 'needs_assistance':
      return TransportMode.needsAssistance;
    default:
      throw const FormatException('Unknown TransportMode');
  }
}

String writeTransportMode(TransportMode value) => switch (value) {
  TransportMode.selfArranged => 'self_arranged',
  TransportMode.needsAssistance => 'needs_assistance',
};
RepaymentMethod mapRepaymentMethod(Object? value) {
  switch (value) {
    case 'equal_installment':
      return RepaymentMethod.equalInstallment;
    case 'declining_balance':
      return RepaymentMethod.decliningBalance;
    default:
      throw const FormatException('Unknown RepaymentMethod');
  }
}

String writeRepaymentMethod(RepaymentMethod value) => switch (value) {
  RepaymentMethod.equalInstallment => 'equal_installment',
  RepaymentMethod.decliningBalance => 'declining_balance',
};
SupportKind mapSupportKind(Object? value) {
  switch (value) {
    case 'chat':
      return SupportKind.chat;
    case 'legal_review':
      return SupportKind.legalReview;
    case 'loan_advice':
      return SupportKind.loanAdvice;
    case 'consultant_appointment':
      return SupportKind.consultantAppointment;
    case 'location_inquiry':
      return SupportKind.locationInquiry;
    default:
      throw const FormatException('Unknown SupportKind');
  }
}

String writeSupportKind(SupportKind value) => switch (value) {
  SupportKind.chat => 'chat',
  SupportKind.legalReview => 'legal_review',
  SupportKind.loanAdvice => 'loan_advice',
  SupportKind.consultantAppointment => 'consultant_appointment',
  SupportKind.locationInquiry => 'location_inquiry',
};
SupportStatus mapSupportStatus(Object? value) {
  switch (value) {
    case 'received':
      return SupportStatus.received;
    case 'pending':
      return SupportStatus.pending;
    case 'responded':
      return SupportStatus.responded;
    case 'closed':
      return SupportStatus.closed;
    default:
      throw const FormatException('Unknown SupportStatus');
  }
}

String writeSupportStatus(SupportStatus value) => switch (value) {
  SupportStatus.received => 'received',
  SupportStatus.pending => 'pending',
  SupportStatus.responded => 'responded',
  SupportStatus.closed => 'closed',
};
EventStatus mapEventStatus(Object? value) {
  switch (value) {
    case 'open':
      return EventStatus.open;
    case 'sold_out':
      return EventStatus.soldOut;
    case 'closed':
      return EventStatus.closed;
    case 'cancelled':
      return EventStatus.cancelled;
    default:
      throw const FormatException('Unknown EventStatus');
  }
}

String writeEventStatus(EventStatus value) => switch (value) {
  EventStatus.open => 'open',
  EventStatus.soldOut => 'sold_out',
  EventStatus.closed => 'closed',
  EventStatus.cancelled => 'cancelled',
};
RegistrationStatus mapRegistrationStatus(Object? value) {
  switch (value) {
    case 'pending':
      return RegistrationStatus.pending;
    case 'registered':
      return RegistrationStatus.registered;
    case 'cancelled':
      return RegistrationStatus.cancelled;
    default:
      throw const FormatException('Unknown RegistrationStatus');
  }
}

String writeRegistrationStatus(RegistrationStatus value) => switch (value) {
  RegistrationStatus.pending => 'pending',
  RegistrationStatus.registered => 'registered',
  RegistrationStatus.cancelled => 'cancelled',
};
PropertySort mapPropertySort(Object? value) {
  switch (value) {
    case 'relevant':
      return PropertySort.relevant;
    case 'newest':
      return PropertySort.newest;
    case 'price_asc':
      return PropertySort.priceAsc;
    case 'price_desc':
      return PropertySort.priceDesc;
    case 'area_asc':
      return PropertySort.areaAsc;
    default:
      throw const FormatException('Unknown PropertySort');
  }
}

String writePropertySort(PropertySort value) => switch (value) {
  PropertySort.relevant => 'relevant',
  PropertySort.newest => 'newest',
  PropertySort.priceAsc => 'price_asc',
  PropertySort.priceDesc => 'price_desc',
  PropertySort.areaAsc => 'area_asc',
};
AreaBand mapAreaBand(Object? value) {
  switch (value) {
    case 'below_100':
      return AreaBand.below100;
    case 'from_100_to_200':
      return AreaBand.from100To200;
    case 'above_200':
      return AreaBand.above200;
    default:
      throw const FormatException('Unknown AreaBand');
  }
}

String writeAreaBand(AreaBand value) => switch (value) {
  AreaBand.below100 => 'below_100',
  AreaBand.from100To200 => 'from_100_to_200',
  AreaBand.above200 => 'above_200',
};

MutationResult mapMutationResult(Object? input) {
  final value = wireObject(input);
  return MutationResult(
    active: (wireBool)(wireField(value, 'active')),
    count: ((Object? value) =>
        wireNullable(value, wireInt))(wireField(value, 'count')),
  );
}

ShareLink mapShareLink(Object? input) {
  final value = wireObject(input);
  return ShareLink(
    url: (wireUri)(wireField(value, 'url')),
    title: (wireString)(wireField(value, 'title')),
  );
}

DownloadGrant mapDownloadGrant(Object? input) {
  final value = wireObject(input);
  return DownloadGrant(
    url: (wireUri)(wireField(value, 'url')),
    expiresAt: (parseInstant)(wireField(value, 'expiresAt')),
    fileName: (wireString)(wireField(value, 'fileName')),
    mimeType: (wireString)(wireField(value, 'mimeType')),
    sizeBytes: (wireInt)(wireField(value, 'sizeBytes')),
  );
}

MediaAsset mapMediaAsset(Object? input) {
  final value = wireObject(input);
  return MediaAsset(
    id: (wireString)(wireField(value, 'id')),
    kind: (mapMediaKind)(wireField(value, 'kind')),
    url: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'url')),
    thumbnailUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'thumbnailUrl')),
    durationSeconds: ((Object? value) =>
        wireNullable(value, wireInt))(wireField(value, 'durationSeconds')),
    altText: (wireString)(wireField(value, 'altText')),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

Highlight mapHighlight(Object? input) {
  final value = wireObject(input);
  return Highlight(
    title: (wireString)(wireField(value, 'title')),
    description: (wireString)(wireField(value, 'description')),
  );
}

Property mapProperty(Object? input) {
  final value = wireObject(input);
  return Property(
    id: (wireString)(wireField(value, 'id')),
    code: (wireString)(wireField(value, 'code')),
    title: (wireString)(wireField(value, 'title')),
    provinceCode: (wireString)(wireField(value, 'provinceCode')),
    provinceName: (wireString)(wireField(value, 'provinceName')),
    districtCode: (wireString)(wireField(value, 'districtCode')),
    districtName: (wireString)(wireField(value, 'districtName')),
    region: (mapRegion)(wireField(value, 'region')),
    category: (mapPropertyCategory)(wireField(value, 'category')),
    priceTotal: (parseVnd)(wireField(value, 'priceTotal')),
    pricePerM2: (parseVnd)(wireField(value, 'pricePerM2')),
    areaM2: ((Object? value) =>
        DecimalValue(wireString(value)))(wireField(value, 'areaM2')),
    frontageM: ((Object? value) => wireNullable(
      value,
      (Object? value) => DecimalValue(wireString(value)),
    ))(wireField(value, 'frontageM')),
    depthM: ((Object? value) => wireNullable(
      value,
      (Object? value) => DecimalValue(wireString(value)),
    ))(wireField(value, 'depthM')),
    roadWidthM: ((Object? value) => wireNullable(
      value,
      (Object? value) => DecimalValue(wireString(value)),
    ))(wireField(value, 'roadWidthM')),
    direction: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'direction')),
    landType: (mapLandType)(wireField(value, 'landType')),
    status: (mapPropertyStatus)(wireField(value, 'status')),
    approvalStatus: (mapApprovalStatus)(wireField(value, 'approvalStatus')),
    sourceBadge: (mapSourceBadge)(wireField(value, 'sourceBadge')),
    consultantId: (wireString)(wireField(value, 'consultantId')),
    media: ((Object? value) =>
        wireList(value, mapMediaAsset))(wireField(value, 'media')),
    highlights: ((Object? value) =>
        wireList(value, mapHighlight))(wireField(value, 'highlights')),
    verifiedLegalCount: (wireInt)(wireField(value, 'verifiedLegalCount')),
    totalLegalCount: (wireInt)(wireField(value, 'totalLegalCount')),
    isSaved: (wireBool)(wireField(value, 'isSaved')),
    updatedAt: (parseInstant)(wireField(value, 'updatedAt')),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

PropertyFilter mapPropertyFilter(Object? input) {
  final value = wireObject(input);
  return PropertyFilter(
    query: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'query')),
    regions: ((Object? value) =>
        wireList(value, mapRegion))(wireField(value, 'regions')),
    category: ((Object? value) =>
        wireNullable(value, mapPropertyCategory))(wireField(value, 'category')),
    provinceCode: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'provinceCode')),
    districtCode: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'districtCode')),
    minPriceVnd: ((Object? value) =>
        wireNullable(value, parseVnd))(wireField(value, 'minPriceVnd')),
    maxPriceVnd: ((Object? value) =>
        wireNullable(value, parseVnd))(wireField(value, 'maxPriceVnd')),
    areaBands: ((Object? value) =>
        wireList(value, mapAreaBand))(wireField(value, 'areaBands')),
    landTypes: ((Object? value) =>
        wireList(value, mapLandType))(wireField(value, 'landTypes')),
    minRoadWidthM: ((Object? value) => wireNullable(
      value,
      (Object? value) => DecimalValue(wireString(value)),
    ))(wireField(value, 'minRoadWidthM')),
    hasDocuments: ((Object? value) =>
        wireNullable(value, wireBool))(wireField(value, 'hasDocuments')),
    savedOnly: (wireBool)(wireField(value, 'savedOnly')),
    sort: (mapPropertySort)(wireField(value, 'sort')),
  );
}

FilterOption mapFilterOption(Object? input) {
  final value = wireObject(input);
  return FilterOption(
    code: (wireString)(wireField(value, 'code')),
    label: (wireString)(wireField(value, 'label')),
    parentCode: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'parentCode')),
  );
}

FilterCatalog mapFilterCatalog(Object? input) {
  final value = wireObject(input);
  return FilterCatalog(
    provinces: ((Object? value) =>
        wireList(value, mapFilterOption))(wireField(value, 'provinces')),
    districts: ((Object? value) =>
        wireList(value, mapFilterOption))(wireField(value, 'districts')),
    minBudgetVnd: (parseVnd)(wireField(value, 'minBudgetVnd')),
    openUpperBudgetVnd: (parseVnd)(wireField(value, 'openUpperBudgetVnd')),
  );
}

LegalItem mapLegalItem(Object? input) {
  final value = wireObject(input);
  return LegalItem(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    title: (wireString)(wireField(value, 'title')),
    subtitle: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'subtitle')),
    checkedDate: ((Object? value) =>
        wireNullable(value, parseDate))(wireField(value, 'checkedDate')),
    status: (mapLegalStatus)(wireField(value, 'status')),
    sortOrder: (wireInt)(wireField(value, 'sortOrder')),
  );
}

PropertyDocument mapPropertyDocument(Object? input) {
  final value = wireObject(input);
  return PropertyDocument(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    title: (wireString)(wireField(value, 'title')),
    mimeType: (wireString)(wireField(value, 'mimeType')),
    sizeBytes: (wireInt)(wireField(value, 'sizeBytes')),
    uploadedDate: (parseDate)(wireField(value, 'uploadedDate')),
    previewUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'previewUrl')),
    access: (mapDocumentAccess)(wireField(value, 'access')),
    canDownload: (wireBool)(wireField(value, 'canDownload')),
  );
}

LegalSummary mapLegalSummary(Object? input) {
  final value = wireObject(input);
  return LegalSummary(
    propertyId: (wireString)(wireField(value, 'propertyId')),
    items: ((Object? value) =>
        wireList(value, mapLegalItem))(wireField(value, 'items')),
    documents: ((Object? value) =>
        wireList(value, mapPropertyDocument))(wireField(value, 'documents')),
    verifiedCount: (wireInt)(wireField(value, 'verifiedCount')),
    totalCount: (wireInt)(wireField(value, 'totalCount')),
    scopeNotice: (wireString)(wireField(value, 'scopeNotice')),
  );
}

ApproximateLocation mapApproximateLocation(Object? input) {
  final value = wireObject(input);
  return ApproximateLocation(
    latitude: (wireDouble)(wireField(value, 'latitude')),
    longitude: (wireDouble)(wireField(value, 'longitude')),
    radiusM: (wireInt)(wireField(value, 'radiusM')),
    label: (wireString)(wireField(value, 'label')),
  );
}

Amenity mapAmenity(Object? input) {
  final value = wireObject(input);
  return Amenity(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    category: (mapAmenityCategory)(wireField(value, 'category')),
    name: (wireString)(wireField(value, 'name')),
    distanceText: (wireString)(wireField(value, 'distanceText')),
    iconType: (wireString)(wireField(value, 'iconType')),
    latitude: ((Object? value) =>
        wireNullable(value, wireDouble))(wireField(value, 'latitude')),
    longitude: ((Object? value) =>
        wireNullable(value, wireDouble))(wireField(value, 'longitude')),
  );
}

AreaInfo mapAreaInfo(Object? input) {
  final value = wireObject(input);
  return AreaInfo(
    propertyId: (wireString)(wireField(value, 'propertyId')),
    location: wireNullable(
      wireField(value, 'location'),
      mapApproximateLocation,
    ),
    amenities: ((Object? value) =>
        wireList(value, mapAmenity))(wireField(value, 'amenities')),
    photos: ((Object? value) =>
        wireList(value, mapMediaAsset))(wireField(value, 'photos')),
    providerAttribution: (wireString)(wireField(value, 'providerAttribution')),
    externalMapUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'externalMapUrl')),
  );
}

PublicAuthor mapPublicAuthor(Object? input) {
  final value = wireObject(input);
  return PublicAuthor(
    id: (wireString)(wireField(value, 'id')),
    displayName: (wireString)(wireField(value, 'displayName')),
    role: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'role')),
    avatarUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'avatarUrl')),
    isVerified: (wireBool)(wireField(value, 'isVerified')),
    isFollowing: (wireBool)(wireField(value, 'isFollowing')),
  );
}

AuthorProfile mapAuthorProfile(Object? input) {
  final value = wireObject(input);
  return AuthorProfile(
    author: mapPublicAuthor(value),
    videoCount: wireInt(wireField(value, 'videoCount')),
    followerCount: wireInt(wireField(value, 'followerCount')),
    consultantId: wireNullable(wireField(value, 'consultantId'), wireString),
    isIllustrative: wireBool(wireField(value, 'isIllustrative')),
  );
}

FeedVideo mapFeedVideo(Object? input) {
  final value = wireObject(input);
  return FeedVideo(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    author: (mapPublicAuthor)(wireField(value, 'author')),
    media: (mapMediaAsset)(wireField(value, 'media')),
    caption: (wireString)(wireField(value, 'caption')),
    approximateArea: (wireString)(wireField(value, 'approximateArea')),
    property: (mapProperty)(wireField(value, 'property')),
    likeCount: (wireInt)(wireField(value, 'likeCount')),
    commentCount: (wireInt)(wireField(value, 'commentCount')),
    viewCount: (wireInt)(wireField(value, 'viewCount')),
    isLiked: (wireBool)(wireField(value, 'isLiked')),
    isSaved: (wireBool)(wireField(value, 'isSaved')),
    publishedAt: (parseInstant)(wireField(value, 'publishedAt')),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

VideoComment mapVideoComment(Object? input) {
  final value = wireObject(input);
  return VideoComment(
    id: (wireString)(wireField(value, 'id')),
    videoId: (wireString)(wireField(value, 'videoId')),
    author: (mapPublicAuthor)(wireField(value, 'author')),
    text: (wireString)(wireField(value, 'text')),
    createdAt: (parseInstant)(wireField(value, 'createdAt')),
    canDelete: (wireBool)(wireField(value, 'canDelete')),
  );
}

Consultant mapConsultant(Object? input) {
  final value = wireObject(input);
  return Consultant(
    id: (wireString)(wireField(value, 'id')),
    name: (wireString)(wireField(value, 'name')),
    role: (wireString)(wireField(value, 'role')),
    location: (wireString)(wireField(value, 'location')),
    isVerified: (wireBool)(wireField(value, 'isVerified')),
    avatarUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'avatarUrl')),
    coverUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'coverUrl')),
    videoCount: (wireInt)(wireField(value, 'videoCount')),
    followerCount: (wireInt)(wireField(value, 'followerCount')),
    rating: ((Object? value) => wireNullable(
      value,
      (Object? value) => DecimalValue(wireString(value)),
    ))(wireField(value, 'rating')),
    isFollowing: (wireBool)(wireField(value, 'isFollowing')),
    nextAvailableAt: ((Object? value) =>
        wireNullable(value, parseInstant))(wireField(value, 'nextAvailableAt')),
    supportRecipientLabel: ((Object? value) => wireNullable(value, wireString))(
      wireField(value, 'supportRecipientLabel'),
    ),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

ConsultantReview mapConsultantReview(Object? input) {
  final value = wireObject(input);
  return ConsultantReview(
    id: (wireString)(wireField(value, 'id')),
    consultantId: (wireString)(wireField(value, 'consultantId')),
    authorDisplayName: (wireString)(wireField(value, 'authorDisplayName')),
    rating: ((Object? value) =>
        DecimalValue(wireString(value)))(wireField(value, 'rating')),
    text: (wireString)(wireField(value, 'text')),
    createdAt: (parseInstant)(wireField(value, 'createdAt')),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

AgendaItem mapAgendaItem(Object? input) {
  final value = wireObject(input);
  return AgendaItem(
    startsAt: (parseInstant)(wireField(value, 'startsAt')),
    title: (wireString)(wireField(value, 'title')),
    // Compatible with the original payload; extra narrative lives in events.agenda JSONB.
    description: wireNullable(value['description'], wireString),
  );
}

Speaker mapSpeaker(Object? input) {
  final value = wireObject(input);
  return Speaker(
    name: (wireString)(wireField(value, 'name')),
    role: (wireString)(wireField(value, 'role')),
    description: wireNullable(value['description'], wireString),
    avatarUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'avatarUrl')),
  );
}

EventBenefit mapEventBenefit(Object? input) {
  final value = wireObject(input);
  return EventBenefit(
    title: (wireString)(wireField(value, 'title')),
    description: (wireString)(wireField(value, 'description')),
  );
}

XlandEvent mapXlandEvent(Object? input) {
  final value = wireObject(input);
  return XlandEvent(
    id: (wireString)(wireField(value, 'id')),
    title: (wireString)(wireField(value, 'title')),
    tags: ((Object? value) =>
        wireList(value, wireString))(wireField(value, 'tags')),
    media: ((Object? value) =>
        wireList(value, mapMediaAsset))(wireField(value, 'media')),
    startsAt: (parseInstant)(wireField(value, 'startsAt')),
    endsAt: (parseInstant)(wireField(value, 'endsAt')),
    timeZone: (wireString)(wireField(value, 'timeZone')),
    venueName: (wireString)(wireField(value, 'venueName')),
    address: (wireString)(wireField(value, 'address')),
    maxSlots: (wireInt)(wireField(value, 'maxSlots')),
    remainingSlots: (wireInt)(wireField(value, 'remainingSlots')),
    durationMinutes: (wireInt)(wireField(value, 'durationMinutes')),
    ticketPriceVnd: (parseVnd)(wireField(value, 'ticketPriceVnd')),
    status: (mapEventStatus)(wireField(value, 'status')),
    agenda: ((Object? value) =>
        wireList(value, mapAgendaItem))(wireField(value, 'agenda')),
    speakers: ((Object? value) =>
        wireList(value, mapSpeaker))(wireField(value, 'speakers')),
    benefits: ((Object? value) =>
        wireList(value, mapEventBenefit))(wireField(value, 'benefits')),
    isSaved: (wireBool)(wireField(value, 'isSaved')),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

EventRegistrationInput mapEventRegistrationInput(Object? input) {
  final value = wireObject(input);
  return EventRegistrationInput(
    eventId: (wireString)(wireField(value, 'eventId')),
    contactName: (wireString)(wireField(value, 'contactName')),
    contactPhone: (wireString)(wireField(value, 'contactPhone')),
    attendeeCount: (wireInt)(wireField(value, 'attendeeCount')),
  );
}

EventRegistration mapEventRegistration(Object? input) {
  final value = wireObject(input);
  return EventRegistration(
    id: (wireString)(wireField(value, 'id')),
    eventId: (wireString)(wireField(value, 'eventId')),
    status: (mapRegistrationStatus)(wireField(value, 'status')),
    attendeeCount: (wireInt)(wireField(value, 'attendeeCount')),
    ticketPriceVnd: (parseVnd)(wireField(value, 'ticketPriceVnd')),
    paymentMode: (mapPaymentMode)(wireField(value, 'paymentMode')),
    notice: (wireString)(wireField(value, 'notice')),
    createdAt: (parseInstant)(wireField(value, 'createdAt')),
  );
}

AvailabilitySlot mapAvailabilitySlot(Object? input) {
  final value = wireObject(input);
  return AvailabilitySlot(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    consultantId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'consultantId')),
    startsAt: (parseInstant)(wireField(value, 'startsAt')),
    endsAt: (parseInstant)(wireField(value, 'endsAt')),
    timeZone: (wireString)(wireField(value, 'timeZone')),
    isAvailable: (wireBool)(wireField(value, 'isAvailable')),
    unavailableReason: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'unavailableReason')),
    meetingArea: (mapApproximateLocation)(wireField(value, 'meetingArea')),
    maxAttendees: (wireInt)(wireField(value, 'maxAttendees')),
  );
}

BookingInput mapBookingInput(Object? input) {
  final value = wireObject(input);
  return BookingInput(
    propertyId: (wireString)(wireField(value, 'propertyId')),
    slotId: (wireString)(wireField(value, 'slotId')),
    sourceVideoId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'sourceVideoId')),
    attendeeCount: (wireInt)(wireField(value, 'attendeeCount')),
    transportMode: (mapTransportMode)(wireField(value, 'transportMode')),
    requestDocuments: (wireBool)(wireField(value, 'requestDocuments')),
    requestLoanAdvice: (wireBool)(wireField(value, 'requestLoanAdvice')),
    contactName: (wireString)(wireField(value, 'contactName')),
    contactPhone: (wireString)(wireField(value, 'contactPhone')),
    note: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'note')),
  );
}

DepositPolicy mapDepositPolicy(Object? input) {
  final value = wireObject(input);
  return DepositPolicy(
    indicativeAmountVnd: (parseVnd)(wireField(value, 'indicativeAmountVnd')),
    policyVersion: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'policyVersion')),
    chargeBasis: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'chargeBasis')),
    refundPolicyText: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'refundPolicyText')),
    cancellationPolicyText: ((Object? value) => wireNullable(
      value,
      wireString,
    ))(wireField(value, 'cancellationPolicyText')),
    reschedulePolicyText: ((Object? value) => wireNullable(value, wireString))(
      wireField(value, 'reschedulePolicyText'),
    ),
    livePaymentEnabled: (wireBool)(wireField(value, 'livePaymentEnabled')),
    notice: (wireString)(wireField(value, 'notice')),
  );
}

BookingHistoryItem mapBookingHistoryItem(Object? input) {
  final value = wireObject(input);
  return BookingHistoryItem(
    id: (wireString)(wireField(value, 'id')),
    fromStatus: (mapBookingStatus)(wireField(value, 'fromStatus')),
    toStatus: (mapBookingStatus)(wireField(value, 'toStatus')),
    occurredAt: (parseInstant)(wireField(value, 'occurredAt')),
    actorLabel: (wireString)(wireField(value, 'actorLabel')),
    publicNote: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'publicNote')),
  );
}

Booking mapBooking(Object? input) {
  final value = wireObject(input);
  return Booking(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    sourceVideoId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'sourceVideoId')),
    consultantId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'consultantId')),
    slotId: (wireString)(wireField(value, 'slotId')),
    property: (mapProperty)(wireField(value, 'property')),
    requestedStartsAt: (parseInstant)(wireField(value, 'requestedStartsAt')),
    confirmedStartsAt: ((Object? value) => wireNullable(value, parseInstant))(
      wireField(value, 'confirmedStartsAt'),
    ),
    timeZone: (wireString)(wireField(value, 'timeZone')),
    proposedMeetingArea: (mapApproximateLocation)(
      wireField(value, 'proposedMeetingArea'),
    ),
    confirmedMeetingLabel: ((Object? value) => wireNullable(value, wireString))(
      wireField(value, 'confirmedMeetingLabel'),
    ),
    attendeeCount: (wireInt)(wireField(value, 'attendeeCount')),
    transportMode: (mapTransportMode)(wireField(value, 'transportMode')),
    requestDocuments: (wireBool)(wireField(value, 'requestDocuments')),
    requestLoanAdvice: (wireBool)(wireField(value, 'requestLoanAdvice')),
    contactName: (wireString)(wireField(value, 'contactName')),
    maskedContactPhone: (wireString)(wireField(value, 'maskedContactPhone')),
    status: (mapBookingStatus)(wireField(value, 'status')),
    paymentStatus: (mapPaymentStatus)(wireField(value, 'paymentStatus')),
    depositPolicy: (mapDepositPolicy)(wireField(value, 'depositPolicy')),
    history: ((Object? value) =>
        wireList(value, mapBookingHistoryItem))(wireField(value, 'history')),
    availableActions: ((Object? value) =>
        wireList(value, wireString))(wireField(value, 'availableActions')),
    createdAt: (parseInstant)(wireField(value, 'createdAt')),
    updatedAt: (parseInstant)(wireField(value, 'updatedAt')),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

PaymentInstructions mapPaymentInstructions(Object? input) {
  final value = wireObject(input);
  return PaymentInstructions(
    qrImageUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'qrImageUrl')),
    bankName: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'bankName')),
    accountName: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'accountName')),
    maskedAccountNumber: ((Object? value) => wireNullable(value, wireString))(
      wireField(value, 'maskedAccountNumber'),
    ),
    transferContent: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'transferContent')),
  );
}

PaymentRecord mapPaymentRecord(Object? input) {
  final value = wireObject(input);
  return PaymentRecord(
    id: (wireString)(wireField(value, 'id')),
    bookingId: (wireString)(wireField(value, 'bookingId')),
    amountVnd: ((Object? value) =>
        wireNullable(value, parseVnd))(wireField(value, 'amountVnd')),
    status: (mapPaymentStatus)(wireField(value, 'status')),
    mode: (mapPaymentMode)(wireField(value, 'mode')),
    reference: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'reference')),
    expiresAt: ((Object? value) =>
        wireNullable(value, parseInstant))(wireField(value, 'expiresAt')),
    receivedAt: ((Object? value) =>
        wireNullable(value, parseInstant))(wireField(value, 'receivedAt')),
    instructions: ((Object? value) => wireNullable(
      value,
      mapPaymentInstructions,
    ))(wireField(value, 'instructions')),
    policyVersion: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'policyVersion')),
    notice: (wireString)(wireField(value, 'notice')),
    updatedAt: (parseInstant)(wireField(value, 'updatedAt')),
  );
}

BookingChangeInput mapBookingChangeInput(Object? input) {
  final value = wireObject(input);
  return BookingChangeInput(
    reason: (wireString)(wireField(value, 'reason')),
    requestedSlotId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'requestedSlotId')),
  );
}

UserProfile mapUserProfile(Object? input) {
  final value = wireObject(input);
  return UserProfile(
    id: (wireString)(wireField(value, 'id')),
    displayName: (wireString)(wireField(value, 'displayName')),
    avatarUrl: ((Object? value) =>
        wireNullable(value, wireUri))(wireField(value, 'avatarUrl')),
    contactPhone: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'contactPhone')),
    contactVerified: (wireBool)(wireField(value, 'contactVerified')),
    updatedAt: (parseInstant)(wireField(value, 'updatedAt')),
  );
}

UserSettings mapUserSettings(Object? input) {
  final value = wireObject(input);
  return UserSettings(
    notificationConsent: (wireBool)(wireField(value, 'notificationConsent')),
    locale: (wireString)(wireField(value, 'locale')),
    timeZone: (wireString)(wireField(value, 'timeZone')),
    feedAutoplay: (wireBool)(wireField(value, 'feedAutoplay')),
    feedMutedByDefault: (wireBool)(wireField(value, 'feedMutedByDefault')),
    updatedAt: (parseInstant)(wireField(value, 'updatedAt')),
  );
}

SettingsUpdate mapSettingsUpdate(Object? input) {
  final value = wireObject(input);
  return SettingsUpdate(
    notificationConsent: ((Object? value) =>
        wireNullable(value, wireBool))(wireField(value, 'notificationConsent')),
    feedAutoplay: ((Object? value) =>
        wireNullable(value, wireBool))(wireField(value, 'feedAutoplay')),
    feedMutedByDefault: ((Object? value) =>
        wireNullable(value, wireBool))(wireField(value, 'feedMutedByDefault')),
  );
}

Session mapSession(Object? input) {
  final value = wireObject(input);
  return Session(
    profile: (mapUserProfile)(wireField(value, 'profile')),
    expiresAt: (parseInstant)(wireField(value, 'expiresAt')),
  );
}

Club mapClub(Object? input) {
  final value = wireObject(input);
  return Club(
    id: (wireString)(wireField(value, 'id')),
    title: (wireString)(wireField(value, 'title')),
    summary: (wireString)(wireField(value, 'summary')),
    description: (wireString)(wireField(value, 'description')),
    regionLabel: (wireString)(wireField(value, 'regionLabel')),
    activities: ((Object? value) =>
        wireList(value, wireString))(wireField(value, 'activities')),
    media: ((Object? value) =>
        wireList(value, mapMediaAsset))(wireField(value, 'media')),
    supportRecipientLabel: ((Object? value) => wireNullable(value, wireString))(
      wireField(value, 'supportRecipientLabel'),
    ),
    isIllustrative: (wireBool)(wireField(value, 'isIllustrative')),
  );
}

SupportRequestInput mapSupportRequestInput(Object? input) {
  final value = wireObject(input);
  return SupportRequestInput(
    kind: (mapSupportKind)(wireField(value, 'kind')),
    propertyId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'propertyId')),
    consultantId: ((Object? value) =>
        wireNullable(value, wireString))(wireField(value, 'consultantId')),
    message: (wireString)(wireField(value, 'message')),
    contactName: (wireString)(wireField(value, 'contactName')),
    contactPhone: (wireString)(wireField(value, 'contactPhone')),
    consentToShareContact: (wireBool)(
      wireField(value, 'consentToShareContact'),
    ),
  );
}

SupportRequest mapSupportRequest(Object? input) {
  final value = wireObject(input);
  return SupportRequest(
    id: (wireString)(wireField(value, 'id')),
    kind: (mapSupportKind)(wireField(value, 'kind')),
    status: (mapSupportStatus)(wireField(value, 'status')),
    recipientLabel: (wireString)(wireField(value, 'recipientLabel')),
    notice: (wireString)(wireField(value, 'notice')),
    createdAt: (parseInstant)(wireField(value, 'createdAt')),
  );
}

FinanceInput mapFinanceInput(Object? input) {
  final value = wireObject(input);
  return FinanceInput(
    propertyId: (wireString)(wireField(value, 'propertyId')),
    equityVnd: (parseVnd)(wireField(value, 'equityVnd')),
    loanVnd: (parseVnd)(wireField(value, 'loanVnd')),
    termMonths: (wireInt)(wireField(value, 'termMonths')),
    annualRatePercent: ((Object? value) =>
        DecimalValue(wireString(value)))(wireField(value, 'annualRatePercent')),
    method: (mapRepaymentMethod)(wireField(value, 'method')),
  );
}

FinanceResult mapFinanceResult(Object? input) {
  final value = wireObject(input);
  return FinanceResult(
    input: (mapFinanceInput)(wireField(value, 'input')),
    monthlyPaymentVnd: (parseVnd)(wireField(value, 'monthlyPaymentVnd')),
    firstMonthPrincipalVnd: (parseVnd)(
      wireField(value, 'firstMonthPrincipalVnd'),
    ),
    firstMonthInterestVnd: (parseVnd)(
      wireField(value, 'firstMonthInterestVnd'),
    ),
    totalInterestVnd: (parseVnd)(wireField(value, 'totalInterestVnd')),
    totalRepaymentVnd: (parseVnd)(wireField(value, 'totalRepaymentVnd')),
    formulaVersion: (wireString)(wireField(value, 'formulaVersion')),
    roundingRule: (wireString)(wireField(value, 'roundingRule')),
    estimateNotice: (wireString)(wireField(value, 'estimateNotice')),
  );
}

SavedFinancePlan mapSavedFinancePlan(Object? input) {
  final value = wireObject(input);
  return SavedFinancePlan(
    id: (wireString)(wireField(value, 'id')),
    propertyId: (wireString)(wireField(value, 'propertyId')),
    label: (wireString)(wireField(value, 'label')),
    input: (mapFinanceInput)(wireField(value, 'input')),
    result: ((Object? value) =>
        wireNullable(value, mapFinanceResult))(wireField(value, 'result')),
    createdAt: (parseInstant)(wireField(value, 'createdAt')),
  );
}
