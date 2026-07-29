const services = require('../data/services.json');

function parseTime(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  return h * 60 + m;
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function getServiceDuration(serviceId) {
  const pkg = services.packages.find(p => p.id === serviceId);
  return pkg ? pkg.durationMinutes : null;
}
function getAllTimeSlots(date, extraSlots = []) {
  const base = [...(services.allowedStartTimes || [])];
  if (!date || !extraSlots.length) return base;

  const extras = extraSlots
    .filter(e => e.slot_date === date)
    .map(e => e.slot_time);

  for (const time of extras) {
    if (!base.includes(time)) base.push(time);
  }

  return base.sort();
}

function getSlotsNeeded(durationMinutes) {
  return Math.ceil(durationMinutes / services.slotIntervalMinutes);
}

function rangesOverlap(start1, end1, start2, end2) {
  return start1 < end2 && start2 < end1;
}

function getOccupiedRanges(bookings, blockedSlots, date) {
  const ranges = [];

  for (const booking of bookings) {
    if (booking.booking_date !== date || booking.status === 'cancelled') continue;
    const start = parseTime(booking.booking_time);
    const end = start + booking.duration_minutes;
    ranges.push({ start, end, type: 'booking', id: booking.id });
  }

  for (const block of blockedSlots) {
    if (block.block_date !== date) continue;
    if (block.is_full_day) {
      ranges.push({
        start: services.businessHours.start * 60,
        end: services.businessHours.end * 60,
        type: 'block',
        id: block.id
      });
    } else if (block.block_time) {
      const start = parseTime(block.block_time);
      ranges.push({ start, end: start + services.slotIntervalMinutes, type: 'block', id: block.id });
    }
  }

  return ranges;
}

function isSlotAvailable(date, time, durationMinutes, bookings, blockedSlots) {
  // Treat slots as atomic start times: a slot is unavailable only if another
  // booking exists with the same start time, or a block exists for that time.
  for (const booking of bookings) {
    if (booking.booking_date !== date || booking.status === 'cancelled') continue;
    if (booking.booking_time === time) return false;
  }

  for (const block of blockedSlots) {
    if (block.block_date !== date) continue;
    if (block.is_full_day) return false;
    if (block.block_time && block.block_time === time) return false;
  }

  return true;
}

function getAvailableSlots(date, serviceId, bookings, blockedSlots, extraSlots = []) {
  const duration = getServiceDuration(serviceId);
  if (duration == null) return [];
  const allSlots = getAllTimeSlots(date, extraSlots);

  return allSlots.filter(time =>
    isSlotAvailable(date, time, duration, bookings, blockedSlots)
  );
}

function getDayStatus(date, bookings, blockedSlots, extraSlots = []) {
  const fullDayBlock = blockedSlots.some(
    b => b.block_date === date && b.is_full_day
  );
  if (fullDayBlock) return 'closed';
  const dayBookings = bookings.filter(
    b => b.booking_date === date && b.status !== 'cancelled'
  );

  const allSlots = getAllTimeSlots(date, extraSlots);
  const occupied = getOccupiedRanges(bookings, blockedSlots, date);
  const anyAvailable = allSlots.some(time => {
    const slotStart = parseTime(time);
    return !occupied.some(r => slotStart >= r.start && slotStart < r.end);
  });

  if (!anyAvailable) return 'full';
  if (dayBookings.length > 0 || blockedSlots.some(b => b.block_date === date)) return 'partial';
  return 'available';
}

function getMonthAvailability(year, month, bookings, blockedSlots, extraSlots = []) {
  const days = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dateObj = new Date(year, month - 1, d);

    if (dateObj < today) {
      days.push({ date: dateStr, status: 'past' });
      continue;
    }

    const dayOfWeek = dateObj.getDay();
    if (dayOfWeek === 0) {
      days.push({ date: dateStr, status: 'closed' });
      continue;
    }

    days.push({
      date: dateStr,
      status: getDayStatus(dateStr, bookings, blockedSlots, extraSlots),
      bookingsCount: bookings.filter(
        b => b.booking_date === dateStr && b.status !== 'cancelled'
      ).length,
      hasExtraSlots: extraSlots.some(e => e.slot_date === dateStr)
    });
  }

  return days;
}

function isValidBookingTime(date, time, extraSlots = []) {
  return getAllTimeSlots(date, extraSlots).includes(time);
}

function calculatePrice(serviceId, vehicleType, addonIds) {
  const pkg = services.packages.find(p => p.id === serviceId);
  if (!pkg) return 0;

  let total = pkg.price;
  if (vehicleType === 'suv' || vehicleType === 'truck' || vehicleType === 'van') {
    total += services.largeVehicleSurcharge;
  }

  for (const addonId of addonIds) {
    const addon = services.addons.find(a => a.id === addonId);
    if (addon) total += addon.price || addon.priceFrom || 0;
  }

  return total;
}

module.exports = {
  services,
  parseTime,
  formatTime,
  getServiceDuration,
  getAllTimeSlots,
  isSlotAvailable,
  getAvailableSlots,
  getDayStatus,
  getMonthAvailability,
  calculatePrice,
  getOccupiedRanges,
  isValidBookingTime
};
