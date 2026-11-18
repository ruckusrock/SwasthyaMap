// SwasthyaMap — contributor-side prototype (SRS §5.6 FR-6, §5.7 partner-portal-lite,
// DS-4 accredited-contributor channel). No backend: submissions are written to
// localStorage so "My submissions" has something real to show.

const cstate = {
  lang: localStorage.getItem("sm_lang") || "en",
  driveServices: new Set(),
  driveCost: null,
  driveReg: null,
  drivePhoto: null,
  driveLocation: null,
  facilityServices: new Set(),
  facilityType: null,
  facilityOwnership: null,
  facilityCost: null,
  facilitySchemes: new Set(),
  facilityLanguages: new Set(),
  facilityAccessibility: new Set(),
  facilityPhoto: null,
  facilityLocation: null,
  pickerMaps: {},
};

function ct(key) {
  const base = STRINGS[cstate.lang] || STRINGS.en;
  const extra = CONTRIB_STRINGS[cstate.lang] || CONTRIB_STRINGS.en;
  return extra[key] ?? base[key] ?? CONTRIB_STRINGS.en[key] ?? STRINGS.en[key] ?? key;
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = ct(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", ct(el.getAttribute("data-i18n-placeholder")));
  });
}

function setLang(lang) {
  cstate.lang = lang;
  localStorage.setItem("sm_lang", lang);
  document.getElementById("langBtnLabel").textContent = lang.toUpperCase();
  applyTranslations();
  renderChipGroups();
  renderSubmissions();
}

/* ---------- Step navigation ---------- */
const STEPS = ["stepAuth", "stepChoose", "stepDriveForm", "stepFacilityForm", "stepConfirm"];
function showStep(id) {
  STEPS.forEach(s => document.getElementById(s).classList.toggle("hidden", s !== id));
  const pickerMap = id === "stepDriveForm" ? cstate.pickerMaps.drive : id === "stepFacilityForm" ? cstate.pickerMaps.facility : null;
  if (pickerMap && window.google?.maps?.event) {
    setTimeout(() => google.maps.event.trigger(pickerMap, "resize"), 0);
  }
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

/* ---------- Auth (mock mobile + OTP) ---------- */
function initAuth() {
  const verified = localStorage.getItem("sm_contributor_verified") === "1";
  showStep(verified ? "stepChoose" : "stepAuth");

  document.getElementById("sendOtpBtn").addEventListener("click", () => {
    const phone = document.getElementById("phoneInput").value.trim();
    const field = document.getElementById("phoneInput").closest(".field");
    if (!/^\d{10}$/.test(phone)) {
      field.classList.add("invalid");
      document.getElementById("phoneError").classList.remove("hidden");
      return;
    }
    field.classList.remove("invalid");
    document.getElementById("phoneError").classList.add("hidden");
    localStorage.setItem("sm_contributor_phone", phone);
    document.getElementById("authPhoneStage").classList.add("hidden");
    document.getElementById("authOtpStage").classList.remove("hidden");
  });

  document.getElementById("verifyBtn").addEventListener("click", () => {
    const otp = document.getElementById("otpInput").value.trim();
    const field = document.getElementById("otpInput").closest(".field");
    if (!/^\d{4}$/.test(otp)) {
      field.classList.add("invalid");
      document.getElementById("otpError").classList.remove("hidden");
      return;
    }
    field.classList.remove("invalid");
    document.getElementById("otpError").classList.add("hidden");
    localStorage.setItem("sm_contributor_verified", "1");
    showStep("stepChoose");
  });

  document.getElementById("changeNumberBtn").addEventListener("click", () => {
    document.getElementById("authOtpStage").classList.add("hidden");
    document.getElementById("authPhoneStage").classList.remove("hidden");
    document.getElementById("otpInput").value = "";
  });
}

/* ---------- Chip select groups (generic) ---------- */
function buildChipGroup(container, options, mode, selectedRef, onChange) {
  container.innerHTML = "";
  options.forEach(key => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "chip-opt";
    btn.textContent = ct(key);
    btn.dataset.value = key;
    if (mode === "multi" && selectedRef.has(key)) btn.classList.add("selected");
    btn.addEventListener("click", () => {
      if (mode === "multi") {
        if (selectedRef.has(key)) { selectedRef.delete(key); btn.classList.remove("selected"); }
        else { selectedRef.add(key); btn.classList.add("selected"); }
        onChange?.();
      }
    });
    container.appendChild(btn);
  });
}

