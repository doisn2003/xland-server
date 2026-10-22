# XLAND — API & Domain Contract
**CANDIDATE v0.1 revision C-4 — chờ B review và A khóa hash cuối** · Agent C · 16/10/2026 Asia/Bangkok.
Delta giới hạn A-06 calculator và A-07 ProfileUpdate clear flags theo [quyết định Phase2](07_PHASE2_DECISIONS.md) v1.1. C-3 là baseline G1 đã Pass; snapshot C-3 và manifest giữ trong logs/agent-c/snapshots/C3-before-C4-2026-10-16T13-29-22-585Z, hash contract cũ5409ADBE50FF1F5A9F8D61576DC7322A790E82A79744F910909688B53410D9E9. Không đổi tên baseline G1 thành C-4.
Nguồn: BUSINESS1.1, rules1.5, master plan1.3, design1.4, architecture decisions1.2 và A-06..09v1.1. **63 active operations + U02 reserved** giữ ID; N01/N02 active theo A-06, payment gates giữ nguyên. Coverage runtime tách success/gate trong evidence C (59success paths/4gates sau delta); fixture examples không thay evidence và không xác nhận provider/live/native/G2.

## 1. Quy ước và quyền
- Base `/api/v1`; JSON UTF-8, camelCase field. HTTP success `{data,meta?}`; error `{error:{code,message,details?},requestId}`. Header X-Request-Id được server tạo, không echo ID chưa kiểm tra từ client.
- ID resource UUID, cùng identity trên mobile/web/admin; code XL-028 là mã hiển thị, không khóa chính. Consultant PK là user/profile identity được giới thiệu. Một property có nhiều videos, mỗi video thuộc đúng một property. Lưu video, property, event có bảng/mutation độc lập.
- P = public, optional session chỉ cá nhân hóa isSaved/isLiked/isFollowing; token được gửi nhưng sai vẫn 401. G = guest/login session creation (rate limit riêng). U = authenticated. O = authenticated owner, userId lấy từ opaque session đã server xác minh. Foreign booking/payment/plan/comment-private trả 404 chống dò identity; thiếu quyền tài liệu trả 403. Không public API nào tự confirmed/completed/paid/refunded.
- Owner-only contact đầy đủ ở /me/profile; public author/consultant không có phone. Booking chỉ maskedContactPhone trong response. Contact snapshot và giấy tờ riêng không vào public feed, log hoặc share URL.
- Permissions document: public_redacted cho mọi người; authenticated cần session; granted cần session và document_access_grants còn hạn. Cọc không tự tạo grant. URL download tối đa300giây theo A-02, metadata không lộ storage key/file_url nội bộ. GET area chỉ approximate center + radius, không tọa độ thửa chính xác.
- Pagination GET list: limit integer 1..50 default20; cursor nullable, opaque, gắn filter/sort/user context, invalid cursor→400. Keyset theo sort + UUID tie-break; response data=array, meta={nextCursor:string|null,hasMore:boolean,total:int|null}. total bắt buộc exact ở properties/count/search; khác list có thể null. Empty=[],hasMore=false,nextCursor=null; không 404.
- Domain Page<T> map từ data + meta. PropertySearchResult map data + meta.total + meta.selectedCriteriaCount vào page,total,selectedCriteriaCount. Single/list không paginated dùng data=object/array; DELETE thành công 200 data:null; create 201. No content 204 không dùng v0.1.
- Output tất cả field trong schema phải xuất hiện; field nullable dùng null, không mất field. Input nullable có thể omitted; input PATCH omission=giữ, explicit null chỉ được clear avatarUrl/contactPhone, displayName không null. Không gửi null ở body field không nullable. Unknown field/query→400. Enum unknown từ response→XlandFailure.internalError và ghi requestId, không fallback thành trạng thái thành công.
- Header Idempotency-Key bắt buộc trên các POST ghi dữ liệu nêu trong bảng, string ASCII 16..128. Scope=(authenticated user,operation,key); canonical request hash. Retry cùng body trả nguyên response/resource và status gốc; khác body→409 IDEMPOTENCY_CONFLICT. A-04: generic POST giữ key ít nhất24h; booking/payment giữ định danh operation lâu dài theo resource. Không cache password/token/contact thô. PUT/DELETE set-state là idempotent, không toggle mù.
- Sorting trong cột behavior là thứ tự chuẩn. Query date-only theo Asia/Ho_Chi_Minh; fromDate<=toDate, tối đa31 ngày; future availability không dùng ngày9/2026.

### Đơn vị và primitive
| Primitive | Wire / Dart / DB | Ràng buộc |
|---|---|---|
| Vnd | decimal-string / Vnd(BigInt) / numeric(20,0) | 0..99999999999999999999, không dấu, float, exponent, locale hoặc ký tự đ; money không double |
| DecimalValue | decimal-string / DecimalValue / numeric(18,6) | Không âm, <=6 số lẻ; areaM2 m² >0; dimension metres; annualRatePercent phần trăm/năm |
| DateTime | RFC3339 string có Z hoặc ±HH:MM / UTC DateTime / timestamptz | timeZone=Asia/Ho_Chi_Minh; render theo zone, không device local hoặc date-only giả |
| DATE | YYYY-MM-DD string / String / date | Ngày thật Gregorian; checkedDate/uploadedDate/fromDate/toDate |
| double | JSON number / double / numeric | Chỉ approximate lat[-90,90],lon[-180,180], không tiền |
| Uri | HTTPS string / Uri / text or private storage key | null nếu chưa có media; example.invalid chỉ fixture; signed URL không lưu lâu |
| int | JSON safe integer / int / integer/bigint | Counter >=0 <=2^53-1; sizeBytes bytes (MB thập phân10^6), durationSeconds giây; rating DecimalValue0..5 |
| String | UTF-8 / String / text | Text hiển thị trim/không HTML; riêng password giữ nguyên Unicode/whitespace theo A-01, không trim/đổi chữ; ID UUID trừ catalog codes; không parse text hiển thị làm enum |
| bool | true/false JSON / bool / boolean | Query dùng đúng "true"/"false" |

