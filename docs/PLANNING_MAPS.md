# Lớp quy hoạch Hà Nội / Hải Phòng

Tab Khu vực của Xland giữ nền Geoapify và thêm lớp ảnh quy hoạch XYZ PNG, công tắc,
thanh độ đậm 0–100%, toàn màn hình, chú giải và nguồn dữ liệu. Mặc định lớp phủ tắt;
bật lần đầu dùng độ đậm 70%. Kéo thanh không thay đổi camera hoặc tải lại ảnh.

## Bật nguồn ở backend

Đặt biến môi trường trên **tiến trình API**, sau đó khởi động lại:

```dotenv
MAPS_PLANNING_ENABLED=true
```

Khi không có `MAPS_PLANNING_MANIFEST`, backend dùng các endpoint đã quan sát ngày
26/10/2026 trên bds68:

- `https://quy-hoach.bds68.com.vn/Ha-Noi/{z}/{x}/{y}.png`, zoom 10–18.
- `https://quy-hoach.bds68.com.vn/Hai-Phong/{z}/{x}/{y}.png`, zoom 12–18.

Đây là endpoint công khai quan sát từ website, chưa phải API có cam kết dịch vụ.
Việc cấu hình endpoint không xác nhận quyền tái sử dụng hoặc độ mới của dữ liệu.
Khi triển khai chính thức, dùng nguồn có điều kiện cung cấp phù hợp cho Xland.
Không có ngày công bố/vùng phủ đã xác minh cho cấu hình BDS68 mặc định; giao diện
hiển thị rõ điều này. Không suy ra ngày hiệu lực từ tiêu đề website hay HTTP Last-Modified.
Lớp `to-thua` của Hà Nội chưa bật: bản đầu chỉ dùng lớp quy hoạch.

Không cần key mới trong mobile. URL ảnh trả cho ứng dụng luôn trỏ về backend Xland.
Backend không giả Origin/Referer, không chuyển cookie/session hay ID hồ sơ sang nguồn.
Nguồn lỗi/403/timeout không làm hỏng lớp nền; không tự thử lại nguồn ngoài.

Trong repository biến này mặc định `false`; thay đổi mã nguồn không tự bật cấu hình,
triển khai server, sửa `.env` đang chạy hoặc phát hành APK. Không cần migration mới.

## Đổi nguồn hoặc bổ sung metadata

Đặt `MAPS_PLANNING_MANIFEST` trỏ tới JSON riêng trên server. Chỉ hai khóa `ha-noi`
và `hai-phong` được chấp nhận. Có thể cung cấp một thành phố; thành phố còn lại hiển
thị chưa cấu hình. Ví dụ cấu trúc sau sử dụng tên miền minh họa, phải thay trước khi dùng:

```json
{
  "ha-noi": {
    "label": "Đơn vị cung cấp dữ liệu",
    "sourceUrl": "https://planning.example/source",
    "legendUrl": "https://planning.example/legend",
    "revision": "reviewed-v1",
    "tileUrlTemplate": "https://tiles.example/hanoi/{z}/{x}/{y}.png",
    "minZoom": 10,
    "maxNativeZoom": 18,
    "publishedAt": null,
    "coverageBounds": null,
    "cacheSeconds": 3600
  }
}
```

- Ảnh PNG 256×256 theo XYZ/Web Mercator; không dùng Y đảo kiểu TMS.
- `revision`: chữ thường/số/gạch ngang, đổi khi thay dataset để tách cache.
- `publishedAt`: thời điểm công bố được nhà cung cấp xác nhận, ISO 8601 UTC; null nếu chưa có.
- `coverageBounds`: `[south, west, north, east]` theo WGS84; null nếu chưa xác định.
  Bounds chỉ là phạm vi bao ngoài; các ô bên trong vẫn có thể thiếu dữ liệu.
- `cacheSeconds`: 0–86400, theo điều kiện nguồn; 0 tắt cache server và HTTP.
- JSON tối đa 32 KiB. URL HTTPS, không userinfo/fragment; tọa độ ô chỉ thay ba placeholder.
  URL upstream (kể cả query token nếu có) không được gửi trong metadata mobile.
- Manifest thiếu/hỏng làm lớp phủ ở trạng thái chưa cấu hình, giữ nguyên Geoapify.

## Điều kiện hiển thị và giới hạn vị trí

`GET /api/v1/properties/:propertyId/area-map` vẫn dùng identity/RLS của hồ sơ. Truy vấn
join `province_code` + `catalog_version` sang danh mục tỉnh/thành; tên tỉnh của hồ sơ
phải khớp tên danh mục sau chuẩn hóa. Không dựa vào chuỗi địa chỉ tự do hoặc vùng đang pan.
Hồ sơ ngoài hai thành phố không có công tắc, slider hoặc request quy hoạch.

Trường `planning` bổ sung có trạng thái `not_supported`, `unconfigured`, `unavailable`
hoặc `ready`. Client cũ bỏ qua trường mới. Client mới vẫn dùng được backend cũ;
metadata lớp phủ sai chỉ vô hiệu hóa lớp phủ.

