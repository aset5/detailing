let appConfig = null;
let configLoadPromise = null;
let currentStep = 1;
const totalSteps = 4;

const bookingState = {
  name: '',
  phone: '',
  email: '',
  address: '',
  vehicleType: '',
  serviceId: '',
  addons: [],
  comment: '',
  bookingDate: '',
  bookingTime: ''
};

let addressDebounce = null;
let addressActiveIndex = -1;
let addressResults = [];

function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function renderTimeSlotButtons(times) {
  const container = document.getElementById('timeSlots');
  if (!container) return;

  container.innerHTML = times.map(time => `
      <div class="time-slot${bookingState.bookingTime === time ? ' selected' : ''}"
        onclick="selectTimeSlot('${time}')">${formatTimeDisplay(time)}</div>
    `).join('');
}

async function fetchJson(url) {
  const res = await fetch(url);
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error('API unavailable');
  }
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }
  return data;
}

// ─── Address Autocomplete ─────────────────────────────────────

function setupAddressAutocomplete() {
  const input = document.getElementById('inputAddress');
  const dropdown = document.getElementById('addressDropdown');
  if (!input || !dropdown || input.dataset.autocompleteReady) return;
  input.dataset.autocompleteReady = '1';

  input.addEventListener('input', () => {
    addressActiveIndex = -1;
    clearTimeout(addressDebounce);
    const query = input.value.trim();
    if (query.length < 2) {
      hideAddressDropdown();
      return;
    }

    showAddressLoading();
    addressDebounce = setTimeout(() => searchAddress(query), 300);
  });

  input.addEventListener('focus', () => {
    const query = input.value.trim();
    if (query.length >= 2 && addressResults.length) {
      renderAddressDropdown(addressResults);
    } else if (query.length >= 2) {
      showAddressLoading();
      searchAddress(query);
    }
  });

  input.addEventListener('keydown', (e) => {
    if (!dropdown.classList.contains('visible')) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      addressActiveIndex = Math.min(addressActiveIndex + 1, addressResults.length - 1);
      highlightAddressItem();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      addressActiveIndex = Math.max(addressActiveIndex - 1, 0);
      highlightAddressItem();
    } else if (e.key === 'Enter' && addressActiveIndex >= 0) {
      e.preventDefault();
      const item = dropdown.querySelector(`[data-index="${addressActiveIndex}"]`);
      if (item) selectAddress(item);
    } else if (e.key === 'Escape') {
      hideAddressDropdown();
    }
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.address-suggestions')) {
      hideAddressDropdown();
    }
  });
}

