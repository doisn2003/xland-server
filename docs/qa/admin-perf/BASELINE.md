# BASELINE PERFORMANCE REPORT (Giai đoạn 0)
**Thời gian đo:** 2026-10-26T06:26:35.664Z  
**Môi trường:** Localhost Backend `xland-server` ⇄ Supabase Mumbai (`ap-south-1`)  
**Số mẫu lặp:** 10 lượt / endpoint  
**Độ trễ vật lý (Median RTT SELECT 1):** 112.1 ms  

## Kết quả đo đạc chi tiết

| Endpoint | Median Latency | P95 Latency | Min - Max Latency | Queries/Req | Đánh giá RTT tương đương |
| :--- | :---: | :---: | :---: | :---: | :---: |
| `GET /session` | **465 ms** | 1000 ms | 449 - 1000 ms | **4 SQL** | ~4 RTT |
| `GET /schema` | **14 ms** | 262 ms | 2 - 262 ms | **0 SQL** | ~0 RTT |
| `GET /properties` | **464 ms** | 480 ms | 452 - 480 ms | **4 SQL** | ~4 RTT |
| `GET /properties/:id` | **470 ms** | 486 ms | 454 - 486 ms | **4 SQL** | ~4 RTT |
| `GET /locations` | **458 ms** | 494 ms | 450 - 494 ms | **4 SQL** | ~4 RTT |

## Phân tích Baseline

1. **`GET /session` (~465 ms, 4 SQL):**
   - Xác thực phiên mở transaction `xland_auth`, kiểm tra token digest, lấy thông tin profile người dùng.
   - Khi có In-Memory cache (B5), chi phí này sẽ giảm về **~0 ms**.

2. **`GET /schema` (~14 ms, 0 SQL):**
   - Truy vấn `information_schema.columns` qua mạng tới Mumbai mỗi lần gọi.
   - Khi có In-Memory column cache (B1), endpoint này sẽ phản hồi tức thì **< 10 ms**.

3. **`GET /properties` (~464 ms, 4 SQL):**
   - Đọc `fields()` (query information_schema) + `SELECT count(*)` + `SELECT items` + duyệt foreign key labels.
   - Sau B1 + B2 + B3 + B4, số query sẽ giảm từ **4 SQL** xuống còn **1-2 SQL**.

4. **`GET /properties/:id` (~470 ms, 4 SQL):**
   - Tương tự, tốn RTT cho đọc fields + row chi tiết.

---
> Mục tiêu Giai đoạn 1: Đưa median latency của `GET /schema` và `GET /session` xuống < 10ms (cache), và các danh sách/chi tiết xuống < 400-600ms.
