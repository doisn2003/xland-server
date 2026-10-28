# Một hồ sơ — nhiều lô đất

Triển khai ngày 27/10/2026 trong ba repository server, website và Flutter. Lượt sửa form sau đó đã nâng cấp database mock đang dùng và restart backend localhost; chi tiết tại [PROPERTY_FORM](PROPERTY_FORM.md). Chưa phát hành server/web/Flutter từ xa.

## Mô hình

Migration `0020_property_subplots.sql` bổ sung vào `xland.properties`:

| Cột | Ý nghĩa |
| --- | --- |
| `parent_property_id uuid NULL` | FK tự tham chiếu; `NULL` là hồ sơ gốc; `ON DELETE RESTRICT` |
| `has_subplots boolean NOT NULL DEFAULT false` | Bật studio nhiều lô; cũng dùng cho badge công khai |
| `is_corner boolean NOT NULL DEFAULT false` | Đặc điểm lô góc, độc lập từng hồ sơ |

Mỗi lô con là một property đầy đủ, giữ nguyên UUID, media, tài liệu, pháp lý, tiện ích, tư vấn viên, lịch hẹn, lưu yêu thích và các API hiện có. Lô con có thể tiếp tục bật `has_subplots`. Không tạo loại hồ sơ rút gọn riêng.

Trigger kiểm tra lô cha tồn tại và bật chế độ nhiều lô, không tự làm cha hoặc tạo vòng lặp, tổng diện tích các con trực tiếp không vượt cha, không thu nhỏ cha dưới diện tích đã phân bổ, không tắt chế độ khi còn con. Dùng numeric PostgreSQL chính xác 6 chữ số thập phân; giá vẫn là chuỗi VND. Cho phép phân bổ dần, studio hiển thị phần diện tích còn lại. Giá hồ sơ cha độc lập với giá các con, không tự cộng hoặc chia đều.

Các mutation cây/diện tích được tuần tự hóa bằng advisory transaction lock `(193726,19)` trước row lock. Trigger statement bảo vệ cả thao tác SQL trực tiếp; service lấy cùng lock trước `FOR UPDATE`. Đây là lựa chọn đơn giản cho luồng ghi quản trị; nếu lưu lượng quản trị lớn cần đo contention trước khi chuyển sang khóa theo cây.

## API

| API | Chức năng |
| --- | --- |
| `GET /api/v1/properties/:id/children?limit=4&cursor=...` | Các con trực tiếp; DTO Property đầy đủ; meta total/hasMore/nextCursor; sắp code/id; cursor gắn parent và người dùng |
| `POST /api/v1/admin/properties/:id/children` | Tạo con và sao chép hồ sơ trong một transaction; bắt buộc `_version` của cha, `code`, `title`, `area_m2`, `price_total` |
| `GET /api/v1/admin/properties/:id/aggregate` | Bổ sung `parent` và `subdivision`: số lô, tổng diện tích đã phân bổ/còn lại, số đang bán/đã bán/chờ duyệt |
| `GET /api/v1/admin/properties?filter=parent_property_id&value=:id` | Danh sách lô con admin, tìm kiếm và phân trang hiện hành |
| `PATCH /api/v1/admin/properties/:id` | Chỉnh toàn bộ hồ sơ từng lô; bật/tắt nhiều lô; chuyển quan hệ qua trường Lô đất cha, với các trigger bảo vệ |

Property wire bổ sung `parentPropertyId`, `hasSubplots`, `isCorner`. Mapper Flutter và decoder web mặc định null/false khi backend cũ chưa gửi các trường này. Bootstrap mobile bật operation D08. BFF web chỉ cho phép GET children với limit/cursor, không mở mutation admin cho phiên user.

Danh mục khám phá `/properties` nhóm theo hồ sơ gốc để không đếm lặp cùng mảnh đất. Danh sách đã lưu vẫn chứa lô con đã lưu theo quy tắc status hiện hành. Endpoint children hiển thị các trạng thái bán đã được duyệt, gồm đã bán/tạm dừng, với trạng thái riêng.