`/maps/planning/:region/:revision/:z/:x/:y.png` là route ảnh công khai cho hai nguồn,
không phải API cấp quyền truy cập hồ sơ. Chỉ nhận tọa độ hợp lệ, phiên bản đang dùng,
zoom của nguồn và tile giao vùng phủ (hoặc phạm vi Việt Nam nếu chưa có bounds).
Giới hạn 32 request đang chờ, 512 KB/ảnh, timeout 10 giây; cache có giới hạn 256 ô/32 MiB.
404/204 giữ nghĩa thiếu ảnh; không biến thành kết luận không có quy hoạch.

Camera được mở tới zoom 18 với nguồn mặc định. Ảnh nền Geoapify tiếp tục lấy tối đa
zoom 16 rồi phóng lớn ở 17–18; không tăng giới hạn API nền/hạn mức đã thiết lập.

**Chưa gắn dấu lô đất:** dữ liệu công khai hiện chỉ có tâm xã/phường. `lat/lng` riêng tư
và tọa độ gần đúng không được đọc hoặc công khai bởi thay đổi này. Giao diện ghi rõ
“Quy hoạch khu vực”. Muốn đối chiếu chính xác từng thửa cần luồng xác minh vị trí/ranh
và quyền hiển thị riêng; không dùng tâm xã/phường thay cho tọa độ lô đất.

## Kiểm tra

### Bản dùng thử Railway ngày 26/10/2026

Đã bật `MAPS_PLANNING_ENABLED=true` trên `xland-server / production` tại
`https://xland-server-production.up.railway.app`. Deployment
`8604ed7e-21cb-4815-a09e-4d38ca349e0c` dùng source từ `90da7c7` cộng thay đổi
quy hoạch trong working tree. Không cần migration cho lớp quy hoạch.

Database `supabase_mock` đang dùng chung có 20 hồ sơ `is_illustrative=true`:
5 lô tại mỗi khu vực Xã Hòa Lạc, Phường Long Biên (Hà Nội), Phường Hải An và
Phường Lê Chân (Hải Phòng). 19 lô đang hiển thị; 1 hồ sơ QA giữ trạng thái
chờ duyệt/tạm dừng. Hai hồ sơ không đánh dấu dữ liệu mẫu được giữ nguyên.
Địa chỉ, mã danh mục, tiêu đề có tên địa phương và mô tả khu vực minh họa
được đồng bộ; tọa độ minh họa cũ được xóa để không trỏ sang tỉnh khác.
Không tạo tọa độ thửa đất. Danh mục thử nghiệm `fixture-2026-09` được bổ sung
Hải Phòng mã 31 và các khu vực mẫu cần thiết.

Lô dễ kiểm tra: `XL-028` (Hòa Lạc), `XL-029` (Long Biên), `XL-030` (Hải An),
`XL-031` và `XL-P3-008` (Lê Chân). API live đã xác nhận cả 19 hồ sơ có bản đồ
và quy hoạch `ready`, hồ sơ QA vẫn 404 với khách, Đà Nẵng không có lớp phủ;
8 ô ảnh XYZ ở zoom 12/14 của bốn khu vực đều trả PNG 256×256.

Backup riêng được lưu trong `.backups/` và đã phục hồi thử, đối chiếu digest
43 bảng/2.008 dòng. Journal, manifest upload, kiểm chứng và script hoàn tác
ở `.local/planning-demo/` (không đưa vào Git). Khi cần hoàn tác dữ liệu, chạy
`rollback-labels.mjs` trước rồi `relocate.mjs --rollback`, đều với
`node --import tsx`; các script dừng nếu hồ sơ đã có chỉnh sửa mới.
Không khôi phục toàn bộ database đang phục vụ chỉ để hoàn tác địa chỉ mẫu.

APK mới là `../../releases/android/planning-20261026/xland-0.2.5-planning.apk`.
APK cũ vẫn đọc dữ liệu mới nhưng cần cài cập nhật để có công tắc và thanh độ đậm.

Backend:

```powershell
npm run typecheck
node --import tsx --test tests/maps/maps.test.ts tests/maps/geoapify.test.ts tests/maps/planning.test.ts
node --import tsx tests/maps/run-local.mjs
```

Lệnh cuối tạo DB PostgreSQL test riêng trên loopback, không dùng DB đang chạy.

Mobile (từ `xland-mobile`):

```powershell
flutter test --no-pub test/maps/area_map_test.dart test/maps/planning_map_test.dart
```

Kiểm tra trên thiết bị sau cấu hình: hồ sơ Hà Nội/Hải Phòng, tỉnh khác, bật/tắt;
độ đậm 0/50/100%; pan/zoom; vào/ra toàn màn hình; nguồn mất kết nối/thiếu tile;
vùng ngoài coverage; nguồn/chú giải; chữ lớn và màn hình hẹp. Tile trong widget test
là ảnh tổng hợp có chữ MINH HOA / TEST, không phải bằng chứng quy hoạch thực tế.