function showAddressLoading() {
  const dropdown = document.getElementById('addressDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '<div class="address-dropdown-item address-dropdown-loading">Searching addresses...</div>';
  dropdown.classList.add('visible');
}

function hideAddressDropdown() {
  const dropdown = document.getElementById('addressDropdown');
  if (!dropdown) return;
  dropdown.classList.remove('visible');
  dropdown.innerHTML = '';
  addressResults = [];
  addressActiveIndex = -1;
}

function renderAddressDropdown(results) {
  const dropdown = document.getElementById('addressDropdown');
  if (!dropdown) return;

  addressResults = results;
  if (!results.length) {
    dropdown.innerHTML = '<div class="address-dropdown-item address-dropdown-empty">No addresses found — you can type your full address manually</div>';
    dropdown.classList.add('visible');
    return;
  }

  dropdown.innerHTML = results.map((r, i) =>
    `<div class="address-dropdown-item${i === addressActiveIndex ? ' active' : ''}" data-index="${i}" onclick="selectAddress(this)" data-address="${escapeAttr(r.address)}">${r.address}</div>`
  ).join('');
  dropdown.classList.add('visible');
}

function highlightAddressItem() {
  const dropdown = document.getElementById('addressDropdown');
  if (!dropdown) return;
  dropdown.querySelectorAll('.address-dropdown-item').forEach((el, i) => {
    el.classList.toggle('active', i === addressActiveIndex);
  });
  const active = dropdown.querySelector(`[data-index="${addressActiveIndex}"]`);
  active?.scrollIntoView({ block: 'nearest' });
}

async function searchAddress(query) {
  const dropdown = document.getElementById('addressDropdown');
  if (!dropdown) return;

  try {
    const res = await fetch(`/api/address/search?q=${encodeURIComponent(query)}`);
    const results = await res.json();
    if (document.getElementById('inputAddress')?.value.trim() !== query) return;
    renderAddressDropdown(Array.isArray(results) ? results : []);
  } catch {
    if (document.getElementById('inputAddress')?.value.trim() === query) {
      dropdown.innerHTML = '<div class="address-dropdown-item address-dropdown-empty">Could not load suggestions — type your address manually</div>';
      dropdown.classList.add('visible');
    }
  }
}

async function ensureAppConfig() {
  if (appConfig?.services) return appConfig;
  if (configLoadPromise) return configLoadPromise;

  configLoadPromise = (async () => {
    try {
      const res = await fetch('/api/config');
      if (!res.ok) throw new Error('Config request failed');
      const data = await res.json();
      appConfig = data.services ? data : { services: data };
    } catch (err) {
      console.warn('Could not load config from server:', err.message);
      appConfig = { services: DEFAULT_SERVICES };
    }
    populateServiceOptions();
    populateAddonOptions();
    return appConfig;
  })();

  return configLoadPromise;
}

function getServices() {
  return appConfig?.services || DEFAULT_SERVICES;
}

async function initBooking() {
  setupAddressAutocomplete();
  await ensureAppConfig();
  setDateInputMin();
}

function setDateInputMin() {
  const dateInput = document.getElementById('inputDate');
  if (!dateInput) return;
  const now = new Date();
  const minDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  dateInput.setAttribute('min', minDate);
}

function openBookingModal(event, preselectedService) {
  if (event) event.preventDefault();

  resetBookingForm();
  if (preselectedService) {
    bookingState.serviceId = preselectedService;
  }

  document.getElementById('bookingOverlay').classList.add('active');
  document.body.style.overflow = 'hidden';
  goToStep(1);

  ensureAppConfig().then(() => {
    populateServiceOptions();
    populateAddonOptions();
    if (preselectedService) {
      document.querySelectorAll('.service-option').forEach(el => {
        el.classList.toggle('selected', el.dataset.id === preselectedService);
      });
    }
  });
}

function closeBookingModal() {
  document.getElementById('bookingOverlay').classList.remove('active');
  document.body.style.overflow = '';
}

function resetBookingForm() {
  currentStep = 1;
  Object.keys(bookingState).forEach(k => {
    bookingState[k] = Array.isArray(bookingState[k]) ? [] : '';
  });
  document.querySelectorAll('.booking-error').forEach(el => el.classList.remove('visible'));
  document.getElementById('bookingSuccess').style.display = 'none';
  document.querySelectorAll('.booking-step').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.step-indicator').forEach(el => {
    el.classList.remove('active', 'done');
  });

  const backBtn = document.getElementById('btnBack');
  const nextBtn = document.getElementById('btnNext');
  const footer = document.getElementById('bookingFooter');
  const steps = document.querySelector('.booking-steps');

  if (backBtn) backBtn.style.display = 'none';
  if (nextBtn) {
    nextBtn.disabled = false;
    nextBtn.textContent = 'Continue';
  }
  if (footer) footer.style.display = 'flex';
  if (steps) steps.style.display = 'flex';

  ['inputName', 'inputPhone', 'inputEmail', 'inputAddress', 'inputComment', 'inputDate'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  document.querySelectorAll('.vehicle-option, .service-option, .addon-option, .time-slot').forEach(el => {
    el.classList.remove('selected');
  });
  document.querySelectorAll('.addon-option input[type="checkbox"]').forEach(cb => cb.checked = false);
}