### Lỗi chung áp dụng MỖI operation
400 INVALID_INPUT (details=[{field,code}], sai enum/range/cursor/unknown); 401 UNAUTHENTICATED (U/O hoặc token sai); 403 FORBIDDEN (permission); 404 NOT_FOUND; 409 CONFLICT/IDEMPOTENCY_CONFLICT/POLICY_NOT_CONFIGURED/FEATURE_NOT_ENABLED/PROPERTY_UNAVAILABLE/SLOT_UNAVAILABLE/SOLD_OUT; 413 PAYLOAD_TOO_LARGE; 429 RATE_LIMITED (Retry-After giây); 502 UPSTREAM_UNAVAILABLE; 500 INTERNAL_ERROR. Mỗi dòng có các lỗi nghiệp vụ bổ sung/nhấn mạnh, không thay bộ chung. Client offline/timeout là domain failure, không HTTP500 giả. Không trả SQL/stack/secret. `PAYLOAD_TOO_LARGE` map invalidInput ở domain; `CONFLICT` detail giữ reason ổn định. Body max64KiB; text comment1..1000, name1..100, reason/message1..2000, label1..100; phone E.164 hoặc chuẩn VN được normalize server, không tự verified. IDs/path được runtime validate.

## 2. Danh mục operation và ví dụ
Mỗi OP ID có request + response đầy đủ tại [operations.v0.1.json](logs/agent-c/fixtures/operations.v0.1.json), key tương ứng. Ví dụ là thiết kế, không test API đã chạy. `none` nghĩa không body (POST có Idempotency-Key vẫn có header). UUID ở input là path parameter bắt buộc. Các output type xem §4. Body EventRegistrationInput bỏ eventId vì đã ở path. Gated operation có ví dụ lỗi hiện hành; type output giữ cho bước sau A khóa.

