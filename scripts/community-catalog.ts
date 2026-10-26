// Requested discovery content, October 2026. Illustrative activities, not live ticket inventory.
const media = (id: string, photo: string, altText: string) => [{
  id, kind: 'image', url: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=1200&q=85`,
  thumbnailUrl: `https://images.unsplash.com/${photo}?auto=format&fit=crop&w=600&q=80`,
  durationSeconds: null, altText, isIllustrative: true,
}];

export const communityClub = {
  id: 'c0261026-0000-4000-8000-000000000001',
  title: 'Câu lạc bộ Bất động sản XLand',
  summary: 'Kết nối người yêu bất động sản, chia sẻ kiến thức và cùng khám phá thị trường.',
  description: 'Cộng đồng dành cho người quan tâm đến bất động sản, từ người mới tìm hiểu đến nhà đầu tư có kinh nghiệm. Thành viên cùng trao đổi cách đọc hồ sơ pháp lý, tìm hiểu quy hoạch, khảo sát thực địa và xây dựng kế hoạch tài chính. Các buổi gặp gỡ hướng đến việc học hỏi, chia sẻ góc nhìn và mở rộng kết nối trong tinh thần minh bạch, tôn trọng lẫn nhau.',
  regionLabel: 'Hà Nội & miền Bắc',
  activities: ['Cà phê kết nối', 'Chia sẻ kiến thức pháp lý', 'Khảo sát thực địa', 'Thảo luận thị trường'],
  media: media('c0261026-0000-4000-8000-000000000011', 'photo-1517245386807-bb43f82c33c4', 'Không gian gặp gỡ cộng đồng'),
};

const entries = [
  {
    title: 'Cà phê bất động sản: Góc nhìn thị trường 2027', category: 'Bất động sản', topic: 'Kết nối',
    startsAt: '2026-11-07T08:30:00+07:00', duration: 120, capacity: 60, price: '0',
    venue: 'Không gian cộng đồng XLand', address: 'Khu vực Cầu Giấy, Hà Nội',
    photo: 'photo-1517245386807-bb43f82c33c4', alt: 'Gặp gỡ và trao đổi tại không gian cộng đồng',
    sessions: ['Đón khách và kết nối cộng đồng', 'Trao đổi các yếu tố tác động đến thị trường', 'Thảo luận nhóm và chia sẻ góc nhìn'],
    benefit: 'Gặp gỡ những người cùng quan tâm đến bất động sản và trao đổi kinh nghiệm tìm hiểu thị trường.',
  },
  {
    title: 'Đọc hồ sơ pháp lý trước khi mua đất', category: 'Bất động sản', topic: 'Workshop',
    startsAt: '2026-11-08T09:00:00+07:00', duration: 150, capacity: 40, price: '0',
    venue: 'Phòng hội thảo XLand', address: 'Khu vực Nam Từ Liêm, Hà Nội',
    photo: 'photo-1450101499163-c8848c66ca85', alt: 'Trao đổi và xem xét tài liệu',
    sessions: ['Làm quen với các loại hồ sơ đất đai', 'Thực hành đọc thông tin trên hồ sơ mẫu', 'Hỏi đáp và tổng hợp các điểm cần kiểm tra'],
    benefit: 'Nhận bộ câu hỏi tham khảo giúp chuẩn bị trước khi tìm hiểu hồ sơ và làm việc với đơn vị chuyên môn.',
  },
  {
    title: 'Chạy bộ cuối tuần: Một vòng Hồ Tây', category: 'Thể thao', topic: 'Ngoài trời',
    startsAt: '2026-11-14T06:00:00+07:00', duration: 120, capacity: 50, price: '0',
    venue: 'Không gian ven Hồ Tây', address: 'Khu vực phố Trích Sài, Tây Hồ, Hà Nội',
    photo: 'photo-1552674605-db6ffd4facb5', alt: 'Hoạt động chạy bộ ngoài trời',
    sessions: ['Tập trung và khởi động cùng nhóm', 'Chạy bộ hoặc đi bộ theo nhịp phù hợp', 'Giãn cơ và giao lưu cuối buổi'],
    benefit: 'Cùng vận động, thư giãn và làm quen bạn mới. Có nhóm đi bộ dành cho người mới bắt đầu.',
  },
  {
    title: 'Khảo sát thực địa: Kết nối khu vực Hòa Lạc', category: 'Bất động sản', topic: 'Thực địa',
    startsAt: '2026-11-15T08:00:00+07:00', duration: 240, capacity: 30, price: '0',
    venue: 'Điểm hẹn cộng đồng Hòa Lạc', address: 'Khu vực Hòa Lạc, Hà Nội',
    photo: 'photo-1449158743715-0a90ebb6d2d8', alt: 'Kiến trúc và cảnh quan đô thị',
    sessions: ['Gặp mặt và phổ biến lịch trình khảo sát', 'Quan sát hạ tầng và kết nối khu vực', 'Tổng kết ghi chép và trao đổi trải nghiệm'],
    benefit: 'Thực hành ghi chép khi khảo sát địa điểm và trao đổi cách quan sát hạ tầng, tiện ích xung quanh.',
  },
  {
    title: 'Workshop gốm: Chạm đất, chạm sáng tạo', category: 'Sáng tạo', topic: 'Workshop',
    startsAt: '2026-11-21T14:00:00+07:00', duration: 150, capacity: 24, price: '150000',
    venue: 'Không gian gốm Bát Tràng', address: 'Làng gốm Bát Tràng, Gia Lâm, Hà Nội',
    photo: 'photo-1578749556568-bc2c40e68b61', alt: 'Trải nghiệm sáng tạo với gốm thủ công',
    sessions: ['Làm quen với đất và dụng cụ tạo hình', 'Tự tay tạo hình sản phẩm đơn giản', 'Trang trí và chia sẻ tác phẩm'],
    benefit: 'Thử sức với một hoạt động thủ công thư giãn, tìm hiểu quy trình làm gốm và kết nối qua sáng tạo.',
  },
  {
    title: 'Lập kế hoạch tài chính cho căn nhà đầu tiên', category: 'Bất động sản', topic: 'Chia sẻ kiến thức',
    startsAt: '2026-11-22T09:00:00+07:00', duration: 120, capacity: 45, price: '0',
    venue: 'Phòng hội thảo XLand', address: 'Khu vực Cầu Giấy, Hà Nội',
    photo: 'photo-1460317442991-0ec209397118', alt: 'Những tòa nhà trong khu đô thị',
    sessions: ['Xác định nhu cầu và ngân sách dự kiến', 'Thực hành lập bảng thu chi và quỹ dự phòng', 'Trao đổi tình huống và các bước chuẩn bị'],
    benefit: 'Thực hành bảng ngân sách mẫu để hiểu rõ hơn chi phí sở hữu nhà và các khoản cần dự phòng.',
  },
];

export const communityEvents = entries.map((entry, index) => {
  const id = `e0261026-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
  const start = new Date(entry.startsAt);
  return {
    id, title: entry.title, tags: [entry.category, entry.topic],
    media: media(id, entry.photo, entry.alt), startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + entry.duration * 60000).toISOString(),
    venueName: entry.venue, address: entry.address, maxSlots: entry.capacity,
    durationMinutes: entry.duration, ticketPriceVnd: entry.price,
    agenda: entry.sessions.map((title, i) => ({
      startsAt: new Date(start.getTime() + Math.floor(entry.duration * i / 3) * 60000).toISOString(),
      title,
    })),
    speakers: [],
    benefits: [{title: 'Trải nghiệm cùng cộng đồng', description: entry.benefit}],
  };
});
