# Nội dung Sự kiện và Câu lạc bộ — 26/10/2026

Mobile sử dụng API hiện có `GET /clubs`, `GET /clubs/:id`, `GET /events` và
`GET /events/:id`. Không cần migration hoặc thay đổi hợp đồng API.

`scripts/community-catalog.ts` khai báo một CLB Bất động sản XLand và sáu sự kiện
trong tháng 11/2026: bốn hoạt động về bất động sản, chạy bộ Hồ Tây và workshop gốm.
Đây là nội dung mẫu (`is_illustrative=true`), ảnh minh họa từ Unsplash. Địa điểm,
lịch trình và sức chứa là dữ liệu seed, không phải lịch tổ chức đã xác nhận.
Phí gốm là 150.000 đồng, các hoạt động khác miễn phí; thanh toán giữ cơ chế hiện có.

Xem trước và ghi trực tiếp vào Supabase mẫu đang dùng cho mobile:

```powershell
node --import tsx scripts/seed-community.ts
node --import tsx scripts/seed-community.ts --apply
```

Script đọc metadata mục tiêu từ `.env.supabase-mock` và kết nối quản trị từ `.env`,
kiểm tra fingerprint bằng `databaseTarget`. Mỗi bản ghi có UUID cố định. Toàn bộ
seed nằm trong một transaction; chạy lại bỏ qua các UUID đã tồn tại, giữ nguyên
các chỉnh sửa và đăng ký của người dùng. Không reset, xóa hoặc cập nhật dữ liệu cũ.

Kiểm thử PostgreSQL trong `tests/integration/community-seed.test.ts` kiểm tra số
lượng, chạy lại, bảo toàn chỉnh sửa, chi tiết công khai và phân trang bốn sự kiện.