| ID | Method/path (sau /api/v1) | Quyền | Input | Output | Lỗi nghiệp vụ | Behavior / status / sort |
|---|---|---|---|---|---|---|
| F01 | GET /feed | P nếu recommended; U nếu following | PageQuery; feedScope=recommended/following (default recommended); region?, category? | Page<FeedVideo> | UNAUTHENTICATED khi following guest | A-03 newest publishedAt DESC,id DESC ở cả hai scope; following chỉ authors account đang follow; cursor gắn scope/user; không ghi view |
| F02 | GET /videos/{videoId} | P | UUID | FeedVideo | NOT_FOUND | Một video có đúng propertyId |
| F03 | PUT /videos/{videoId}/like | U | none | MutationResult | NOT_FOUND | Đặt active=true; retry không nhân like |
| F04 | DELETE /videos/{videoId}/like | U | none | MutationResult | NOT_FOUND | Đặt active=false |
| F05 | GET /videos/{videoId}/comments | P | PageQuery | Page<VideoComment> | NOT_FOUND | createdAt ASC,id ASC |
| F06 | POST /videos/{videoId}/comments | U | {text:string 1..1000}; Idempotency-Key | VideoComment | NOT_FOUND,IDEMPOTENCY_CONFLICT | 201; text plain, không HTML |
| F07 | DELETE /videos/{videoId}/comments/{commentId} | O | none | null | NOT_FOUND,FORBIDDEN | 200 data:null; owner hoặc quyền moderation tương lai; tombstone |
| F08 | PUT /videos/{videoId}/saved | U | none | MutationResult | NOT_FOUND | Save video riêng property |
| F09 | DELETE /videos/{videoId}/saved | U | none | MutationResult | NOT_FOUND | Unsave video |
| F10 | GET /me/saved-videos | O | PageQuery | Page<FeedVideo> | Bộ lỗi chung | savedAt DESC,id DESC |
| F11 | PUT /authors/{authorId}/follow | U | none | MutationResult | NOT_FOUND,CONFLICT | Không follow chính mình; count authoritative |
| F12 | DELETE /authors/{authorId}/follow | U | none | MutationResult | NOT_FOUND | Unfollow |
| F13 | GET /me/following | O | PageQuery | Page<PublicAuthor> | Bộ lỗi chung | followedAt DESC,id DESC |
| F14 | GET /videos/{videoId}/share | P | UUID | ShareLink | NOT_FOUND | URL canonical của XLand; không tạo lượt chia sẻ giả |
| F15 | GET /authors/{authorId} | P | UUID | AuthorProfile | NOT_FOUND | Hồ sơ công khai của người đăng, kể cả không phải tư vấn viên |
| F16 | GET /authors/{authorId}/videos | P | PageQuery | Page<FeedVideo> | NOT_FOUND | Lọc videos.author_id; publishedAt DESC,id DESC; chỉ video công khai |
| D01 | GET /properties | P | PropertyFilter + PageQuery | PropertySearchResult | Bộ lỗi chung | Search/count cùng predicate, cùng revision; sort explicit |
| D02 | GET /properties/count | P | PropertyFilter | CountResult | Bộ lỗi chung | Preview filter chưa apply; stale request không overwrite |
| D03 | GET /catalog/locations | P | provinceCode? | FilterCatalog | INVALID_INPUT | Districts phụ thuộc provinceCode; catalog versioned; nguồn vận hành trước real seed, không chặn G1 fixture |
| D04 | GET /properties/{propertyId} | P | UUID | Property | NOT_FOUND | S02/S05/S08 dùng cùng identity, current canonical price |
| D05 | PUT /properties/{propertyId}/saved | U | none | MutationResult | NOT_FOUND | Save property riêng video |
| D06 | DELETE /properties/{propertyId}/saved | U | none | MutationResult | NOT_FOUND | Unsave property |
| D07 | GET /properties/{propertyId}/share | P | UUID | ShareLink | NOT_FOUND | Canonical public route |
| L01 | GET /properties/{propertyId}/legal | P | UUID | LegalSummary | NOT_FOUND | Chỉ redacted metadata; scope notice không chứng nhận quyền bán |
| L02 | POST /properties/{propertyId}/documents/{documentId}/download | P | none | DownloadGrant | NOT_FOUND,FORBIDDEN | Public-redacted hoặc auth+grant; URL 5 phút, không lưu URL vào DB public |
| A01 | GET /properties/{propertyId}/area | P | category?: utility / traffic / living | AreaInfo | NOT_FOUND | Chỉ tâm vùng gần đúng + radius; exact tọa độ không nằm API public |
| C01 | GET /consultants/{consultantId} | P | UUID | Consultant | NOT_FOUND | consultantId = public author profile identity |
| C02 | GET /consultants/{consultantId}/videos | P | PageQuery | Page<FeedVideo> | NOT_FOUND | publishedAt DESC,id DESC |
| C03 | GET /consultants/{consultantId}/properties | P | PageQuery | Page<Property> | NOT_FOUND | Chỉ listed; updatedAt DESC,id DESC |
| C04 | GET /consultants/{consultantId}/reviews | P | PageQuery | Page<ConsultantReview> | NOT_FOUND | Read-only demo reviews; không mở review mutation |
| C05 | GET /consultants/{consultantId}/availability | P | fromDate,toDate (DATE, <=31 ngày) | List<AvailabilitySlot> | NOT_FOUND | Dành support appointment, không tự confirmed; startsAt ASC |
| E01 | GET /events | P | PageQuery; status? | Page<XlandEvent> | Bộ lỗi chung | startsAt ASC,id ASC; lịch sử phải có status closed |
| E02 | GET /events/{eventId} | P | UUID | XlandEvent | NOT_FOUND | S07; tiền vé riêng deposit |
| E03 | PUT /events/{eventId}/saved | U | none | MutationResult | NOT_FOUND | Bookmark event |
| E04 | DELETE /events/{eventId}/saved | U | none | MutationResult | NOT_FOUND | Unbookmark event |
| E05 | POST /events/{eventId}/registrations | U | EventRegistrationInput sans eventId path; Idempotency-Key | EventRegistration | NOT_FOUND,SOLD_OUT,IDEMPOTENCY_CONFLICT,FEATURE_NOT_ENABLED | 201; capacity lock transaction; payment disabled không báo vé đã trả |
| E06 | GET /me/event-registrations | O | PageQuery | Page<EventRegistration> | Bộ lỗi chung | createdAt DESC,id DESC |
| E07 | GET /me/saved-events | O | PageQuery | Page<XlandEvent> | Bộ lỗi chung | savedAt DESC,id DESC |
| E08 | GET /events/{eventId}/share | P | UUID | ShareLink | NOT_FOUND | Public route |
| B01 | GET /properties/{propertyId}/availability | P | fromDate,toDate <=31 ngày | List<AvailabilitySlot> | NOT_FOUND,PROPERTY_UNAVAILABLE | startsAt ASC; available không phải đã giữ slot |
| B02 | GET /booking-deposit-policy | P | none | DepositPolicy | Bộ lỗi chung | 350000 indicative; policyVersion=null, chargeBasis=null |
| B03 | POST /bookings | U | BookingInput; Idempotency-Key | Booking | PROPERTY_UNAVAILABLE,SLOT_UNAVAILABLE,IDEMPOTENCY_CONFLICT | 201 awaiting_deposit/unpaid; sourceVideoId thuộc đúng property; chưa payment live |
| B04 | GET /me/bookings | O | PageQuery; status? | Page<Booking> | Bộ lỗi chung | createdAt DESC,id DESC; chỉ user hiện tại |
| B05 | GET /bookings/{bookingId} | O | UUID | Booking | NOT_FOUND | Foreign owner→404; history publicNote không internal logs |
| B06 | POST /bookings/{bookingId}/cancellation-requests | O | BookingChangeInput (reason; requestedSlotId omitted); Idempotency-Key | Booking | NOT_FOUND,POLICY_NOT_CONFIGURED,CONFLICT | Khung: chỉ ghi yêu cầu nếu A bật policy; không auto refund |
| B07 | POST /bookings/{bookingId}/reschedule-requests | O | BookingChangeInput (reason + requestedSlotId); Idempotency-Key | Booking | NOT_FOUND,POLICY_NOT_CONFIGURED,SLOT_UNAVAILABLE,CONFLICT | Khung chưa bật; không hứa đổi lịch hoặc thêm cọc |
| P01 | GET /bookings/{bookingId}/payments | O | PageQuery | Page<PaymentRecord> | NOT_FOUND | createdAt DESC,id DESC; mode bắt buộc |
| P02 | GET /payments/{paymentId} | O | UUID | PaymentRecord | NOT_FOUND | Read server status; không trả provider payload |
| P03 | POST /bookings/{bookingId}/payment-intents | O | none; Idempotency-Key | PaymentRecord | NOT_FOUND,POLICY_NOT_CONFIGURED,FEATURE_NOT_ENABLED,IDEMPOTENCY_CONFLICT | Khung; mặc định 409 policy chưa chốt; không nhận amount/userId/paid từ client |
| P04 | POST /payments/{paymentId}/refresh | O | none | PaymentRecord | NOT_FOUND,UPSTREAM_UNAVAILABLE | Không tin nút đã chuyển tiền; server đọc trạng thái verified |
| U01 | POST /auth/sessions | G | SignInInput {username,password}; credential template redacted | TokenSession {accessToken,session}; không refresh | INVALID_INPUT,UNAUTHENTICATED,RATE_LIMITED | A-01 Express + PostgreSQL nội bộ; 200 cấp opaque bearer24h; không auto signup |
| U02 | RESERVED — /auth/sessions/refresh | Không có route đang hoạt động | Không request/refreshToken | Không response fixture thực thi | NOT IMPLEMENTED | A-01 giữ nguyên ID, không tái sử dụng; session hết hạn phải đăng nhập lại |
| U03 | DELETE /auth/sessions/current | U | none | null | UNAUTHENTICATED | Thu hồi opaque session hiện tại ở server; clear local token; không giả revoke nếu lỗi, không tự logout mọi thiết bị |
| U04 | GET /auth/session | U | none | Session | UNAUTHENTICATED | Data mapper converts 401 to Session? null for getSession only |
| U05 | GET /me/profile | O | none | UserProfile | Bộ lỗi chung | Full phone only own authenticated profile |
| U06 | PATCH /me/profile | O | ProfileUpdate | UserProfile | CONFLICT | Nonempty PATCH allowlist; contact changes reset verified; avatar allowlisted hosted URL |
| U07 | GET /me/settings | O | none | UserSettings | Bộ lỗi chung | Persist; settings with actual effects only |
| U08 | PATCH /me/settings | O | SettingsUpdate | UserSettings | Bộ lỗi chung | Nonempty PATCH; locale vi_VN and zone fixed, not writable in v0.1 |
| K01 | GET /clubs | P | PageQuery | Page<Club> | Bộ lỗi chung | title ASC,id ASC; introduction only |
| K02 | GET /clubs/{clubId} | P | UUID | Club | NOT_FOUND | Không membership/checkout/chat-group |
| S01 | POST /support-requests | U | SupportRequestInput; Idempotency-Key | SupportRequest | NOT_FOUND,IDEMPOTENCY_CONFLICT | A-04 201 received; ticket chưa phân công, không realtime inbox/SLA |
| S02 | GET /me/support-requests | O | PageQuery | Page<SupportRequest> | Bộ lỗi chung | createdAt DESC,id DESC |
| N01 | POST /finance/estimates | P | FinanceInput | FinanceResult | INVALID_INPUT,NOT_FOUND | 200 xland-loan-v1 theo A-06; exact VND,0%/0loan; equity+loan=giá hiện hành |
| N02 | POST /me/finance-plans | O | {label:string, input:FinanceInput}; Idempotency-Key | SavedFinancePlan | INVALID_INPUT,NOT_FOUND,IDEMPOTENCY_CONFLICT | 201; server recompute/lock current price/persist snapshot+version+rounding cùng transaction; retry snapshot cũ; không accept client result |
| N03 | GET /me/finance-plans | O | PageQuery | Page<SavedFinancePlan> | Bộ lỗi chung | createdAt DESC,id DESC |
| N04 | DELETE /me/finance-plans/{planId} | O | UUID | null | NOT_FOUND | 200 data:null; owner-only |

