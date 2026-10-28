# Vận hành production Xland — 28/10/2026

- Backend: `https://xland-server-production.up.railway.app/api/v1`.
- Website user: `https://xland-alpha.vercel.app`.
- Website admin: `https://xland-alpha.vercel.app/admin`.
- Mobile: cấu hình release Railway; hướng dẫn trong repo mobile
  `docs/PRODUCTION_BUILD.md`.

Railway liên kết `doisn2003/xland-server`, nhánh `main`. Push source đã kiểm tra
kích hoạt build Dockerfile. Service `22e32363-d4d9-4f4a-80b9-cebaab3a3891`, project
`b111bc9d-7eb1-496c-b70d-204f6a6c42f2`, environment
`1948710d-9ce9-4387-aef9-6bb67daf1c60`. Healthcheck `/health/ready`, timeout 180s;
Singapore, một replica, 1 vCPU/1 GB; không thay gói dịch vụ.

## Dữ liệu và cấu hình

Database hiện có fingerprint `03d6c297d77a1029`, classification `supabase_mock`.
Không reset/seed lại dữ liệu khi deploy. Ledger đã được kiểm tra đến migration
`0023_current_geography_catalog.sql`; helper `scripts/upgrade-property-admin.mjs`
kiểm checksum và báo `up_to_date` ngày 28/10. Code mới cần schema này; readiness
kiểm các cột mới và catalog địa giới đang hoạt động để chặn deploy sai schema.

Thông tin kết nối DB, Storage, Google/maps và cursor secret chỉ nằm trong
provider variables hoặc file ignored. Website không được nhận secret DB/Storage.
Giữ `PUBLIC_BASE_URL` là origin Railway; cấu hình Android signing fingerprint
qua `SHARE_ANDROID_SHA256`. iOS cần `SHARE_APPLE_APP_ID` sau khi có App ID prefix
và provisioning thật. Không tự tạo giá trị giả cho iOS.

Vercel production cần:

```dotenv
XLAND_API_BASE_URL=https://xland-server-production.up.railway.app/api/v1
XLAND_WEB_ORIGIN=https://xland-alpha.vercel.app
XLAND_ADMIN_API_URL=https://xland-server-production.up.railway.app/api/v1/admin
XLAND_ADMIN_WEB_ORIGIN=https://xland-alpha.vercel.app
XLAND_ENABLE_BOOKING_WRITE=false
XLAND_ENABLE_EVENT_REGISTRATION=false
```

Google web cần public `NEXT_PUBLIC_GOOGLE_CLIENT_ID` và authorized JavaScript
origin tương ứng trên OAuth client. Backend phải chấp nhận audience đó.
Đổi biến cần deployment mới. SMS và live payment vẫn tắt theo policy hiện hành.

## Gate trước deploy

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:integration
npm run test:contract
npm run test:admin
npm run test:auth
```

Các runner tạo DB PostgreSQL local riêng; không đưa DATABASE_URL production
vào runner. Kiểm exit code và tổng số failed tests. Auth runner đã sửa để
embedded-postgres không che exit code thất bại. Test phiên dài hạn kiểm cả
trạng thái còn hiệu lực sau hai ngày, hết hạn thực và logout thu hồi.

## Sau deploy và rollback

1. Đối chiếu commit/deployment ACTIVE với GitHub `main`.
2. Kiểm `/health/live`, `/health/ready`, catalog/detail/lô con, feed/tác giả,
   cộng đồng, media range, sharing/App Links và bản đồ.
3. Kiểm website user/admin qua đúng domain production, cookie/CSRF, đọc API;
   tài khoản user không được truy cập namespace admin.
4. Kiểm log deployment để tìm 5xx/crash. Theo dõi tài nguyên và provider quota.
5. Khi lỗi, dùng rollback Railway/Vercel về deployment tương thích. Không drop,
   downgrade schema hoặc reset data. Cấu hình/backup riêng không commit.

Railway đang báo hóa đơn quá hạn. Chủ dự án đã yêu cầu vẫn thử deploy trên gói
hiện có; không thanh toán hoặc nâng gói trong công việc này. Deploy thành công
không xóa nguy cơ provider tạm ngừng dịch vụ. Không có load test dài hạn hoặc
bảo đảm mọi luồng/thiết bị không bao giờ có lỗi.

Biên bản rollout và commit/deployment thực tế được lưu ngoài repo tại
`brain/reports/production-20261028/README.md` trong workspace.