function goToStep(step) {
  currentStep = step;
  document.querySelectorAll('.booking-step').forEach(el => el.classList.remove('active'));
  document.getElementById(`step${step}`).classList.add('active');

  document.querySelectorAll('.step-indicator').forEach((el, i) => {
    el.classList.remove('active', 'done');
    if (i + 1 < step) el.classList.add('done');
    if (i + 1 === step) el.classList.add('active');
  });

  const backBtn = document.getElementById('btnBack');
  const nextBtn = document.getElementById('btnNext');
  backBtn.style.display = step === 1 ? 'none' : 'block';
  nextBtn.textContent = step === totalSteps ? 'Confirm Booking' : 'Continue';

  if (step === 3 && bookingState.bookingDate) loadTimeSlots();
  if (step === 2) {
    ensureAppConfig().then(() => {
      populateServiceOptions();
      populateAddonOptions();
    });
  }
  if (step === 4) renderSummary();
}

function validateStep(step) {
  hideError();

  if (step === 1) {
    const name = document.getElementById('inputName').value.trim();
    const phone = document.getElementById('inputPhone').value.trim();
    const email = document.getElementById('inputEmail').value.trim();
    const address = document.getElementById('inputAddress').value.trim();

    if (!name) return showError('Please enter your name');
    if (!email) return showError('Please enter your email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return showError('Please enter a valid email address');
    if (!address) return showError('Please enter your service address');
    if (!bookingState.vehicleType) return showError('Please select your vehicle type');

    bookingState.name = name;
    bookingState.phone = phone;
    bookingState.email = email;
    bookingState.address = address;
  }

  if (step === 2) {
    if (!bookingState.serviceId) return showError('Please select a service');
  }

  if (step === 3) {
    if (!bookingState.bookingDate) return showError('Please select a date');
    if (!bookingState.bookingTime) return showError('Please select a time');
  }

  return true;
}

function nextStep() {
  if (!validateStep(currentStep)) return;

  if (currentStep === 2) {
    bookingState.addons = [];
    document.querySelectorAll('.addon-option.selected').forEach(el => {
      bookingState.addons.push(el.dataset.id);
    });
    bookingState.comment = document.getElementById('inputComment').value.trim();
  }

  if (currentStep === totalSteps) {
    submitBooking();
    return;
  }

  goToStep(currentStep + 1);
}

function prevStep() {
  if (currentStep > 1) goToStep(currentStep - 1);
}

function showError(msg) {
  const el = document.getElementById('bookingError');
  el.textContent = msg;
  el.classList.add('visible');
  return false;
}

function hideError() {
  document.getElementById('bookingError').classList.remove('visible');
}

async function submitBooking() {
  const nextBtn = document.getElementById('btnNext');
  nextBtn.disabled = true;
  nextBtn.textContent = 'Submitting...';

  const resetBtn = () => {
    nextBtn.disabled = false;
    nextBtn.textContent = 'Confirm Booking';
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    const res = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: bookingState.name,
        phone: bookingState.phone,
        email: bookingState.email,
        address: bookingState.address,
        vehicleType: bookingState.vehicleType,
        serviceId: bookingState.serviceId,
        addons: bookingState.addons,
        comment: bookingState.comment,
        bookingDate: bookingState.bookingDate,
        bookingTime: bookingState.bookingTime
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error('Booking server is not available. Please try again in a few minutes.');
    }

    const data = await res.json();

    if (!res.ok) {
      showError(data.error || 'Something went wrong. Please try again.');
      resetBtn();
      return;
    }

    document.querySelectorAll('.booking-step').forEach(el => el.classList.remove('active'));
    const successEl = document.getElementById('bookingSuccess');
    if (data.notifications?.email?.sent) {
      successEl.textContent = 'Booking submitted! A confirmation email with your appointment details has been sent to your inbox.';
    } else if (data.notifications?.queued) {
      successEl.textContent = 'Booking submitted! A confirmation email will arrive shortly.';
    } else {
      successEl.textContent = 'Booking submitted successfully. We will contact you shortly.';
    }
    successEl.style.display = 'block';
    document.getElementById('bookingFooter').style.display = 'none';
    document.querySelector('.booking-steps').style.display = 'none';
  } catch (err) {
    const msg = err.name === 'AbortError'
      ? 'Request timed out. Please check your connection and try again.'
      : (err.message || 'Network error. Please check your connection and try again.');
    showError(msg);
    resetBtn();
  }
}