## 3. Quy tắc theo màn/CTA
| Màn | Operation và hành vi |
|---|---|
| S00 feed/social | F01–F16 + D04/B03; avatar/tên mở hồ sơ theo video.author.id; liên hệ tư vấn theo property.consultantId. Like/comment/follow/save persist; share native từ ShareLink, cancel share không success. Video playback chỉ active và pause khi tab/navigation/background; không network view increment Phase 1. |
| S01 explore | D01–D07,E01,K01; saved tab là D01 savedOnly=true (O), public request savedOnly=true khi guest→401; sort newest/relevant; navigation giữ propertyId. |
| S02 overview | D04/D05–07,C01,B01/B03; gallery dùng media[], giá current canonical property trong feed. |
| S03 legal | L01/L02/S01 kind=legal_review; verified/total derived từ items, pending count=total-verified. Grant download không phải verified ownership. |
| S04 area | A01 category utility/traffic/living; S01 location_inquiry hoặc chat; CTA thực địa B01/B03 cùng luồng cọc. |
| S05 finance | D04,N01–N04,S01 kind=loan_advice; A-06 đã đóng SPEC-001 về đặc tả, đọc output repository; UI không tự tính công thức. |
| S06 consultant | C01–05,F11/12,S01 chat hoặc consultant_appointment; nextAvailableAt nullable, không tự dùng "hôm nay15:30". |
| S07 event | E01–08; đăng ký capacity atomic; event fee149000 tách350000. Kênh phí chưa chốt→pending/mode disabled, không báo đã trả vé. |
| S08 booking | B01–07,B02; input review, sourceVideoId giữ provenance; contact xác minh riêng, response lịch không confirmed khi mới create. |
| S09 filter | D01–03; draft/apply/reset state ở B; cancel sheet không mutate applied. |
| S10 Giao dịch | B04/B05,P01/P02; NFT giới thiệu static UI, không endpoint ví/NFT. Reopen dùng bookingId không tạo cọc mới. |
| S11 Tôi | U01–08,F10/F13,D01 savedOnly,E06/E07,N03; chưa tự signup/delete-account workflow. |
| S12 deposit | B02,P01–04; chỉ server/provider verified đổi paid; mode disabled/simulation/live luôn rõ. |
| S13 clubs | K01/K02; intro only, không join/membership fees. |

### Discovery/filter
query optional trim1..100; search code/title/khu vực (parameterized), không parse budget free text thành tiền. regions list unique north/central/south (OR trong field); **Khu Công Nghiệp là category=industrial**, không region. Category single. provinceCode/districtCode từ catalog (district thuộc province); đổi province phải clear district. Catalog fixture codes minh họa, A chốt dataset địa giới trước seed nghiệp vụ hiện hành.
min/maxPriceVnd inclusive; null=max mở; UI10+ = maxPriceVnd omitted/null, không clamp ở10 tỷ. areaBands OR: below_100=[0,100), from_100_to_200=[100,200], above_200=(200,+∞); không overlap/hở. LandTypes list OR; minRoadWidthM >=0 inclusive; hasDocuments=true có>=1 metadata tài liệu được phép thấy, không cam kết download; savedOnly=false mặc định, true owner-only. Các field kết hợp AND.
Query arrays comma-separated (no repeated keys), bool literal, cursor/limit/sort strings. Defaults: lists=[], nullable criteria absent, savedOnly=false, sort=relevant. Relevant v0.1 đề xuất approval approved trước, updatedAt DESC,id DESC; không tuyên bố recommendation AI. Price asc/desc, area asc có id ASC tie-break.
selectedCriteriaCount= số nhóm khác mặc định: query, regions, category, province, district, budget(min/max tính1), areaBands, landTypes, minRoadWidthM, hasDocuments; sort/paging/savedOnly không tính. Fixture full filter có7; biến thể bỏ road/doc có5. Số128 từ ảnh là minh họa, không dùng total128 khi DB seed4 lô. A-03 đã duyệt quy ước count này; count và list phải cùng predicate/snapshot phù hợp.

### Booking/payment
attendeeCount1..slot.maxAttendees, maxAttendees6/maxBookings1 là cấu hình fixture được A-04 chấp thuận, không policy live. slot cùng property, sourceVideo cùng property. startsAt future theo server clock, property.status=listed, slot có khả năng phục vụ. Availability public không lộ user của slot. Slot limit/hold TTL/cancel/reschedule/no-show/payment-expiry còn open; không tự hold lâu hay release đã nhận tiền.
Create→awaiting_deposit / unpaid; verified succeeded→pending_confirmation; nhân sự được quyền xác nhận lịch→confirmed; chỉ nhân sự xác nhận buổi thực tế→completed. Giữ requestedStartsAt và confirmedStartsAt riêng, proposedMeetingArea khác confirmedMeetingLabel. Paid chưa bố trí người dẫn không confirmed. Exception status khung reserved, availableActions server allowlist [request_cancellation,request_reschedule,refresh_payment] hoặc[] nếu chưa chốt; không tự bật qua tên enum.
Payment indicative350000, amountVnd nullable khi chưa policy; không nhân attendeeCount, refund tự động hoặc hứa khấu trừ. policyVersion/chargeBasis/refund/cancel/reschedule đều nullable; chargeBasis reserved per_booking/per_person (chưa được chọn); livePaymentEnabled=false. Payment intent endpoint409 tới policy + provider readiness. Simulation chỉ isolated test, mode simulation + notice; không API công khai đánh dấu paid.
Client không gửi ownerId, amount, paymentStatus hay providerResult. Mismatch amount/reference/user/booking, duplicate/late callback, slot/property conflict→needs_review không confirmed. Provider webhook path/signature **chưa định nghĩa** tới P3-C3 kiểm tra tài liệu SePay, không đoán config.
Booking cancellation/reschedule yêu cầu chứ chưa promise success; policy chưa bật trả409. Không refund theo booking.status. Reconciliation/actor history append-only, public subset cho owner; không internal secret payload.

