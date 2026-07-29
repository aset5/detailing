/* Glow on the Go — Admin Panel */

const state = {
  selectedDate: '',
  calYear: new Date().getFullYear(),
  calMonth: new Date().getMonth() + 1,
  weekStart: null,
  monthData: null,
  dayBookings: [],
  daySlots: [],
  dayExtraSlots: [],
  appConfig: null,
  currentSection: 'calendar'
};

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAY_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function formatCurrency(value) {
  return `$${Number(value || 0).toFixed(2)}`;
}

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatDateLong(dateStr) {
  const d = parseLocalDate(dateStr);
  if (!d) return dateStr;
  return `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function formatTimeDisplay(time) {
  const [h, m] = time.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return m ? `${hour}:${String(m).padStart(2, '0')} ${ampm}` : `${hour} ${ampm}`;
}

function formatTimeRange(time, durationMinutes) {
  const start = formatTimeDisplay(time);
  const endMinutes = (() => {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m + (durationMinutes || 180);
  })();
  const endH = Math.floor(endMinutes / 60) % 24;
  const endM = endMinutes % 60;
  const end = formatTimeDisplay(`${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`);
  return `${start} – ${end}`;
}

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStart(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function getWeekRangeLabel(weekStart) {
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const startMonth = MONTH_NAMES[weekStart.getMonth()].slice(0, 3);
  const endMonth = MONTH_NAMES[weekEnd.getMonth()].slice(0, 3);
  if (weekStart.getMonth() === weekEnd.getMonth()) {
    return `${startMonth} ${weekStart.getDate()} – ${weekEnd.getDate()}, ${weekStart.getFullYear()}`;
  }
  return `${startMonth} ${weekStart.getDate()} – ${endMonth} ${weekEnd.getDate()}, ${weekEnd.getFullYear()}`;
}

async function apiFetch(url, options = {}) {
  const res = await fetch(url, { credentials: 'same-origin', ...options });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

// ─── Auth ─────────────────────────────────────────────────────

async function checkAuth() {
  try {
    const data = await apiFetch('/api/admin/check');
    if (data.authenticated) {
      showAdmin();
      await initAdmin();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('adminLayout').classList.remove('active');
}

function showAdmin() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('adminLayout').classList.add('active');
}

async function initAdmin() {
  const today = toDateStr(new Date());
  state.selectedDate = today;
  state.weekStart = getWeekStart(new Date());

  await Promise.all([
    loadConfig(),
    loadStats(),
    loadClients(),
    loadAllBookings()
  ]);

  showSection('calendar');
  await refreshCalendar();
}

async function loadConfig() {
  state.appConfig = await apiFetch('/api/config');
  populateServiceOptions();
}

// ─── Navigation ───────────────────────────────────────────────

function showSection(section) {
  state.currentSection = section;
  document.querySelectorAll('.admin-section').forEach(el => el.classList.remove('active'));
  document.getElementById(`section-${section}`)?.classList.add('active');
  document.querySelectorAll('.bottom-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.section === section);
  });

  if (section === 'calendar') refreshCalendar();
  if (section === 'dashboard') loadStats();
  if (section === 'bookings') loadAllBookings();
  if (section === 'clients') loadClients();
}

// ─── Calendar ─────────────────────────────────────────────────

async function refreshCalendar() {
  await loadMonthData();
  renderWeekStrip();
  renderDayBookings();
}

async function loadMonthData() {
  try {
    const data = await apiFetch(`/api/availability/month?year=${state.calYear}&month=${state.calMonth}`);
    state.monthData = data;
  } catch (err) {
    console.error(err);
    state.monthData = null;
  }
}

function renderWeekStrip() {
  const strip = document.getElementById('weekStrip');
  const rangeLabel = document.getElementById('weekRangeLabel');
  if (!strip || !state.weekStart) return;

  if (rangeLabel) rangeLabel.textContent = getWeekRangeLabel(state.weekStart);

  const todayStr = toDateStr(new Date());
  let html = '';

  for (let i = 0; i < 7; i++) {
    const d = new Date(state.weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = toDateStr(d);
    const dayNum = d.getDate();
    const isSelected = dateStr === state.selectedDate;
    const isToday = dateStr === todayStr;
    const dayInfo = state.monthData?.days?.find(day => day.date === dateStr);
    const hasBookings = (dayInfo?.bookingsCount || 0) > 0;

    html += `
      <button type="button" class="week-day${isSelected ? ' selected' : ''}${isToday && !isSelected ? ' today' : ''}"
        onclick="selectDate('${dateStr}')">
        <span class="week-day-label">${DAY_SHORT[d.getDay()]}</span>
        <span class="week-day-num">${dayNum}</span>
        ${hasBookings ? '<span class="week-day-dot"></span>' : ''}
      </button>`;
  }

  strip.innerHTML = html;
}

async function selectDate(dateStr) {
  state.selectedDate = dateStr;
  const d = parseLocalDate(dateStr);
  state.calYear = d.getFullYear();
  state.calMonth = d.getMonth() + 1;
  state.weekStart = getWeekStart(d);

  await loadMonthData();
  renderWeekStrip();
  await renderDayBookings();
}

function changeWeek(delta) {
  if (!state.weekStart) return;
  const next = new Date(state.weekStart);
  next.setDate(next.getDate() + delta * 7);
  state.weekStart = next;

  const midWeek = new Date(next);
  midWeek.setDate(midWeek.getDate() + 3);
  state.calYear = midWeek.getFullYear();
  state.calMonth = midWeek.getMonth() + 1;

  loadMonthData().then(() => {
    renderWeekStrip();
  });
}

function openMonthPicker() {
  document.getElementById('monthPickerModal')?.classList.add('active');
  renderMonthPicker();
}

function closeMonthPicker() {
  document.getElementById('monthPickerModal')?.classList.remove('active');
}

function renderMonthPicker() {
  const grid = document.getElementById('monthPickerGrid');
  if (!grid) return;

  grid.innerHTML = MONTH_NAMES.map((name, i) => `
    <button type="button" class="month-picker-item${state.calMonth === i + 1 ? ' active' : ''}"
      onclick="selectMonth(${i + 1})">${name.slice(0, 3)}</button>
  `).join('');

  const yearEl = document.getElementById('monthPickerYear');
  if (yearEl) yearEl.textContent = state.calYear;
}

function changePickerYear(delta) {
  state.calYear += delta;
  renderMonthPicker();
}

async function selectMonth(month) {
  state.calMonth = month;
  closeMonthPicker();

  const firstOfMonth = new Date(state.calYear, month - 1, 1);
  state.weekStart = getWeekStart(firstOfMonth);

  if (!state.selectedDate) {
    state.selectedDate = toDateStr(firstOfMonth);
  }

  await refreshCalendar();
}

async function renderDayBookings() {
  const heading = document.getElementById('dayHeading');
  const list = document.getElementById('dayBookingsList');
  const extraPanel = document.getElementById('extraSlotsPanel');
  if (!list || !state.selectedDate) return;

  if (heading) heading.textContent = formatDateLong(state.selectedDate);
  list.innerHTML = '<div class="loading-state">Loading...</div>';

  try {
    const [dayData, bookings] = await Promise.all([
      apiFetch(`/api/availability/day?date=${encodeURIComponent(state.selectedDate)}`),
      apiFetch(`/api/admin/bookings?date=${encodeURIComponent(state.selectedDate)}`)
    ]);

    state.daySlots = dayData.slots || [];
    state.dayExtraSlots = dayData.extraSlots || [];
    state.dayBookings = Array.isArray(bookings) ? bookings.filter(b => b.status !== 'cancelled') : [];

    if (!state.dayBookings.length) {
      list.innerHTML = `
        <div class="empty-day">
          <i class="fa-regular fa-calendar"></i>
          <p>No appointments for this day</p>
          <button type="button" class="btn-text" onclick="openAddBooking()">Add booking</button>
        </div>`;
    } else {
      list.innerHTML = state.dayBookings.map(booking => `
        <article class="booking-card" onclick="openBookingDetail(${booking.id})">
          <div class="booking-card-bar"></div>
          <div class="booking-card-body">
            <h3>${escapeHtml(booking.name)} — ${escapeHtml(booking.service_name || booking.service_id)}</h3>
            <p class="booking-card-desc">${escapeHtml(booking.address || 'No address')}</p>
            <p class="booking-card-time">${formatTimeRange(booking.booking_time, booking.duration_minutes)}</p>
            <span class="status-badge ${booking.status}">${booking.status}</span>
          </div>
        </article>
      `).join('');
    }

    renderExtraSlotsPanel(extraPanel);
  } catch (err) {
    list.innerHTML = `<div class="empty-day"><p>Could not load bookings</p></div>`;
    console.error(err);
  }
}

function renderExtraSlotsPanel(panel) {
  if (!panel) return;

  const baseTimes = state.appConfig?.services?.allowedStartTimes || ['09:00', '13:00', '17:00'];
  const extras = state.dayExtraSlots || [];

  panel.innerHTML = `
    <div class="extra-slots-header">
      <h4>Extra time slots for this day</h4>
      <p class="extra-slots-hint">Standard times: ${baseTimes.map(formatTimeDisplay).join(', ')}</p>
    </div>
    <div class="extra-slots-list">
      ${extras.length
        ? extras.map(slot => `
          <div class="extra-slot-item">
            <span>${formatTimeDisplay(slot.slot_time)} <em>(extra)</em></span>
            <button type="button" class="btn-icon danger" onclick="deleteExtraSlot(${slot.id})" title="Remove">
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>`).join('')
        : '<p class="extra-slots-empty">No extra slots — only standard times available</p>'}
    </div>
    <form class="extra-slot-form" onsubmit="addExtraSlot(event)">
      <input type="time" id="extraSlotTime" required />
      <button type="submit" class="btn-primary btn-sm">Add time</button>
    </form>`;
}

async function addExtraSlot(event) {
  event.preventDefault();
  const timeInput = document.getElementById('extraSlotTime');
  const slotTime = timeInput?.value;
  if (!slotTime || !state.selectedDate) return;

  try {
    await apiFetch('/api/admin/extra-slots', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slotDate: state.selectedDate, slotTime })
    });
    timeInput.value = '';
    await refreshCalendar();
  } catch (err) {
    alert(err.message);
  }
}

async function deleteExtraSlot(id) {
  if (!confirm('Remove this extra time slot?')) return;
  try {
    await apiFetch(`/api/admin/extra-slots/${id}`, { method: 'DELETE' });
    await refreshCalendar();
  } catch (err) {
    alert(err.message);
  }
}

// ─── Add Booking ──────────────────────────────────────────────

function openAddBooking(prefillDate) {
  const panel = document.getElementById('addBookingModal');
  const form = document.getElementById('bookingForm');
  if (!panel || !form) return;

  form.reset();
  document.getElementById('formDate').value = prefillDate || state.selectedDate || toDateStr(new Date());
  document.getElementById('formStatus').value = 'confirmed';
  populateTimeOptions(document.getElementById('formDate').value);
  panel.classList.add('active');
  showSection('add');
}

function closeAddBooking() {
  document.getElementById('addBookingModal')?.classList.remove('active');
  showSection('calendar');
}

async function populateTimeOptions(date) {
  const select = document.getElementById('formTime');
  if (!select || !date) return;

  try {
    const data = await apiFetch(`/api/availability/day?date=${encodeURIComponent(date)}`);
    const available = data.slots.filter(s => s.status === 'available');
    select.innerHTML = available.length
      ? available.map(s => `<option value="${s.time}">${formatTimeDisplay(s.time)}${s.isExtra ? ' (extra)' : ''}</option>`).join('')
      : '<option value="">No available slots</option>';
  } catch {
    const base = state.appConfig?.services?.allowedStartTimes || ['09:00', '13:00', '17:00'];
    select.innerHTML = base.map(t => `<option value="${t}">${formatTimeDisplay(t)}</option>`).join('');
  }
}

function populateServiceOptions() {
  const select = document.getElementById('formService');
  if (!select || !state.appConfig?.services?.packages) return;
  select.innerHTML = state.appConfig.services.packages
    .map(pkg => `<option value="${pkg.id}">${pkg.name}</option>`)
    .join('');
}

async function submitBookingForm(event) {
  event.preventDefault();

  const payload = {
    name: document.getElementById('formName').value,
    phone: document.getElementById('formPhone').value,
    email: document.getElementById('formEmail').value,
    address: document.getElementById('formAddress').value,
    vehicleType: document.getElementById('formVehicle').value,
    serviceId: document.getElementById('formService').value,
    addons: [],
    comment: document.getElementById('formComment').value,
    bookingDate: document.getElementById('formDate').value,
    bookingTime: document.getElementById('formTime').value,
    status: document.getElementById('formStatus').value
  };

  try {
    await apiFetch('/api/admin/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    closeAddBooking();
    await Promise.all([refreshCalendar(), loadStats(), loadAllBookings(), loadClients()]);
  } catch (err) {
    alert(err.message);
  }
}

// ─── Booking Detail ───────────────────────────────────────────

async function openBookingDetail(id) {
  const modal = document.getElementById('bookingDetailModal');
  const content = document.getElementById('bookingDetailContent');
  if (!modal || !content) return;

  try {
    const booking = await apiFetch(`/api/admin/bookings/${id}`);
    content.innerHTML = `
      <h2>${escapeHtml(booking.name)}</h2>
      <div class="detail-grid">
        <div><span>Date</span><strong>${booking.booking_date}</strong></div>
        <div><span>Time</span><strong>${formatTimeDisplay(booking.booking_time)}</strong></div>
        <div><span>Service</span><strong>${escapeHtml(booking.service_name)}</strong></div>
        <div><span>Status</span>
          <select class="status-select" data-booking-id="${booking.id}" onchange="updateBookingStatus(this)">
            <option value="pending" ${booking.status === 'pending' ? 'selected' : ''}>Pending</option>
            <option value="confirmed" ${booking.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
            <option value="completed" ${booking.status === 'completed' ? 'selected' : ''}>Completed</option>
            <option value="cancelled" ${booking.status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select>
        </div>
        <div><span>Phone</span><strong>${escapeHtml(booking.phone || '—')}</strong></div>
        <div><span>Email</span><strong>${escapeHtml(booking.email || '—')}</strong></div>
        <div class="detail-full"><span>Address</span><strong>${escapeHtml(booking.address || '—')}</strong></div>
        <div class="detail-full"><span>Comment</span><strong>${escapeHtml(booking.comment || '—')}</strong></div>
        <div><span>Price</span><strong>${formatCurrency(booking.total_price)}</strong></div>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn-danger" onclick="deleteBooking(${booking.id})">Delete</button>
        <button type="button" class="btn-secondary" onclick="closeBookingDetail()">Close</button>
      </div>`;
    modal.classList.add('active');
  } catch (err) {
    alert(err.message);
  }
}

function closeBookingDetail() {
  document.getElementById('bookingDetailModal')?.classList.remove('active');
}

async function updateBookingStatus(select) {
  const id = select.dataset.bookingId;
  try {
    await apiFetch(`/api/admin/bookings/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: select.value })
    });
    await Promise.all([refreshCalendar(), loadStats(), loadAllBookings()]);
  } catch (err) {
    alert(err.message);
  }
}