function wireSingleSelect(containerId, onPick) {
  const container = document.getElementById(containerId);
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip-opt");
    if (!btn) return;
    [...container.children].forEach(c => c.classList.remove("selected"));
    btn.classList.add("selected");
    onPick(btn.dataset.value);
  });
}

function renderChipGroups() {
  // Drive form
  buildChipGroup(document.getElementById("d_services"), SERVICE_OPTIONS, "multi", cstate.driveServices, () => updateOtherService("drive"));
  // Facility form
  buildChipGroup(document.getElementById("f_services"), SERVICE_OPTIONS, "multi", cstate.facilityServices, () => updateOtherService("facility"));
  buildChipGroup(document.getElementById("f_type"), FACILITY_TYPE_OPTIONS, "single", null);
  buildChipGroup(document.getElementById("f_ownership"), OWNERSHIP_OPTIONS, "single", null);
  buildChipGroup(document.getElementById("f_schemes"), SCHEME_OPTIONS, "multi", cstate.facilitySchemes);
  buildChipGroup(document.getElementById("f_languages"), SPOKEN_LANGUAGE_OPTIONS, "multi", cstate.facilityLanguages);

  // Re-mark previously chosen single selects after rebuild (labels change with language, values don't)
  markSingleSelected("d_cost", cstate.driveCost);
  markSingleSelected("d_regRequired", cstate.driveReg);
  markSingleSelected("f_type", cstate.facilityType);
  markSingleSelected("f_ownership", cstate.facilityOwnership);
  markSingleSelected("f_cost", cstate.facilityCost);
}

function updateOtherService(kind) {
  const selected = kind === "drive" ? cstate.driveServices : cstate.facilityServices;
  document.getElementById(`${kind === "drive" ? "d" : "f"}_otherServiceWrap`).classList.toggle("hidden", !selected.has("service_other"));
}

function serviceValues(kind) {
  const selected = kind === "drive" ? cstate.driveServices : cstate.facilityServices;
  const custom = document.getElementById(`${kind === "drive" ? "d" : "f"}_otherService`).value.trim();
  return [...selected].map(value => value === "service_other" && custom ? custom : value);
}

function markSingleSelected(containerId, value) {
  if (!value) return;
  const container = document.getElementById(containerId);
  [...container.children].forEach(c => c.classList.toggle("selected", c.dataset.value === value));
}

function initSingleSelects() {
  wireSingleSelect("d_cost", v => cstate.driveCost = v);
  wireSingleSelect("d_regRequired", v => {
    cstate.driveReg = v;
    document.getElementById("d_regDetailsWrap").classList.toggle("hidden", v !== "yes");
  });
  wireSingleSelect("f_type", v => cstate.facilityType = v);
  wireSingleSelect("f_ownership", v => cstate.facilityOwnership = v);
  wireSingleSelect("f_cost", v => cstate.facilityCost = v);

  // f_accessibility is a static multi-select chip group already in HTML
  const accWrap = document.getElementById("f_accessibility");
  accWrap.querySelectorAll(".chip-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      const val = btn.dataset.value;
      if (cstate.facilityAccessibility.has(val)) { cstate.facilityAccessibility.delete(val); btn.classList.remove("selected"); }
      else { cstate.facilityAccessibility.add(val); btn.classList.add("selected"); }
    });
  });
}

/* ---------- Photo upload ---------- */
function initUpload(inputId, emptyId, previewId, stateKey) {
  document.getElementById(inputId).addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      cstate[stateKey] = reader.result;
      const preview = document.getElementById(previewId);
      preview.src = reader.result;
      preview.classList.remove("hidden");
      document.getElementById(emptyId).classList.add("hidden");
    };
    reader.readAsDataURL(file);
  });
}