### Finance và quyết định A-01/A-04/A-05
- FinanceInput equityVnd+loanVnd=property.priceTotal hiện hành; termMonths multiples12 trong60..360, annualRatePercent0..100 tối đa6số lẻ, nonnegative. 0loan/0% valid. A-06: formulaVersion=xland-loan-v1, roundingRule=VND_HALF_UP_MONTHLY_LAST_ADJUST; r=annualRatePercent/1200 chính xác, HALF_UP tới1VND cho từng tháng, kỳ cuối trả hết dư nợ. Equal: A=round(P*r*(1+r)^n/((1+r)^n-1)), hoặc round(P/n) khi0%; interest=round(B*r), k<n principal=min(B,max(0,A-interest)), k=n principal=B. Declining: Q=round(P/n), interest=round(B*r), k<n principal=min(B,Q), k=n principal=B. Khi B=0 các kỳ sau0. Totals=sum(schedule), tổng principal=P và cuối B=0, không monthlyPayment*n.
- monthlyPaymentVnd là payment **tháng đầu**, bằng firstMonthPrincipal+firstMonthInterest. Declining UI ghi “Khoản trả tháng đầu (giảm dần)”; equal ghi “Khoản trả hàng tháng ước tính; kỳ cuối có điều chỉnh”. Lãi suất giả định; estimateNotice “Ước tính minh họa; không phải đề nghị cấp tín dụng; chưa gồm phí, thuế, bảo hiểm”. Bỏ số3.3/7.5triệu từ ảnh làm expected. Mọi outputVnd<=20digits; overflow→400 INVALID_INPUT details [{field:loanVnd,code:FINANCE_RESULT_OUT_OF_RANGE}], không giới hạn trung gian rational. Input lệch giá→400 details equityVnd/loanVnd code PRICE_MISMATCH, UI tải lại giá; không tự sửa input. Không thêm public schedule endpoint/field.
- N02 lock/current-price snapshot, recompute server và lưu input/result/formulaVersion/roundingRule/price_snapshot nguyên tử. Idempotent retry giữ response cũ cả khi giá sau đó đổi. N03 đọc lịch sử, giữ result:null của plan cũ, không backfill/seed overwrite. Advice qua S01 loan_advice hiện hữu.
- SupportKind chat/legal_review/loan_advice/consultant_appointment/location_inquiry theo A-04 tạo ticket với consentToShareContact=true. Initial status received=đã lưu/nhận; pending=đang chờ xử lý, responded/closed chỉ staff workflow. recipientLabel có thể là bộ phận chung, không ngụ ý phân công người thật. Property/consultant tối thiểu1 phù hợp kind; location/legal/loan cần propertyId, appointment cần consultantId. Không realtime inbox, SLA hoặc promise cấp vay. Operator do chủ dự án chỉ định trước pilot.
- Auth A-01: Express quản lý username/password trong PostgreSQL nội bộ; Supabase chỉ host PostgreSQL. Không Supabase Auth/email/JWT/JWKS. U01 TokenSession={accessToken:string,session:Session}; accessToken là opaque bearer do server sinh ngẫu nhiên, client không decode/nhận userId tự khai; domain Session chỉ profile/expiresAt. U02 reserved/not implemented, không refresh token. Identity UUID không bao giờ tái sử dụng.
- /auth/session401 được AccountRepository.getSession chuyển null; các mutation401 vẫn XlandFailure. Logout nếu upstream revoke lỗi phải báo lỗi và xóa cache local, không nói session remote đã revoke. Signup/OTP/social/reset/change-password/account-deletion không mở trong baseline A-01.
- A-04 settings: notificationConsent (không đồng nghĩa OS permission/push delivery), feedAutoplay, feedMutedByDefault; locale=vi_VN, zone=Asia/Ho_Chi_Minh read-only và updatedAt. Guest playback preferences chỉ local, không ghi DB; account sync cần session. Contact change reset verified; chưa có verification provider, không tick tự động hoặc darkMode/language switch giả.
- A-05 media approved HTTPS qua adapter; private documents qua A-02 grant/signed download tối đa300s. Null URL dùng fallback rõ minh họa. Chưa chọn/cài provider hoặc upload API; không coi fallback là playback Pass.
- A-05 map/media dùng adapter độc lập provider, approximate location và nullable media fallback có nhãn. G1 không đòi account map/media thật; provider/tile config/attribution/license là dependency trước nghiệm thu map/playback Phase2/3, không endpoint công cộng mặc định production. Share URL = public base URL config + canonical resource path; thiếu host thật trả FEATURE_NOT_ENABLED/unavailable có giải thích, không mở example.invalid trong runtime. Universal links/web route chưa kiểm chứng.


### A-01 — Login/session input và vòng đời
- Username trim + lowercase ASCII, 3..64 ký tự [a-z0-9._-]; không Unicode, không email login. Password8..128 Unicode code points là giới hạn input C-3, không trim/đổi chữ; reject NUL. Backend phải validate trước lookup, hash có salt/Argon2id ưu tiên và benchmark/pin ở Phase2, không hash/storage algorithm trong public API.
- Credential chỉ provision qua môi trường bảo mật ở Phase2; fixture U01 là redacted template không thực thi, không tài khoản/mật khẩu có thể login. Sai username/password, account disabled hoặc session invalid đều401 UNAUTHENTICATED generic, không username enumeration. Validation400 field/code không echo password. Rate limit429, không logging credential/body/token.
- Opaque access token random tối thiểu256bits, HTTPS Authorization: Bearer; DB chỉ lưu digest, userId, createdAt/expiresAt/revokedAt. Hạn tuyệt đối24h dev/test, không sliding/refresh; U02 reserved. Logout thu hồi current session; hết hạn/thu hồi401, đăng nhập lại. Không đưa username/hash/session record hoặc bearer vào profile/public API/domain Session.
- Guest đọc feed recommended/discovery/public property/consultant/event/club và mở booking form; mutation và private reads yêu cầu session/owner. Login chuyển màn giữ input/return target; thành công quay về **xác nhận gửi**, không tự phát lại booking/payment. Hủy login giữ guest, không success giả. Following scope cần session dù GET, logout trở về recommended.
- Phase2 cần test login đúng/sai, normalized username/unchanged password, unique username/UUID không reuse, expiry24h/revocation/rate limit, guest denial/private cross-user, DB role/grant/pool isolation. Phase1 chưa triển khai auth/session/API/DB.