RLS yêu cầu bản thân lô và mọi tổ tiên đều được duyệt. Hàm SECURITY DEFINER chỉ trả boolean, sở hữu bởi role `xland_admin` không BYPASSRLS, khóa search_path, không trả dữ liệu tổ tiên. Các projection công khai tiếp tục không có tọa độ riêng, storage key hay thông tin admin. Moderator dùng quyền tạo/cập nhật sẵn có; namespace admin bắt buộc phiên quản trị.

## Kế thừa và vòng đời

Tạo lô con là **bản sao tại thời điểm tạo**. Các lần sửa cha sau đó không ghi đè dữ liệu lô con.

- Sao chép các trường hồ sơ, gallery/area media, tài liệu với mức truy cập gốc, tiện ích và checklist pháp lý. Tạo UUID mới cho các bản ghi con; tệp Storage được tham chiếu lại, không tải lại hoặc sửa tệp gốc.
- Giá, diện tích, tên, mã được nhập riêng. Mặt tiền/chiều sâu và lô góc chỉnh riêng trong form; sau tạo có toàn bộ editor sẵn có.
- Luôn tạo ở `approval_status=pending`, `status=paused`. Checklist pháp lý chuyển về pending và bỏ ngày đối chiếu; không kế thừa kết luận xác minh cho một diện tích mới.
- Không sao chép booking, slot, payment, video feed, lịch sử giao dịch hoặc quyền tài liệu đã cấp cho cá nhân. Các luồng này tiếp tục gắn UUID của từng lô.
- Xmin của cha thay đổi khi tạo con. Gửi lại sau timeout bằng version cũ bị conflict thay vì tạo trùng. Cùng code bị ràng buộc unique; lỗi bất kỳ rollback cả lô và nội dung sao chép.
- Quản trị chuyển lô sang hồ sơ cha khác hoặc bỏ quan hệ trong Thông tin cơ bản. Chuyển quan hệ không sao chép lại nội dung. Không bổ sung hard delete hồ sơ có lịch sử.

## Giao diện và vận hành

Admin bật toggle **Nhiều lô đất con** để mở tab studio: tổng diện tích, phân bổ/còn lại, trạng thái, form tạo lô, tìm kiếm và danh sách. Mỗi card mở chính studio đầy đủ; có đường về cha và link website đúng `/lo-dat/:id`.

Web và Flutter có badge; Tổng quan hiển thị hai cột, tối đa bốn lô mỗi trang, tải/lỗi/thử lại/rỗng, giá và đặc điểm lô góc. Mở con dùng cùng màn chi tiết, tiếp tục lồng nhau. Web bổ sung điều hướng Tổng quan/Pháp lý/Khu vực/Tài chính.

Thứ tự rollout: backup và chạy migration bằng runner hiện hành; deploy server; smoke test admin và user API; deploy web; phát hành Flutter. Server mới tương thích client cũ bỏ qua trường bổ sung; client mới có fallback trường khi kết nối server cũ. Không chạy seed QA trên dữ liệu dùng chung. Khi rollback ứng dụng giữ migration và dữ liệu cây để không mất quan hệ.

## Kiểm tra

- `npm run test:admin`: thêm kịch bản trong `tests/admin/subplots.mjs` cho tạo/kế thừa, pending, recursion, cursor, sold, overflow diện tích, tự tham chiếu/vòng lặp, RLS tổ tiên, race và rollback.
- `npm run test:contract`: kiểm wire schema hiện hành; snapshot Dart và checksum được cập nhật rõ ràng.
- Web: `tests/e2e/subplots.spec.ts`, `tests/admin/subplots.spec.ts`, `tests/unit/subplots.test.ts`; ảnh 360/390/430/768/1440px trong repository website, `docs/qa/2026-10-27-subplots/`.
- Flutter: `test/presentation/property_children_test.dart` và bài repository D08; hồi quy chi tiết, khám phá và so sánh.

Kết quả chạy cuối và giới hạn ghi tại `xland-website/xland/docs/STATUS.md`. Không coi dữ liệu QA, ảnh trình duyệt hoặc widget test là nghiệm thu production/thiết bị thật.
