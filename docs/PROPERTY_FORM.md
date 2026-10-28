# Loại đất, địa chỉ và kiểu hồ sơ — 27/10/2026

## Hành vi

- Admin chọn **Một lô đất / Nhiều lô đất con** ở đầu form tạo. Bật chế độ nhiều lô rồi lưu sẽ mở studio của chính hồ sơ vừa tạo. Form không mất nội dung khi đổi chế độ. Studio dùng cùng switch; không cho tắt khi còn lô con hoặc đang sửa thông tin chưa lưu.
- Chỉ có một trường **Loại đất**, lấy `category` làm nguồn chính: đất ở, đất nông nghiệp, đất công nghiệp, khác. `land_type` là projection tương thích ba giá trị cho ứng dụng cũ; công nghiệp ánh xạ thành `other`. Backend và constraint không cho hai giá trị mâu thuẫn. Không gộp trường `category` của tiện ích hoặc các entity khác.
- Tạo mới mặc định địa giới hiện hành: **Tỉnh/thành phố → Xã/phường/đặc khu**. Danh mục độc lập với các lô đã đăng, có 34 tỉnh/thành và 3.321 xã/phường/đặc khu. Đổi tỉnh sẽ xóa lựa chọn xã. Tìm kiếm hỗ trợ tiếng Việt không dấu. Mã, phiên bản danh mục và miền được hệ thống xử lý.
- **Địa chỉ chi tiết** và **Địa chỉ cũ** là văn bản tùy chọn, tối đa 500/1.000 ký tự; chuỗi trắng được lưu `NULL`. Địa chỉ cũ hiển thị trong Tổng quan website và Flutter khi có nội dung; không có nội dung thì không dựng một ô trống.
- Hồ sơ cũ giữ nguyên mã/tên địa giới. Migration chép địa chỉ đang lưu sang `old_address`, không đoán xã mới từ huyện cũ. Admin có nút chuyển sang địa giới hiện hành. Sửa giá, bật nhiều lô hoặc sửa địa chỉ cũ không ép phải chuyển địa giới.
- Lô con kế thừa địa chỉ hiện hành, địa chỉ chi tiết và địa chỉ cũ tại thời điểm tạo, cùng quy tắc snapshot của hồ sơ. Sửa cha sau đó không ghi đè con.

## Schema và API

`0022_property_address_and_land_type.sql` thêm `geo_catalogs`, loại địa giới `commune`, `properties.commune_code`, `address_detail`, `old_address`; cho phép district/district_code rỗng với địa giới hiện hành. Trigger kiểm quan hệ xã–tỉnh, tự xác định tên và miền, chặn loại đất mâu thuẫn. Các bảng vẫn FORCE RLS, public chỉ có quyền đọc projection được cấp.

`0023_current_geography_catalog.sql` nạp danh mục `vn-2026-09-20`. Dữ liệu hiện hành nằm trong migration, không cần gọi dịch vụ ngoài khi admin mở form. Nguồn máy đọc là bản chép cộng đồng MIT được khóa commit và checksum; [provenance](../data/geography/provenance.json) ghi nguồn, ngày hiệu lực và tham chiếu chính thức. Đã đối chiếu [danh mục nghị định/nghị quyết](https://danhmuchanhchinh.nso.gov.vn/NghiDinh.aspx), gồm thay đổi Quảng Ninh thành thành phố. Không mô tả bộ JSON cộng đồng là API chính thức.

Wire Property thêm nullable `communeCode`, `communeName`, `addressDetail`, `oldAddress`. `districtCode/districtName` trả chuỗi rỗng khi không áp dụng để client cũ vẫn giải mã được. Catalog `/api/v1/catalog/locations?provinceCode=22` thêm `communes`; lọc danh sách/count thêm `communeCode` và kiểm xã thuộc tỉnh. Catalog public giữ mã tỉnh lịch sử cần cho việc tìm hồ sơ cũ, có nhãn “địa giới cũ”; form tạo admin chỉ dùng danh mục active.

Web decoder và Flutter mapper đọc được DTO cũ thiếu trường bổ sung. Tất cả giao diện mới dùng `category` để hiện Loại đất. Filter không còn hai bộ lựa chọn loại đất cạnh tranh nhau.

## Nguyên nhân lỗi toggle và cập nhật môi trường

Backend localhost:3005 chạy từ trước thay đổi và database có ledger dừng ở 0014; chưa có các cột của phân lô. Schema metadata khiến PATCH `has_subplots` bị coi là trường không hợp lệ. Server mới báo `503 SCHEMA_OUTDATED` rõ nguyên nhân khi thiếu schema; `/health/ready` kiểm cột và danh mục thay vì chỉ kiểm kết nối DB.

Managed PostgreSQL còn yêu cầu chủ sở hữu mới có CREATE trên schema khi chuyển ownership hai function của 0020. Hai migration cầu nối `0019a`/`0020a` cấp rồi thu hồi quyền này trong cùng transaction; giữ checksum 0020. Runtime `xland_admin` không được giữ quyền tạo object.

`node --import tsx scripts/upgrade-property-admin.mjs --apply` chỉ chạy trên fingerprint Supabase mock đã được cấu hình cho dự án. Script sao lưu toàn bộ bảng, kiểm SHA-256, khôi phục vào DB QA riêng, so digest từng bảng và thử migration bằng role không phải superuser trước khi apply. Không reset tài khoản hoặc seed dữ liệu nghiệp vụ. Nếu phát hiện 0018/0019 đã được chạy thủ công, chỉ đối soát ledger sau khi kiểm đủ column, constraint và grant tương ứng; không sửa checksum migration cũ.

Ngày 27/10 đã thực hiện: backup 43 bảng, restore 2.080 dòng khớp digest, giữ 23 hồ sơ; áp dụng các migration còn thiếu đến 0023. Bản sao lưu và biên bản chi tiết ở `.backups/` và `.local/property-upgrade-result.json` (không đưa vào Git). Backend localhost:3005 đã restart; `.env.local` website admin/user cùng trỏ API này. Railway/Vercel và bản cài Flutter chưa được phát hành trong lượt này. Database mock này cũng đang được môi trường từ xa sử dụng; cần rollout backend mới trước khi dùng địa chỉ mới trên các client từ xa.

## Kiểm tra

- Server: lint/typecheck/build, 31 unit, 292 HTTP admin checks, 2 contract suites. Có kiểm sai tỉnh/xã, đặc khu, type conflict, blank/limit địa chỉ cũ, legacy toggle, kế thừa, lọc và DTO tương thích. Migration rehearsal kiểm database đang có dữ liệu bằng quyền managed non-superuser.
- Website: `pnpm check` đạt 46 unit và 21 E2E Chromium desktop/mobile, WebKit mobile. Hai E2E admin riêng đạt tạo mới/đổi mode/studio, địa giới, lưu/xóa địa chỉ cũ, 5 chiều rộng, bàn phím, reduced motion, Axe.
- Flutter: 42 test thuộc 5 file liên quan và `flutter analyze --no-pub` đạt. Chưa kiểm trên thiết bị thật.
- Integration rộng vẫn có lỗi đã tồn tại ở `foundation.test.ts:101`: test kỳ vọng session hết hạn trả 401 nhưng chính sách phiên hiện có trả 200. Không sửa chính sách hoặc bỏ test để làm xanh tính năng này.

Ảnh và kết quả môi trường localhost xem [STATUS website](../../xland-website/xland/docs/STATUS.md) và [QA](../../xland-website/xland/docs/qa/2026-10-27-property-form/README.md).