## 4. Enum và schema chuẩn (wire)
Dart enum lowerCamelCase map **explicit** sang wire sau; không dùng .name cho giá trị snake_case.

| Enum | Allowed values |
|---|---|
| Region | north, central, south |
| FeedScope | recommended, following |
| PropertyCategory | residential, industrial, agricultural, other |
| LandType | residential, agricultural, other |
| PropertyStatus | listed, paused, sold |
| ApprovalStatus | pending, approved |
| SourceBadge | board_source, standard |
| LegalStatus | verified, pending |
| DocumentAccess | public_redacted, authenticated, granted |
| MediaKind | image, video |
| AmenityCategory | utility, traffic, living |
| BookingStatus | draft, awaiting_deposit, pending_confirmation, confirmed, completed, expired, cancel_requested, cancelled, reschedule_requested, rejected, no_show |
| PaymentStatus | unpaid, pending, succeeded, failed, expired, needs_review, refund_pending, refunded |
| PaymentMode | disabled, simulation, live |
| TransportMode | self_arranged, needs_assistance |
| RepaymentMethod | equal_installment, declining_balance |
| SupportKind | chat, legal_review, loan_advice, consultant_appointment, location_inquiry |
| SupportStatus | received, pending, responded, closed |
| EventStatus | open, sold_out, closed, cancelled |
| RegistrationStatus | pending, registered, cancelled |
| PropertySort | relevant, newest, price_asc, price_desc, area_asc |
| AreaBand | below_100, from_100_to_200, above_200 |

Direction string nullable allowed north/northeast/east/southeast/south/southwest/west/northwest. Document MIME v0.1 application/pdf,image/jpeg,image/png; iconType school/hospital/market/road/other. Notification/locale/zone semantics xem §3. Reviews immutable demo rating0..5.

Schema fields liệt kê theo Dart; ?=nullable, List<T>=array, Page<T>=envelope adapter. Input optional nullable có thể omitted; required input theo §1/§3. Output ví dụ tại fixture.sampleTypes.<Type>; SignInInput credential không nằm trong sampleTypes. Hai flag ProfileUpdate bên dưới chỉ domain/data, không HTTP fields.

### property

**MediaAsset**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| kind | MediaKind | no |
| url | Uri | yes |
| thumbnailUrl | Uri | yes |
| durationSeconds | int | yes |
| altText | String | no |
| isIllustrative | bool | no |

**Highlight**

| Field | Type | Nullable |
|---|---|---|
| title | String | no |
| description | String | no |

**Property**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| code | String | no |
| title | String | no |
| provinceCode | String | no |
| provinceName | String | no |
| districtCode | String | no |
| districtName | String | no |
| region | Region | no |
| category | PropertyCategory | no |
| priceTotal | Vnd | no |
| pricePerM2 | Vnd | no |
| areaM2 | DecimalValue | no |
| frontageM | DecimalValue | yes |
| depthM | DecimalValue | yes |
| roadWidthM | DecimalValue | yes |
| direction | String | yes |
| landType | LandType | no |
| status | PropertyStatus | no |
| approvalStatus | ApprovalStatus | no |
| sourceBadge | SourceBadge | no |
| consultantId | String | no |
| media | List&lt;MediaAsset&gt; | no |
| highlights | List&lt;Highlight&gt; | no |
| verifiedLegalCount | int | no |
| totalLegalCount | int | no |
| isSaved | bool | no |
| updatedAt | DateTime | no |
| isIllustrative | bool | no |

**PropertyFilter**

| Field | Type | Nullable |
|---|---|---|
| query | String | yes |
| regions | List&lt;Region&gt; | no |
| category | PropertyCategory | yes |
| provinceCode | String | yes |
| districtCode | String | yes |
| minPriceVnd | Vnd | yes |
| maxPriceVnd | Vnd | yes |
| areaBands | List&lt;AreaBand&gt; | no |
| landTypes | List&lt;LandType&gt; | no |
| minRoadWidthM | DecimalValue | yes |
| hasDocuments | bool | yes |
| savedOnly | bool | no |
| sort | PropertySort | no |

**FilterOption**

| Field | Type | Nullable |
|---|---|---|
| code | String | no |
| label | String | no |
| parentCode | String | yes |

**FilterCatalog**

| Field | Type | Nullable |
|---|---|---|
| provinces | List&lt;FilterOption&gt; | no |
| districts | List&lt;FilterOption&gt; | no |
| minBudgetVnd | Vnd | no |
| openUpperBudgetVnd | Vnd | no |

**PropertySearchResult**

| Field | Type | Nullable |
|---|---|---|
| page | Page&lt;Property&gt; | no |
| total | int | no |
| selectedCriteriaCount | int | no |

**LegalItem**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| title | String | no |
| subtitle | String | yes |
| checkedDate | String | yes |
| status | LegalStatus | no |
| sortOrder | int | no |

**PropertyDocument**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| title | String | no |
| mimeType | String | no |
| sizeBytes | int | no |
| uploadedDate | String | no |
| previewUrl | Uri | yes |
| access | DocumentAccess | no |
| canDownload | bool | no |

**LegalSummary**

| Field | Type | Nullable |
|---|---|---|
| propertyId | String | no |
| items | List&lt;LegalItem&gt; | no |
| documents | List&lt;PropertyDocument&gt; | no |
| verifiedCount | int | no |
| totalCount | int | no |
| scopeNotice | String | no |

**ApproximateLocation**

| Field | Type | Nullable |
|---|---|---|
| latitude | double | no |
| longitude | double | no |
| radiusM | int | no |
| label | String | no |

**Amenity**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| category | AmenityCategory | no |
| name | String | no |
| distanceText | String | no |
| iconType | String | no |
| latitude | double | yes |
| longitude | double | yes |

**AreaInfo**

| Field | Type | Nullable |
|---|---|---|
| propertyId | String | no |
| location | ApproximateLocation | no |
| amenities | List&lt;Amenity&gt; | no |
| photos | List&lt;MediaAsset&gt; | no |
| providerAttribution | String | no |
| externalMapUrl | Uri | yes |

### social

**PublicAuthor**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| displayName | String | no |
| role | String | yes |
| avatarUrl | Uri | yes |
| isVerified | bool | no |
| isFollowing | bool | no |

**AuthorProfile**

Wire object gồm toàn bộ field của PublicAuthor và các field sau. Mobile nhóm phần PublicAuthor vào `AuthorProfile.author`. Không trả contact hoặc thông tin tài khoản riêng.