async function deleteBooking(id) {
  if (!confirm('Delete this booking?')) return;
  try {
    await apiFetch(`/api/admin/bookings/${id}`, { method: 'DELETE' });
    closeBookingDetail();
    await Promise.all([refreshCalendar(), loadStats(), loadAllBookings(), loadClients()]);
  } catch (err) {
    alert(err.message);
  }
}

// ─── Dashboard Stats ──────────────────────────────────────────

async function loadStats() {
  try {
    const data = await apiFetch('/api/admin/stats');
    setText('todayBookings', data.todayBookings ?? 0);
    setText('pendingBookings', data.pendingBookings ?? 0);
    setText('totalClients', data.totalClients ?? 0);
    setText('monthRevenue', formatCurrency(data.monthRevenue ?? 0));

    const week = data.week || {};
    setText('weekTotal', week.total ?? 0);
    setText('weekRevenue', formatCurrency(week.revenue ?? 0));

    const month = data.month || {};
    setText('monthTotal', month.total ?? 0);
    setText('monthPeriodRevenue', formatCurrency(month.revenue ?? 0));

    renderUpcoming(data.upcoming || []);
  } catch (err) {
    console.error(err);
  }
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function renderUpcoming(bookings) {
  const tbody = document.getElementById('upcomingTableBody');
  if (!tbody) return;

  if (!bookings.length) {
    tbody.innerHTML = '<tr><td colspan="6">No upcoming appointments.</td></tr>';
    return;
  }

  tbody.innerHTML = bookings.map(b => `
    <tr onclick="openBookingDetail(${b.id})" style="cursor:pointer">
      <td>${escapeHtml(b.name || '—')}</td>
      <td>${b.booking_date || '—'}</td>
      <td>${formatTimeDisplay(b.booking_time || '00:00')}</td>
      <td>${escapeHtml(b.service_name || b.service_id || '—')}</td>
      <td><span class="status-badge ${b.status}">${b.status}</span></td>
      <td>${formatCurrency(b.total_price)}</td>
    </tr>`).join('');
}

// ─── All Bookings Table ───────────────────────────────────────

async function loadAllBookings() {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;

  try {
    const bookings = await apiFetch('/api/admin/bookings');
    if (!bookings.length) {
      tbody.innerHTML = '<tr><td colspan="8">No bookings yet.</td></tr>';
      return;
    }

    tbody.innerHTML = bookings.map(booking => `
      <tr>
        <td><a href="#" onclick="event.preventDefault(); viewClient(${booking.client_id || 0})">${escapeHtml(booking.name || '—')}</a></td>
        <td>${booking.booking_date || '—'}</td>
        <td>${formatTimeDisplay(booking.booking_time || '00:00')}</td>
        <td><span class="status-badge ${booking.status}">${booking.status}</span></td>
        <td>${escapeHtml(booking.service_name || booking.service_id || '—')}</td>
        <td>${formatCurrency(booking.total_price)}</td>
        <td class="comment-cell">${escapeHtml((booking.comment || '—').substring(0, 60))}</td>
        <td>
          <button type="button" class="action-btn" onclick="openBookingDetail(${booking.id})">View</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    console.error(err);
  }
}

// ─── Clients ──────────────────────────────────────────────────

async function loadClients() {
  const tbody = document.getElementById('clientsTableBody');
  if (!tbody) return;

  try {
    const clients = await apiFetch('/api/admin/clients');
    if (!clients.length) {
      tbody.innerHTML = '<tr><td colspan="6">No clients yet.</td></tr>';
      return;
    }

    tbody.innerHTML = clients.map(client => `
      <tr>
        <td><a href="#" onclick="event.preventDefault(); viewClient(${client.id})">${escapeHtml(client.name || '—')}</a></td>
        <td>${escapeHtml(client.phone || '—')}</td>
        <td>${escapeHtml(client.email || '—')}</td>
        <td>${client.total_bookings || 0}</td>
        <td>${formatCurrency(client.total_spent)}</td>
        <td>${client.last_booking_at || '—'}</td>
      </tr>`).join('');
  } catch (err) {
    console.error(err);
  }
}

async function viewClient(id) {
  if (!id) return;
  const panel = document.getElementById('clientDetailsPanel');
  const content = document.getElementById('clientDetailsContent');
  if (!panel || !content) return;

  try {
    const data = await apiFetch(`/api/admin/clients/${id}`);
    content.innerHTML = `
      <p><strong>Name:</strong> ${escapeHtml(data.client.name || '—')}</p>
      <p><strong>Phone:</strong> ${escapeHtml(data.client.phone || '—')}</p>
      <p><strong>Email:</strong> ${escapeHtml(data.client.email || '—')}</p>
      <p><strong>Address:</strong> ${escapeHtml(data.client.address || '—')}</p>
      <p><strong>Total bookings:</strong> ${data.client.total_bookings || 0}</p>
      <p><strong>Total spent:</strong> ${formatCurrency(data.client.total_spent)}</p>
      <h3>Bookings</h3>
      <ul>${(data.bookings || []).map(b => `
        <li><strong>${b.booking_date} ${formatTimeDisplay(b.booking_time)}</strong> — ${escapeHtml(b.service_name || b.service_id)} — ${b.status}</li>
      `).join('')}</ul>`;
    panel.style.display = 'block';
    showSection('clients');
  } catch (err) {
    alert(err.message);
  }
}

function hideClientDetails() {
  document.getElementById('clientDetailsPanel').style.display = 'none';
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Init Event Listeners ─────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('loginForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const password = document.getElementById('passwordInput').value;
    const loginError = document.getElementById('loginError');
    loginError?.classList.remove('visible');

    try {
      await apiFetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      showAdmin();
      await initAdmin();
    } catch {
      loginError?.classList.add('visible');
    }
  });

  document.getElementById('logoutLink')?.addEventListener('click', async (event) => {
    event.preventDefault();
    await apiFetch('/api/admin/logout', { method: 'POST' });
    showLogin();
    document.getElementById('passwordInput').value = '';
  });

  document.getElementById('formDate')?.addEventListener('change', (e) => {
    populateTimeOptions(e.target.value);
  });

  document.querySelectorAll('.bottom-nav-item[data-section]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      if (section === 'add') {
        openAddBooking();
      } else {
        closeAddBooking();
        closeBookingDetail();
        showSection(section);
      }
    });
  });

  checkAuth();
});

// Global exports for inline handlers
window.selectDate = selectDate;
window.changeWeek = changeWeek;
window.openMonthPicker = openMonthPicker;
window.closeMonthPicker = closeMonthPicker;
window.changePickerYear = changePickerYear;
window.selectMonth = selectMonth;
window.openAddBooking = openAddBooking;
window.closeAddBooking = closeAddBooking;
window.submitBookingForm = submitBookingForm;
window.addExtraSlot = addExtraSlot;
window.deleteExtraSlot = deleteExtraSlot;
window.openBookingDetail = openBookingDetail;
window.closeBookingDetail = closeBookingDetail;
window.updateBookingStatus = updateBookingStatus;
window.deleteBooking = deleteBooking;
window.viewClient = viewClient;
window.hideClientDetails = hideClientDetails;
window.showSection = showSection;
