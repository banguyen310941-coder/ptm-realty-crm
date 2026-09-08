export function money(value) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

export function shortMoney(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000_000) {
    const v = n / 1_000_000_000;
    return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} tỷ`;
  }
  if (n >= 1_000_000) return `${Math.round(n / 1_000_000)} tr`;
  return money(n);
}

export function dateTime(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date(value));
}

export function dateOnly(value) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh"
  }).format(new Date(value));
}

export const leadStatus = {
  new: "Khách mới",
  contact: "Đã liên hệ",
  hot: "Quan tâm",
  visit: "Đi xem",
  deal: "Chốt cọc",
  lost: "Không nhu cầu"
};

export const propertyStatus = {
  available: "Đang bán",
  reserved: "Giữ chỗ",
  sold: "Đã bán",
  locked: "Tạm khóa"
};

export const dealStage = {
  booking: "Booking",
  deposit: "Đặt cọc",
  negotiation: "Thương lượng",
  contract: "Chờ ký HĐ",
  completed: "Hoàn tất",
  cancelled: "Đã hủy"
};