| Field | Type | Nullable |
|---|---|---|
| videoCount | int | no |
| followerCount | int | no |
| consultantId | String | yes |
| isIllustrative | bool | no |

`consultantId` chỉ có khi chính người đăng có bản ghi consultants, bằng PublicAuthor.id; không lấy từ lô đất. `videoCount` chỉ đếm video công khai.

**FeedVideo**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| author | PublicAuthor | no |
| media | MediaAsset | no |
| caption | String | no |
| approximateArea | String | no |
| property | Property | no |
| likeCount | int | no |
| commentCount | int | no |
| viewCount | int | no |
| isLiked | bool | no |
| isSaved | bool | no |
| publishedAt | DateTime | no |
| isIllustrative | bool | no |

**VideoComment**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| videoId | String | no |
| author | PublicAuthor | no |
| text | String | no |
| createdAt | DateTime | no |
| canDelete | bool | no |

### consultant

**Consultant**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| name | String | no |
| role | String | no |
| location | String | no |
| isVerified | bool | no |
| avatarUrl | Uri | yes |
| coverUrl | Uri | yes |
| videoCount | int | no |
| followerCount | int | no |
| rating | DecimalValue | yes |
| isFollowing | bool | no |
| nextAvailableAt | DateTime | yes |
| supportRecipientLabel | String | yes |
| isIllustrative | bool | no |

**ConsultantReview**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| consultantId | String | no |
| authorDisplayName | String | no |
| rating | DecimalValue | no |
| text | String | no |
| createdAt | DateTime | no |
| isIllustrative | bool | no |

### event

**AgendaItem**

| Field | Type | Nullable |
|---|---|---|
| startsAt | DateTime | no |
| title | String | no |

**Speaker**

| Field | Type | Nullable |
|---|---|---|
| name | String | no |
| role | String | no |
| avatarUrl | Uri | yes |

**EventBenefit**

| Field | Type | Nullable |
|---|---|---|
| title | String | no |
| description | String | no |

**XlandEvent**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| title | String | no |
| tags | List&lt;String&gt; | no |
| media | List&lt;MediaAsset&gt; | no |
| startsAt | DateTime | no |
| endsAt | DateTime | no |
| timeZone | String | no |
| venueName | String | no |
| address | String | no |
| maxSlots | int | no |
| remainingSlots | int | no |
| durationMinutes | int | no |
| ticketPriceVnd | Vnd | no |
| status | EventStatus | no |
| agenda | List&lt;AgendaItem&gt; | no |
| speakers | List&lt;Speaker&gt; | no |
| benefits | List&lt;EventBenefit&gt; | no |
| isSaved | bool | no |
| isIllustrative | bool | no |

**EventRegistrationInput**

| Field | Type | Nullable |
|---|---|---|
| eventId | String | no |
| contactName | String | no |
| contactPhone | String | no |
| attendeeCount | int | no |

**EventRegistration**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| eventId | String | no |
| status | RegistrationStatus | no |
| attendeeCount | int | no |
| ticketPriceVnd | Vnd | no |
| paymentMode | PaymentMode | no |
| notice | String | no |
| createdAt | DateTime | no |

### booking

**AvailabilitySlot**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| consultantId | String | yes |
| startsAt | DateTime | no |
| endsAt | DateTime | no |
| timeZone | String | no |
| isAvailable | bool | no |
| unavailableReason | String | yes |
| meetingArea | ApproximateLocation | no |
| maxAttendees | int | no |

**BookingInput**

| Field | Type | Nullable |
|---|---|---|
| propertyId | String | no |
| slotId | String | no |
| sourceVideoId | String | yes |
| attendeeCount | int | no |
| transportMode | TransportMode | no |
| requestDocuments | bool | no |
| requestLoanAdvice | bool | no |
| contactName | String | no |
| contactPhone | String | no |
| note | String | yes |

**DepositPolicy**

| Field | Type | Nullable |
|---|---|---|
| indicativeAmountVnd | Vnd | no |
| policyVersion | String | yes |
| chargeBasis | String | yes |
| refundPolicyText | String | yes |
| cancellationPolicyText | String | yes |
| reschedulePolicyText | String | yes |
| livePaymentEnabled | bool | no |
| notice | String | no |

**BookingHistoryItem**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| fromStatus | BookingStatus | no |
| toStatus | BookingStatus | no |
| occurredAt | DateTime | no |
| actorLabel | String | no |
| publicNote | String | yes |

**Booking**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| sourceVideoId | String | yes |
| consultantId | String | yes |
| slotId | String | no |
| property | Property | no |
| requestedStartsAt | DateTime | no |
| confirmedStartsAt | DateTime | yes |
| timeZone | String | no |
| proposedMeetingArea | ApproximateLocation | no |
| confirmedMeetingLabel | String | yes |
| attendeeCount | int | no |
| transportMode | TransportMode | no |
| requestDocuments | bool | no |
| requestLoanAdvice | bool | no |
| contactName | String | no |
| maskedContactPhone | String | no |
| status | BookingStatus | no |
| paymentStatus | PaymentStatus | no |
| depositPolicy | DepositPolicy | no |
| history | List&lt;BookingHistoryItem&gt; | no |
| availableActions | List&lt;String&gt; | no |
| createdAt | DateTime | no |
| updatedAt | DateTime | no |
| isIllustrative | bool | no |

**PaymentInstructions**

| Field | Type | Nullable |
|---|---|---|
| qrImageUrl | Uri | yes |
| bankName | String | yes |
| accountName | String | yes |
| maskedAccountNumber | String | yes |
| transferContent | String | yes |

**PaymentRecord**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| bookingId | String | no |
| amountVnd | Vnd | yes |
| status | PaymentStatus | no |
| mode | PaymentMode | no |
| reference | String | yes |
| expiresAt | DateTime | yes |
| receivedAt | DateTime | yes |
| instructions | PaymentInstructions | yes |
| policyVersion | String | yes |
| notice | String | no |
| updatedAt | DateTime | no |

**BookingChangeInput**

| Field | Type | Nullable |
|---|---|---|
| reason | String | no |
| requestedSlotId | String | yes |

### account

**UserProfile**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| displayName | String | no |
| avatarUrl | Uri | yes |
| contactPhone | String | yes |
| contactVerified | bool | no |
| updatedAt | DateTime | no |

**ProfileUpdate**

| Field | Type | Nullable |
|---|---|---|
| displayName | String | yes |
| avatarUrl | Uri | yes |
| contactPhone | String | yes |