function selectVehicle(el) {
  document.querySelectorAll('.vehicle-option').forEach(v => v.classList.remove('selected'));
  el.classList.add('selected');
  bookingState.vehicleType = el.dataset.type;
}

function selectService(el) {
  document.querySelectorAll('.service-option').forEach(s => s.classList.remove('selected'));
  el.classList.add('selected');
  bookingState.serviceId = el.dataset.id;
  bookingState.bookingTime = '';
}

function toggleAddon(el) {
  el.classList.toggle('selected');
  const cb = el.querySelector('input');
  if (cb) cb.checked = el.classList.contains('selected');
}

function populateServiceOptions() {
  const container = document.getElementById('serviceOptions');
  const services = getServices();
  if (!container || !services?.packages?.length) return;

  container.innerHTML = services.packages.map(pkg => `
    <div class="service-option${bookingState.serviceId === pkg.id ? ' selected' : ''}" data-id="${pkg.id}" onclick="selectService(this)">
      <div class="service-option-info">
        <h4>${pkg.name}</h4>
        <p>${pkg.description}</p>
      </div>
      <div class="service-option-price">$${pkg.price}</div>
    </div>
  `).join('');
}

function populateAddonOptions() {
  const container = document.getElementById('addonOptions');
  const services = getServices();
  if (!container || !services?.addons?.length) return;

  container.innerHTML = services.addons.map(addon => {
    const priceLabel = addon.price != null ? `$${addon.price}` : `$${addon.priceFrom}+`;
    return `
    <div class="addon-option" data-id="${addon.id}" onclick="toggleAddon(this)">
      <input type="checkbox" onclick="event.stopPropagation()">
      <div class="addon-option-info">
        <h4>${addon.name}</h4>
      </div>
      <div class="addon-option-price">${priceLabel}</div>
    </div>`;
  }).join('');
}

function renderSummary() {
  const services = getServices();
  const pkg = services.packages.find(p => p.id === bookingState.serviceId);
  const vehicle = services.vehicleTypes.find(v => v.id === bookingState.vehicleType);
  let total = pkg ? pkg.price : 0;

  if (['suv', 'truck', 'van'].includes(bookingState.vehicleType)) {
    total += services.largeVehicleSurcharge;
  }

  const addonNames = bookingState.addons.map(id => {
    const addon = services.addons.find(a => a.id === id);
    if (addon) total += addon.price || addon.priceFrom || 0;
    return addon ? addon.name : id;
  });

  document.getElementById('summaryContent').innerHTML = `
    <div class="summary-row"><span class="summary-label">Name</span><span>${bookingState.name}</span></div>
    <div class="summary-row"><span class="summary-label">Phone</span><span>${bookingState.phone || '—'}</span></div>
    <div class="summary-row"><span class="summary-label">Email</span><span>${bookingState.email || '—'}</span></div>
    <div class="summary-row"><span class="summary-label">Address</span><span>${bookingState.address}</span></div>
    <div class="summary-row"><span class="summary-label">Vehicle</span><span>${vehicle ? vehicle.name : bookingState.vehicleType}</span></div>
    <div class="summary-row"><span class="summary-label">Service</span><span>${pkg ? pkg.name : ''}</span></div>
    <div class="summary-row"><span class="summary-label">Add-ons</span><span>${addonNames.length ? addonNames.join(', ') : 'None'}</span></div>
    <div class="summary-row"><span class="summary-label">Date</span><span>${formatDateDisplay(bookingState.bookingDate)}</span></div>
    <div class="summary-row"><span class="summary-label">Time</span><span>${formatTimeDisplay(bookingState.bookingTime)}</span></div>
    ${bookingState.comment ? `<div class="summary-row"><span class="summary-label">Comment</span><span>${bookingState.comment}</span></div>` : ''}
    <div class="summary-row total"><span>Estimated Total</span><span>$${total}</span></div>
  `;
}