/* ---------- Location ---------- */
function initLocate(btnId, labelId, stateKey) {
  document.getElementById(btnId).addEventListener("click", () => {
    const labelEl = document.getElementById(labelId);
    const btn = document.getElementById(btnId);
    if (!navigator.geolocation) {
      labelEl.textContent = ct("locationDenied");
      return;
    }
    labelEl.textContent = ct("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const location = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        if (!Number.isFinite(location.lat) || !Number.isFinite(location.lng)) {
          labelEl.textContent = ct("locationDenied");
          return;
        }
        cstate[stateKey] = location;
        labelEl.textContent = `${ct("locationCaptured")} (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)})`;
        btn.classList.add("located");
      },
      (error) => {
        const message = error.code === error.PERMISSION_DENIED
          ? "Location permission was denied. Allow location access in the browser and try again."
          : error.code === error.POSITION_UNAVAILABLE
            ? "Your location is unavailable. Check device location services and try again."
            : "Location took too long. Try again with location services enabled.";
        labelEl.textContent = message;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function showLocationError(errorId, visible) {
  const error = document.getElementById(errorId);
  error.textContent = visible ? ct("locationLookupFailed") : "";
  error.classList.toggle("hidden", !visible);
}

function distanceBetween(first, second) {
  const earthRadius = 6371;
  const latDelta = (second.lat - first.lat) * Math.PI / 180;
  const lngDelta = (second.lng - first.lng) * Math.PI / 180;
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(lngDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function initMapPicker(mapId, labelId, stateKey, errorId, initialCenter, autofillIds, searchId, resultsId) {
  const mapElement = document.getElementById(mapId);
  const map = new google.maps.Map(mapElement, {
    center: initialCenter || { lat: 20.5937, lng: 78.9629 },
    zoom: initialCenter ? 15 : 5,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
  });
  let marker = null;
  function setMarker(location, zoom = 15) {
    if (marker) marker.setPosition(location);
    else {
      marker = new google.maps.Marker({ map, position: location, draggable: true });
      marker.addListener("dragend", () => {
        const position = marker.getPosition();
        const draggedLocation = { lat: position.lat(), lng: position.lng() };
        setMarker(draggedLocation);
        reverseGeocode(draggedLocation);
      });
    }
    map.setCenter(location);
    map.setZoom(zoom);
    cstate[stateKey] = location;
    showLocationError(errorId, false);
    document.getElementById(labelId).textContent = `${ct("locationCaptured")} (${location.lat.toFixed(4)}, ${location.lng.toFixed(4)})`;
  }

  function fillAddress(result) {
    const formatted = result.display_name || "";
    const address = result.address || {};
    const landmark = address.neighbourhood || address.suburb || address.village || address.town || address.city_district || address.city || address.county || address.road || "";
    if (autofillIds[0]) document.getElementById(autofillIds[0]).value = landmark;
    if (autofillIds[1]) document.getElementById(autofillIds[1]).value = formatted;
  }

  async function reverseGeocode(location) {
    try {
      const params = new URLSearchParams({
        format: "jsonv2",
        addressdetails: "1",
        lat: String(location.lat),
        lon: String(location.lng),
      });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`);
      if (!response.ok) throw new Error("Reverse geocoding failed");
      const result = await response.json();
      if (!result.display_name) throw new Error("No address found");
      fillAddress(result);
      showLocationError(errorId, false);
    } catch {
      showLocationError(errorId, true);
    }
  }

  function distanceFromOrigin(first, second) {
    if (!first) return Number.POSITIVE_INFINITY;
    return distanceBetween(first, second);
  }

  function renderLocationResults(results, resultsId, searchInput) {
    const resultsWrap = document.getElementById(resultsId);
    resultsWrap.innerHTML = "";
    results.slice(0, 5).forEach(result => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "location-result";
      button.textContent = result.display_name;
      button.addEventListener("click", () => {
        const location = { lat: Number(result.lat), lng: Number(result.lon) };
        setMarker(location);
        fillAddress(result);
        searchInput.value = result.display_name;
        resultsWrap.innerHTML = "";
        resultsWrap.classList.add("hidden");
      });
      resultsWrap.appendChild(button);
    });
    resultsWrap.classList.toggle("hidden", results.length === 0);
  }

  function initAddressSearch(searchId, resultsId) {
    const searchInput = document.getElementById(searchId);
    const resultsWrap = document.getElementById(resultsId);
    const search = debounce(async () => {
      const query = searchInput.value.trim();
      if (query.length < 3) {
        resultsWrap.innerHTML = "";
        resultsWrap.classList.add("hidden");
        return;
      }
      try {
        const params = new URLSearchParams({
          q: query,
          format: "jsonv2",
          addressdetails: "1",
          limit: "10",
          countrycodes: "in",
        });
        const response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
        if (!response.ok) throw new Error("Address search failed");
        const results = (await response.json())
          .map(result => ({ ...result, lat: Number(result.lat), lon: Number(result.lon) }))
          .filter(result => Number.isFinite(result.lat) && Number.isFinite(result.lon))
          .sort((first, second) => distanceFromOrigin(initialCenter, { lat: first.lat, lng: first.lon }) - distanceFromOrigin(initialCenter, { lat: second.lat, lng: second.lon }));
        renderLocationResults(results, resultsId, searchInput);
      } catch {
        resultsWrap.innerHTML = "";
        resultsWrap.classList.add("hidden");
      }
    }, 600);
    searchInput.addEventListener("input", search);
  }

  map.addListener("click", event => {
    const location = { lat: event.latLng.lat(), lng: event.latLng.lng() };
    setMarker(location);
    reverseGeocode(location);
  });

  initAddressSearch(searchId, resultsId);

  return map;
}

function getCurrentLocation() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      position => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  });
}

function debounce(callback, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => callback(...args), delay);
  };
}

function loadGoogleMaps() {
  return fetch("/api/config").then(response => response.json()).then(config => new Promise((resolve, reject) => {
    if (!config.googleMapsApiKey) {
      reject(new Error("Google Maps API key is not configured"));
      return;
    }
    window.initContributorGoogleMaps = resolve;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&callback=initContributorGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  }));
}

/* ---------- Validation helper ---------- */
function markField(inputEl, valid) {
  const field = inputEl.closest(".field") || inputEl;
  field.classList.toggle("invalid", !valid);
  return valid;
}

/* ---------- Submissions storage ---------- */
function loadSubmissions() {
  try { return JSON.parse(localStorage.getItem("sm_submissions") || "[]"); }
  catch { return []; }
}
function saveSubmission(sub) {
  const list = loadSubmissions();
  list.unshift(sub);
  localStorage.setItem("sm_submissions", JSON.stringify(list));
}
async function saveLocation(location) {
  if (!location.location || !Number.isFinite(location.location.lat) || !Number.isFinite(location.location.lng)) {
    throw new Error("A valid location is required");
  }
  const response = await fetch("/api/locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(location),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || "Location could not be saved");
  }
}
function renderSubmissions() {
  const list = loadSubmissions();
  const wrap = document.getElementById("submissionsList");
  const empty = document.getElementById("noSubmissions");
  wrap.innerHTML = "";
  if (list.length === 0) {
    empty.classList.remove("hidden");
    return;
  }
  empty.classList.add("hidden");
  list.forEach(sub => {
    const row = document.createElement("div");
    row.className = "submission-item";
    const kindLabel = sub.kind === "DRIVE" ? ct("driveKindLabel") : ct("facilityKindLabel");
    const when = new Date(sub.submittedAt);
    row.innerHTML = `
      <span class="submission-main">
        <span class="submission-name">${escapeHtml(sub.name)}</span>
        <span class="submission-meta">${kindLabel} · ${when.toLocaleDateString()}</span>
      </span>
      <span class="submission-status">${ct("statusPending")}</span>
    `;
    wrap.appendChild(row);
  });
}
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/* ---------- Drive form submit ---------- */
function resetDriveForm() {
  ["d_title", "d_organiser", "d_date", "d_endDate", "d_start", "d_end", "d_venue", "d_landmark", "d_address", "d_eligibility", "d_documents", "d_regDetails", "d_phone"]
    .forEach(id => { document.getElementById(id).value = ""; document.getElementById(id).closest(".field")?.classList.remove("invalid"); });
  cstate.driveServices.clear();
  document.getElementById("d_otherService").value = "";
  document.getElementById("d_otherServiceWrap").classList.add("hidden");
  cstate.driveCost = null;
  cstate.driveReg = null;
  cstate.drivePhoto = null;
  cstate.driveLocation = null;
  document.getElementById("d_regDetailsWrap").classList.add("hidden");
  document.getElementById("d_uploadPreview").classList.add("hidden");
  document.getElementById("d_uploadEmpty").classList.remove("hidden");
  document.getElementById("d_photo").value = "";
  document.getElementById("d_locateBtn").classList.remove("located");
  document.getElementById("d_locateLabel").textContent = ct("useCurrentLocation");
  renderChipGroups();
}

async function submitDrive() {
  let valid = true;
  valid = markField(document.getElementById("d_title"), document.getElementById("d_title").value.trim()) && valid;
  valid = markField(document.getElementById("d_organiser"), document.getElementById("d_organiser").value.trim()) && valid;
  valid = markField(document.getElementById("d_date"), document.getElementById("d_date").value) && valid;
  valid = markField(document.getElementById("d_endDate"), document.getElementById("d_endDate").value) && valid;
  valid = markField(document.getElementById("d_start"), document.getElementById("d_start").value) && valid;
  valid = markField(document.getElementById("d_end"), document.getElementById("d_end").value) && valid;
  valid = markField(document.getElementById("d_venue"), document.getElementById("d_venue").value.trim()) && valid;
  valid = markField(document.getElementById("d_landmark"), document.getElementById("d_landmark").value.trim()) && valid;
  valid = markField(document.getElementById("d_phone"), document.getElementById("d_phone").value.trim()) && valid;
  valid = markField(document.getElementById("d_services"), cstate.driveServices.size > 0) && valid;
  valid = markField(document.getElementById("d_otherService"), !cstate.driveServices.has("service_other") || document.getElementById("d_otherService").value.trim()) && valid;
  valid = markField(document.getElementById("d_cost"), !!cstate.driveCost) && valid;
  valid = markField(document.getElementById("d_locateBtn"), !!cstate.driveLocation) && valid;
  if (document.getElementById("d_date").value && document.getElementById("d_endDate").value && document.getElementById("d_endDate").value < document.getElementById("d_date").value) {
    markField(document.getElementById("d_endDate"), false);
    valid = false;
  }

  if (!valid) {
    document.querySelector("#stepDriveForm .field.invalid, #stepDriveForm .invalid")?.scrollIntoView({ block: "center" });
    return;
  }

  try {
    await saveLocation({
      type: "DRIVE",
      name: document.getElementById("d_title").value.trim(),
      org: document.getElementById("d_organiser").value.trim(),
      address: [document.getElementById("d_venue").value.trim(), document.getElementById("d_landmark").value.trim(), document.getElementById("d_address").value.trim()].filter(Boolean).join(", "),
      cost: cstate.driveCost,
      services: serviceValues("drive").join(", "),
      phone: document.getElementById("d_phone").value.trim(),
      timeLabel: `${document.getElementById("d_date").value} ${document.getElementById("d_start").value}-${document.getElementById("d_end").value}`,
      endDate: document.getElementById("d_endDate").value,
      location: cstate.driveLocation,
      photo: cstate.drivePhoto,
    });
  } catch (error) {
    alert(error.message || "Could not save the location. Make sure the Node server is running and capture a location.");
    return;
  }

  saveSubmission({
    id: "s" + Date.now(),
    kind: "DRIVE",
    name: document.getElementById("d_title").value.trim(),
    submittedAt: Date.now(),
    payload: {
      organiser: document.getElementById("d_organiser").value.trim(),
      date: document.getElementById("d_date").value,
      start: document.getElementById("d_start").value,
      end: document.getElementById("d_end").value,
      venue: document.getElementById("d_venue").value.trim(),
      landmark: document.getElementById("d_landmark").value.trim(),
      address: document.getElementById("d_address").value.trim(),
      services: serviceValues("drive"),
      cost: cstate.driveCost,
      eligibility: document.getElementById("d_eligibility").value.trim(),
      documents: document.getElementById("d_documents").value.trim(),
      registrationRequired: cstate.driveReg === "yes",
      registrationDetails: document.getElementById("d_regDetails").value.trim(),
      phone: document.getElementById("d_phone").value.trim(),
      hasPhoto: !!cstate.drivePhoto,
      location: cstate.driveLocation,
    }
  });

  resetDriveForm();
  showStep("stepConfirm");
}

/* ---------- Facility form submit ---------- */
function resetFacilityForm() {
  ["f_name", "f_landmark", "f_address", "f_openTime", "f_closeTime", "f_phone"]
    .forEach(id => { document.getElementById(id).value = ""; document.getElementById(id).closest(".field")?.classList.remove("invalid"); });
  cstate.facilityServices.clear();
  document.getElementById("f_otherService").value = "";
  document.getElementById("f_otherServiceWrap").classList.add("hidden");
  cstate.facilityType = null;
  cstate.facilityOwnership = null;
  cstate.facilityCost = null;
  cstate.facilitySchemes.clear();
  cstate.facilityLanguages.clear();
  cstate.facilityAccessibility.clear();
  cstate.facilityPhoto = null;
  cstate.facilityLocation = null;
  document.getElementById("f_uploadPreview").classList.add("hidden");
  document.getElementById("f_uploadEmpty").classList.remove("hidden");
  document.getElementById("f_photo").value = "";
  document.getElementById("f_allDay").checked = false;
  document.getElementById("f_timeRange").classList.remove("hidden");
  document.getElementById("f_accessibility").querySelectorAll(".chip-opt").forEach(b => b.classList.remove("selected"));
  document.getElementById("f_locateBtn").classList.remove("located");
  document.getElementById("f_locateLabel").textContent = ct("useCurrentLocation");
  renderChipGroups();
}

async function submitFacility() {
  let valid = true;
  valid = markField(document.getElementById("f_name"), document.getElementById("f_name").value.trim()) && valid;
  valid = markField(document.getElementById("f_type"), !!cstate.facilityType) && valid;
  valid = markField(document.getElementById("f_ownership"), !!cstate.facilityOwnership) && valid;
  valid = markField(document.getElementById("f_landmark"), document.getElementById("f_landmark").value.trim()) && valid;
  valid = markField(document.getElementById("f_address"), document.getElementById("f_address").value.trim()) && valid;
  const openingTime = document.getElementById("f_openTime").value;
  const closingTime = document.getElementById("f_closeTime").value;
  const allDay = document.getElementById("f_allDay").checked;
  if (!allDay) {
    valid = markField(document.getElementById("f_openTime"), openingTime) && valid;
    valid = markField(document.getElementById("f_closeTime"), closingTime) && valid;
  }
  valid = markField(document.getElementById("f_services"), cstate.facilityServices.size > 0) && valid;
  valid = markField(document.getElementById("f_otherService"), !cstate.facilityServices.has("service_other") || document.getElementById("f_otherService").value.trim()) && valid;
  valid = markField(document.getElementById("f_cost"), !!cstate.facilityCost) && valid;
  valid = markField(document.getElementById("f_phone"), document.getElementById("f_phone").value.trim()) && valid;
  valid = markField(document.getElementById("f_locateBtn"), !!cstate.facilityLocation) && valid;

  if (!valid) {
    document.querySelector("#stepFacilityForm .field.invalid, #stepFacilityForm .invalid")?.scrollIntoView({ block: "center" });
    return;
  }

  try {
    await saveLocation({
      type: "FACILITY",
      name: document.getElementById("f_name").value.trim(),
      facilityType: cstate.facilityType,
      org: cstate.facilityOwnership,
      address: [document.getElementById("f_landmark").value.trim(), document.getElementById("f_address").value.trim()].filter(Boolean).join(", "),
      hours: allDay ? "ALL_DAY" : `${openingTime}-${closingTime}`,
      cost: cstate.facilityCost,
      services: serviceValues("facility").join(", "),
      phone: document.getElementById("f_phone").value.trim(),
      location: cstate.facilityLocation,
      photo: cstate.facilityPhoto,
    });
  } catch (error) {
    alert(error.message || "Could not save the location. Make sure the Node server is running and capture a location.");
    return;
  }

  saveSubmission({
    id: "s" + Date.now(),
    kind: "FACILITY",
    name: document.getElementById("f_name").value.trim(),
    submittedAt: Date.now(),
    payload: {
      type: cstate.facilityType,
      ownership: cstate.facilityOwnership,
      landmark: document.getElementById("f_landmark").value.trim(),
      address: document.getElementById("f_address").value.trim(),
      hours: allDay ? "ALL_DAY" : `${openingTime}-${closingTime}`,
      services: serviceValues("facility"),
      cost: cstate.facilityCost,
      schemes: [...cstate.facilitySchemes],
      languages: [...cstate.facilityLanguages],
      accessibility: [...cstate.facilityAccessibility],
      phone: document.getElementById("f_phone").value.trim(),
      hasPhoto: !!cstate.facilityPhoto,
      location: cstate.facilityLocation,
    }
  });

  resetFacilityForm();
  showStep("stepConfirm");
}

/* ---------- Wiring ---------- */
async function init() {
  document.getElementById("langBtnLabel").textContent = cstate.lang.toUpperCase();
  applyTranslations();
  renderChipGroups();
  initSingleSelects();
  initUpload("d_photo", "d_uploadEmpty", "d_uploadPreview", "drivePhoto");
  initUpload("f_photo", "f_uploadEmpty", "f_uploadPreview", "facilityPhoto");
  initLocate("d_locateBtn", "d_locateLabel", "driveLocation");
  initLocate("f_locateBtn", "f_locateLabel", "facilityLocation");
  try {
    await loadGoogleMaps();
    const initialCenter = await getCurrentLocation();
    cstate.pickerMaps.drive = initMapPicker("d_pickerMap", "d_locateLabel", "driveLocation", "d_locationError", initialCenter, ["d_landmark", "d_address"], "d_address", "d_locationResults");
    cstate.pickerMaps.facility = initMapPicker("f_pickerMap", "f_locateLabel", "facilityLocation", "f_locationError", initialCenter, ["f_landmark", "f_address"], "f_address", "f_locationResults");
  } catch (error) {
    document.querySelectorAll(".picker-map").forEach(map => {
      map.textContent = "Map unavailable. A Google Maps API key is required to pin this location.";
    });
  }
  initAuth();
  renderSubmissions();

  document.getElementById("chooseDrive").addEventListener("click", () => showStep("stepDriveForm"));
  document.getElementById("chooseFacility").addEventListener("click", () => showStep("stepFacilityForm"));
  document.getElementById("driveFormBack").addEventListener("click", () => showStep("stepChoose"));
  document.getElementById("facilityFormBack").addEventListener("click", () => showStep("stepChoose"));

  document.getElementById("d_submit").addEventListener("click", submitDrive);
  document.getElementById("f_submit").addEventListener("click", submitFacility);
  document.getElementById("f_allDay").addEventListener("change", event => {
    document.getElementById("f_timeRange").classList.toggle("hidden", event.target.checked);
    if (event.target.checked) {
      document.getElementById("f_openTime").value = "";
      document.getElementById("f_closeTime").value = "";
    }
  });

  document.getElementById("submitAnotherBtn").addEventListener("click", () => {
    renderSubmissions();
    showStep("stepChoose");
  });

  document.getElementById("langBtn").addEventListener("click", () => {
    document.getElementById("langSheetOverlay").classList.add("open");
  });
  document.getElementById("langSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "langSheetOverlay") e.target.classList.remove("open");
  });
  document.querySelectorAll("#langSheetOverlay .lang-option").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById("langSheetOverlay").classList.remove("open");
      setLang(btn.getAttribute("data-lang"));
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