A-07 extension domain/data: optional `bool clearAvatar=false`, `clearContactPhone=false`, giữ constructor cũ tương thích. False+null→omit, false+value→set, true+null→explicit wire null. True+value cùng field→XlandFailure.invalidInput **trước HTTP**, validation có hiệu lực release (không chỉ assert). Không gửi flag lên U06; server vẫn strict omission/null PATCH C-3 và reject unknown flag fields. Repository method signatures không đổi. Input-only ProfileUpdate không dùng generated response mapper.

**UserSettings**

| Field | Type | Nullable |
|---|---|---|
| notificationConsent | bool | no |
| locale | String | no |
| timeZone | String | no |
| feedAutoplay | bool | no |
| feedMutedByDefault | bool | no |
| updatedAt | DateTime | no |

**SettingsUpdate**

| Field | Type | Nullable |
|---|---|---|
| notificationConsent | bool | yes |
| feedAutoplay | bool | yes |
| feedMutedByDefault | bool | yes |

**Session**

| Field | Type | Nullable |
|---|---|---|
| profile | UserProfile | no |
| expiresAt | DateTime | no |

**SignInInput**

| Field | Type | Nullable |
|---|---|---|
| username | String | no |
| password | String | no |

**Club**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| title | String | no |
| summary | String | no |
| description | String | no |
| regionLabel | String | no |
| activities | List&lt;String&gt; | no |
| media | List&lt;MediaAsset&gt; | no |
| supportRecipientLabel | String | yes |
| isIllustrative | bool | no |

**SupportRequestInput**

| Field | Type | Nullable |
|---|---|---|
| kind | SupportKind | no |
| propertyId | String | yes |
| consultantId | String | yes |
| message | String | no |
| contactName | String | no |
| contactPhone | String | no |
| consentToShareContact | bool | no |

**SupportRequest**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| kind | SupportKind | no |
| status | SupportStatus | no |
| recipientLabel | String | no |
| notice | String | no |
| createdAt | DateTime | no |

### finance

**FinanceInput**

| Field | Type | Nullable |
|---|---|---|
| propertyId | String | no |
| equityVnd | Vnd | no |
| loanVnd | Vnd | no |
| termMonths | int | no |
| annualRatePercent | DecimalValue | no |
| method | RepaymentMethod | no |

**FinanceResult**

| Field | Type | Nullable |
|---|---|---|
| input | FinanceInput | no |
| monthlyPaymentVnd | Vnd | no |
| firstMonthPrincipalVnd | Vnd | no |
| firstMonthInterestVnd | Vnd | no |
| totalInterestVnd | Vnd | no |
| totalRepaymentVnd | Vnd | no |
| formulaVersion | String | no |
| roundingRule | String | no |
| estimateNotice | String | no |

**SavedFinancePlan**

| Field | Type | Nullable |
|---|---|---|
| id | String | no |
| propertyId | String | no |
| label | String | no |
| input | FinanceInput | no |
| result | FinanceResult | yes |
| createdAt | DateTime | no |

### Common shapes
PageQuery={cursor:string|null,limit:int}; Page<T>={items:T[],hasMore:bool,nextCursor:string|null,total:int|null} **domain only**, wire data array + meta. MutationResult={active:bool,count:int|null}. ShareLink={url:HTTPS,title:string}. DownloadGrant={url:HTTPS,expiresAt:instant,fileName:string,mimeType:string,sizeBytes:int}. CountResult={total:int,selectedCriteriaCount:int}; TokenSession={accessToken:string,session:Session}, data-only sensitive login response; không refreshToken. HTTP error details fieldIssues[]; domain FailureCode map từ code, requestId nullable cho offline/timeout; retryAfterSeconds từ Retry-After. Không dynamic public domain contract.

## 5. Bắt đầu fake và constructor DI
- Import duy nhất B cần: `package:xland_mobile/domain/xland_domain.dart`. Models dưới lib/domain/entities; interface tại lib/domain/repositories/xland_repositories.dart. Không import DTO/data/bootstrap để fake.
- `XlandDependencies` Dart thuần tại lib/domain/repositories/xland_dependencies.dart tập hợp10 interfaces. Đề xuất B constructor `XLandApp({super.key, required XlandDependencies dependencies})`; Cubit nhận riêng interface cần thiết. C composition root sau G1/giai đoạn wiring mới inject implementations; không sửa presentation/app/xland_app.dart.
- Repository methods Future<T>, failures throw XlandFailure. No-op DELETE returns Future<void>; mutation result server authoritative, rollback UI nếu lỗi. getSession là Future<Session?>; token chỉ data layer.
- XlandFailure là final class với FailureCode, không sealed union; named constructors notFound/forbidden/unauthenticated/conflict chỉ tiện tạo fake. Các code policyNotConfigured/featureNotEnabled vẫn dùng constructor(code:...,message:...), không conflict(reason:...). Vnd.fromInt chỉ <=9007199254740991; số lớn dùng Vnd(decimal-string), không double.
- Fixture candidate [v0.1.json](logs/agent-c/fixtures/v0.1.json) có contractRevision=C-4-candidate; [operations](logs/agent-c/fixtures/operations.v0.1.json) giữ63active+U02reserved, thêm finance success và clear-contact wire example. Plan legacy result:null vẫn nguyên. Schema reference candidate là schema.C4.candidate.json; schema.C3.json và snapshot G1 giữ nguyên. Fake ở test/dev injection explicit, không fallback JSON khi API production lỗi.
- B review candidate constructor flags/fakes/clear-keep-set trong P2_C4_REVIEW.md; A khóa hash sau review snapshot. C-4 **chưa locked**; những hành vi không ảnh hưởng tiếp tục C-3.

## 6. Quyết định A đã chốt và dependency còn mở
A-01..05 baseline C-3 đã G1 Pass; A-06 đóng SPEC-001 về đặc tả calculator, A-07 duyệt clear flags, A-09 xác nhận Supabase mock. Runtime/candidate vẫn chờ A nghiệm thu. Còn mở: PAY-001/002/SePay/per-person/refund/TTL/no-show trước payment live; catalog vận hành/provider/media rights/public host/operator trước pilot; native/signing. Không suy calculator thành policy cọc.
Đề xuất/tradeoff và thiết kế schema/ERD/seed plan tại [P1_DATABASE_DESIGN.md](logs/agent-c/P1_DATABASE_DESIGN.md), [P1_TECHNICAL_DECISIONS.md](logs/agent-c/P1_TECHNICAL_DECISIONS.md). G1 do A xét, không dùng draft thay approval.