function formatDateDisplay(dateStr) {
  if (!dateStr) return '';
  const [y, m, d] = dateStr.split('-');
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function formatTimeDisplay(timeStr) {
  if (!timeStr) return '';
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
}

// ─── Default services fallback ────────────────────────────────

const DEFAULT_SERVICES = {
  businessHours: { start: 9, end: 18 },
  slotIntervalMinutes: 60,
  packages: [
    { id: 'interior', name: 'Interior only', price: 189, durationMinutes: 180, description: '1-3 hours', image: 'bmw.png' },
    { id: 'full', name: 'Full detailing', price: 239, durationMinutes: 240, description: '2-4 hours', featured: true, image: 'bmw.png' },
    { id: 'ceramic', name: 'Premium Ceramic Coating', price: 670, durationMinutes: 360, description: '4-6 hours', image: 'bmw.png' }
  ],
  addons: [
    { id: 'pet-hair', name: 'Pet Hair Removal', priceFrom: 40 },
    { id: 'seat-shampoo', name: 'Seat Shampoo & Extraction', priceFrom: 40 },
    { id: 'engine-bay', name: 'Engine Bay Detail', price: 50 },
    { id: 'headlight', name: 'Headlight Restoration', price: 40 }
  ],
  vehicleTypes: [
    { id: 'sedan', name: 'Sedan' },
    { id: 'suv', name: 'SUV' },
    { id: 'truck', name: 'Truck' },
    { id: 'van', name: 'Van' }
  ],
  allowedStartTimes: ['09:00', '13:00', '17:00'],
  largeVehicleSurcharge: 40
};

async function loadTimeSlots() {
  const container = document.getElementById('timeSlots');
  if (!container || !bookingState.bookingDate || !bookingState.serviceId) {
    if (container) container.innerHTML = '<p class="no-slots-msg">Select a service and date first</p>';
    return;
  }

  const selectedDate = parseLocalDate(bookingState.bookingDate);
  selectedDate.setHours(0, 0, 0, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (selectedDate < today) {
    container.innerHTML = '<p class="no-slots-msg">Cannot book past dates.</p>';
    return;
  }

  const allowedTimes = getServices().allowedStartTimes || ['09:00', '13:00', '17:00'];
  renderTimeSlotButtons(allowedTimes);

  try {
    const data = await fetchJson(
      `/api/availability/slots?date=${encodeURIComponent(bookingState.bookingDate)}&serviceId=${encodeURIComponent(bookingState.serviceId)}`
    );
    const times = data.slots.filter(time => allowedTimes.includes(time));
    if (times.length) renderTimeSlotButtons(times);
  } catch {
    // Standard times already shown above
  }
}

function selectTimeSlot(time) {
  bookingState.bookingTime = time;
  document.querySelectorAll('.time-slot').forEach(el => {
    el.classList.toggle('selected', el.textContent.trim() === formatTimeDisplay(time));
  });
}

function onDateInputChange(el) {
  bookingState.bookingDate = el.value;
  bookingState.bookingTime = '';
  loadTimeSlots();
}

function escapeAttr(str) {
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function selectAddress(el) {
  const address = el.dataset.address || el.textContent;
  document.getElementById('inputAddress').value = address;
  hideAddressDropdown();
  bookingState.address = address;
}

document.addEventListener('DOMContentLoaded', initBooking);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeBookingModal();
});

document.getElementById('bookingOverlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'bookingOverlay') closeBookingModal();
});
