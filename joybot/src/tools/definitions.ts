import Anthropic from "@anthropic-ai/sdk";

export const toolDefinitions: Anthropic.Tool[] = [
  {
    name: "search_rooms",
    description:
      "Xem phòng còn trống + giá THẬT cho khoảng ngày (đã đồng bộ lịch Airbnb/Booking/Agoda). " +
      "Gọi mỗi khi khách hỏi phòng trống hoặc giá. Không bao giờ nêu giá mà không gọi tool này.",
    input_schema: {
      type: "object",
      properties: {
        checkIn: { type: "string", description: "Ngày nhận phòng YYYY-MM-DD" },
        checkOut: { type: "string", description: "Ngày trả phòng YYYY-MM-DD" },
        guests: { type: "number", description: "Số khách (nếu khách đã nói)" },
      },
      required: ["checkIn", "checkOut"],
    },
  },
  {
    name: "create_hold",
    description:
      "Giữ chỗ: khóa lịch phòng trên PMS trong thời gian giữ chỗ và gửi QR cọc cho khách. " +
      "CHỈ gọi khi khách đã chọn phòng, ngày, và XÁC NHẬN muốn đặt, và đã cho tên + số điện thoại.",
    input_schema: {
      type: "object",
      properties: {
        pmsRoomId: { type: "string", description: "pmsRoomId lấy từ kết quả search_rooms" },
        checkIn: { type: "string", description: "YYYY-MM-DD" },
        checkOut: { type: "string", description: "YYYY-MM-DD" },
        guestName: { type: "string", description: "Họ tên khách" },
        guestPhone: { type: "string", description: "Số điện thoại / WhatsApp của khách" },
        guests: { type: "number", description: "Số khách" },
      },
      required: ["pmsRoomId", "checkIn", "checkOut", "guestName", "guestPhone"],
    },
  },
  {
    name: "booking_status",
    description: "Tra trạng thái một mã đặt phòng (vd JOY1234) của chính khách đang chat.",
    input_schema: {
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    },
  },
  {
    name: "handoff_to_owner",
    description:
      "Chuyển hội thoại cho chủ Joystay khi: khách khiếu nại, xin giảm giá ngoài chính sách, hỏi điều không có trong thông tin, " +
      "báo đã chuyển khoản nhưng chưa được xác nhận, yêu cầu đặc biệt, hoặc hệ thống lỗi. Sau khi gọi, bot ngừng tự trả lời.",
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Lý do ngắn" },
        summary: { type: "string", description: "Tóm tắt khách cần gì, ngày, phòng, SĐT nếu có" },
      },
      required: ["reason", "summary"],
    },
  },
];
