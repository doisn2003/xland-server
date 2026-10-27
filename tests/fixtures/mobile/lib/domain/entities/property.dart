// DRAFT v0.1; reviewed and locked by Agent A after B feedback.
import 'common.dart';
import '../value_objects/vnd.dart';
import '../value_objects/decimal_value.dart';

final class MediaAsset {
  const MediaAsset({
    required this.id,
    required this.kind,
    this.url,
    this.thumbnailUrl,
    this.durationSeconds,
    required this.altText,
    required this.isIllustrative,
  });
  final String id;
  final MediaKind kind;
  final Uri? url;
  final Uri? thumbnailUrl;
  final int? durationSeconds;
  final String altText;
  final bool isIllustrative;
}

final class Highlight {
  const Highlight({required this.title, required this.description});
  final String title;
  final String description;
}

final class Property {
  const Property({
    this.parentPropertyId,
    this.hasSubplots = false,
    this.isCorner = false,
    required this.id,
    required this.code,
    required this.title,
    required this.provinceCode,
    required this.provinceName,
    required this.districtCode,
    required this.districtName,
    required this.region,
    required this.category,
    required this.priceTotal,
    required this.pricePerM2,
    required this.areaM2,
    this.frontageM,
    this.depthM,
    this.roadWidthM,
    this.direction,
    required this.landType,
    required this.status,
    required this.approvalStatus,
    required this.sourceBadge,
    required this.consultantId,
    required this.media,
    required this.highlights,
    required this.verifiedLegalCount,
    required this.totalLegalCount,
    required this.isSaved,
    required this.updatedAt,
    required this.isIllustrative,
  });
  final String? parentPropertyId;
  final bool hasSubplots;
  final bool isCorner;
  final String id;
  final String code;
  final String title;
  final String provinceCode;
  final String provinceName;
  final String districtCode;
  final String districtName;
  final Region region;
  final PropertyCategory category;
  final Vnd priceTotal;
  final Vnd pricePerM2;
  final DecimalValue areaM2;
  final DecimalValue? frontageM;
  final DecimalValue? depthM;
  final DecimalValue? roadWidthM;
  final String? direction;
  final LandType landType;
  final PropertyStatus status;
  final ApprovalStatus approvalStatus;
  final SourceBadge sourceBadge;
  final String consultantId;
  final List<MediaAsset> media;
  final List<Highlight> highlights;
  final int verifiedLegalCount;
  final int totalLegalCount;
  final bool isSaved;
  final DateTime updatedAt;
  final bool isIllustrative;
}

final class PropertyFilter {
  const PropertyFilter({
    this.query,
    required this.regions,
    this.category,
    this.provinceCode,
    this.districtCode,
    this.minPriceVnd,
    this.maxPriceVnd,
    required this.areaBands,
    required this.landTypes,
    this.minRoadWidthM,
    this.hasDocuments,
    required this.savedOnly,
    required this.sort,
  });
  final String? query;
  final List<Region> regions;
  final PropertyCategory? category;
  final String? provinceCode;
  final String? districtCode;
  final Vnd? minPriceVnd;
  final Vnd? maxPriceVnd;
  final List<AreaBand> areaBands;
  final List<LandType> landTypes;
  final DecimalValue? minRoadWidthM;
  final bool? hasDocuments;
  final bool savedOnly;
  final PropertySort sort;
}

final class FilterOption {
  const FilterOption({
    required this.code,
    required this.label,
    this.parentCode,
  });
  final String code;
  final String label;
  final String? parentCode;
}

final class FilterCatalog {
  const FilterCatalog({
    required this.provinces,
    required this.districts,
    required this.minBudgetVnd,
    required this.openUpperBudgetVnd,
  });
  final List<FilterOption> provinces;
  final List<FilterOption> districts;
  final Vnd minBudgetVnd;
  final Vnd openUpperBudgetVnd;
}

final class PropertySearchResult {
  const PropertySearchResult({
    required this.page,
    required this.total,
    required this.selectedCriteriaCount,
  });
  final Page<Property> page;
  final int total;
  final int selectedCriteriaCount;
}

final class LegalItem {
  const LegalItem({
    required this.id,
    required this.propertyId,
    required this.title,
    this.subtitle,
    this.checkedDate,
    required this.status,
    required this.sortOrder,
  });
  final String id;
  final String propertyId;
  final String title;
  final String? subtitle;
  final String? checkedDate;
  final LegalStatus status;
  final int sortOrder;
}

final class PropertyDocument {
  const PropertyDocument({
    required this.id,
    required this.propertyId,
    required this.title,
    required this.mimeType,
    required this.sizeBytes,
    required this.uploadedDate,
    this.previewUrl,
    required this.access,
    required this.canDownload,
  });
  final String id;
  final String propertyId;
  final String title;
  final String mimeType;
  final int sizeBytes;
  final String uploadedDate;
  final Uri? previewUrl;
  final DocumentAccess access;
  final bool canDownload;
}

final class LegalSummary {
  const LegalSummary({
    required this.propertyId,
    required this.items,
    required this.documents,
    required this.verifiedCount,
    required this.totalCount,
    required this.scopeNotice,
  });
  final String propertyId;
  final List<LegalItem> items;
  final List<PropertyDocument> documents;
  final int verifiedCount;
  final int totalCount;
  final String scopeNotice;
}

final class ApproximateLocation {
  const ApproximateLocation({
    required this.latitude,
    required this.longitude,
    required this.radiusM,
    required this.label,
  });
  final double latitude;
  final double longitude;
  final int radiusM;
  final String label;
}

final class Amenity {
  const Amenity({
    required this.id,
    required this.propertyId,
    required this.category,
    required this.name,
    required this.distanceText,
    required this.iconType,
    this.latitude,
    this.longitude,
  });
  final String id;
  final String propertyId;
  final AmenityCategory category;
  final String name;
  final String distanceText;
  final String iconType;
  final double? latitude;
  final double? longitude;
}

final class AreaInfo {
  const AreaInfo({
    required this.propertyId,
    required this.location,
    required this.amenities,
    required this.photos,
    required this.providerAttribution,
    this.externalMapUrl,
  });
  final String propertyId;
  final ApproximateLocation? location;
  final List<Amenity> amenities;
  final List<MediaAsset> photos;
  final String providerAttribution;
  final Uri? externalMapUrl;
}
