// SwasthyaMap frontend prototype — vanilla JS, no build step.
// This is a UI shell over mock data (see data.js) intended to demonstrate
// the discovery flow described in the SRS: map/list toggle, filters,
// listing detail with freshness/provenance, and a language switcher.

const state = {
  lang: localStorage.getItem("sm_lang") || null,
  view: "map",
  radius: 5,
  activeChip: null,
  query: "",
  userLocation: null,
  map: null,
  markers: [],
};
const LISTINGS=[];

const RADIUS_OPTIONS = [1, 3, 5, 10, 25, 50];

function t(key) {
  const dict = STRINGS[state.lang] || STRINGS.en;
  return dict[key] ?? STRINGS.en[key] ?? key;
}

function localised(field) {
  if (!field) return "";
  return field[state.lang] || field.en || "";
}

const DISPLAY_LABELS = {
  service_general: "General checkup",
  service_dental: "Dental",
  service_bp: "BP / sugar check",
  service_maternal: "Maternal health",
  service_child: "Child health",
  service_medicines: "Medicines",
  service_lab: "Diagnostic tests",
  service_counselling: "Health counselling",
  service_other: "Other",
  type_hospital: "Hospital",
  type_clinic: "Clinic",
  type_phc: "PHC",
  type_chc: "CHC",
  type_dispensary: "Dispensary",
  type_lab: "Diagnostic lab",
  type_pharmacy: "Pharmacy",
  type_mobile: "Mobile unit",
  own_gov: "Government",
  own_private: "Private",
  own_trust: "Charitable trust",
  own_ngo: "NGO",
  own_coop: "Cooperative",
};

function displayLabel(value) {
  return DISPLAY_LABELS[value] || t(value);
}

function displayServices(field) {
  return localised(field)
    .split(",")
    .map(service => displayLabel(service.trim()))
    .join(", ");
}

function serviceSearchText(field) {
  const values = localised(field).split(",").map(service => service.trim()).filter(Boolean);
  const aliases = {
    chip_vaccination: "vaccination vaccine immunisation immunization",
    chip_bloodDonation: "blood donation blood check",
    service_bp: "bp blood pressure sugar diabetes blood check",
    service_general: "general checkup check-up examination",
    service_dental: "dental dentist teeth tooth",
    service_medicines: "medicine pharmacy drugs",
    service_lab: "lab laboratory diagnostic test tests",
  };
  return values.map(value => `${value} ${displayLabel(value)} ${aliases[value] || ""}`).join(" ").toLowerCase();
}

function displayHours(hours) {
  return hours === "ALL_DAY" ? t("allDayLabel") : hours;
}

function driveStartNotice(listing) {
  if (listing.type !== "DRIVE" || !listing.timeLabel) return "";
  const match = /^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})-/.exec(listing.timeLabel);
  if (!match) return "";
  const start = new Date(`${match[1]}T${match[2]}`);
  if (start <= new Date()) return "";
  const locale = ["en", "hi", "ta", "bn", "mr", "gu", "kn", "te"].includes(state.lang) ? state.lang : "en-IN";
  const formattedStart = start.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  return `<div class="detail-freshness likely"><span>${t("driveStartsOn")} ${formattedStart}.</span></div>`;
}

function driveEndNotice(listing) {
  if (listing.type !== "DRIVE" || !listing.endDate) return "";
  const [year, month, day] = listing.endDate.split("-").map(Number);
  const end = new Date(year, month - 1, day);
  const locale = ["en", "hi", "ta", "bn", "mr", "gu", "kn", "te"].includes(state.lang) ? state.lang : "en-IN";
  const formattedEnd = end.toLocaleDateString(locale, { year: "numeric", month: "long", day: "numeric" });
  return `<div class="detail-freshness likely"><span>${t("driveEndsOn")} ${formattedEnd}.</span></div>`;
}

function distanceBetween(first, second) {
  const earthRadius = 6371;
  const latDelta = (second.lat - first.lat) * Math.PI / 180;
  const lngDelta = (second.lng - first.lng) * Math.PI / 180;
  const value = Math.sin(latDelta / 2) ** 2 + Math.cos(first.lat * Math.PI / 180) * Math.cos(second.lat * Math.PI / 180) * Math.sin(lngDelta / 2) ** 2;
  return earthRadius * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function updateDistances() {
  if (!state.userLocation) return;
  LISTINGS.forEach(listing => {
    listing.distanceKm = listing.location ? Number(distanceBetween(state.userLocation, listing.location).toFixed(1)) : null;
  });
}

function setLang(lang) {
  state.lang = lang;
  localStorage.setItem("sm_lang", lang);
  document.getElementById("langBtnLabel").textContent = lang.toUpperCase();
  applyTranslations();
  renderChips();
  renderAll();
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach(el => {
    el.textContent = t(el.getAttribute("data-i18n"));
  });
  document.querySelectorAll("[data-i18n-placeholder]").forEach(el => {
    el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
  });
}

/* ---------- Chips ---------- */
function renderChips() {
  const row = document.getElementById("chipRow");
  row.innerHTML = "";
  CHIPS.forEach(chip => {
    const btn = document.createElement("button");
    btn.className = "chip" + (state.activeChip === chip.key ? " active" : "");
    btn.textContent = t(chip.key);
    btn.addEventListener("click", () => {
      state.activeChip = state.activeChip === chip.key ? null : chip.key;
      renderChips();
      renderAll();
    });
    row.appendChild(btn);
  });
}

/* ---------- Filtering ---------- */
function getFilteredListings() {
  let items = LISTINGS.filter(l => l.location && (l.distanceKm === null || l.distanceKm <= state.radius));
  if (state.activeChip) {
    const chip = CHIPS.find(c => c.key === state.activeChip);
    if (chip) items = items.filter(chip.filter);
  }
  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    items = items.filter(l =>
      localised(l.name).toLowerCase().includes(q) ||
      serviceSearchText(l.services).includes(q) ||
      localised(l.org).toLowerCase().includes(q)
    );
  }
  return items.sort((a, b) => a.distanceKm - b.distanceKm);
}

/* ---------- Map view ---------- */
function renderMap() {
  const canvas = document.getElementById("mapCanvas");
  if (!state.map) {
    state.map = new google.maps.Map(canvas, { center: { lat: 20.5937, lng: 78.9629 }, zoom: 5, mapTypeControl: false, streetViewControl: false, fullscreenControl: false });
  }
  state.markers.forEach(marker => marker.setMap(null));
  state.markers = [];
  const items = getFilteredListings();

  items.forEach(l => {
    const marker = new google.maps.Marker({ map: state.map, position: l.location, title: localised(l.name), label: l.type === "DRIVE" ? "D" : "F" });
    marker.addListener("click", () => openDetail(l));
    state.markers.push(marker);
  });
  if (state.userLocation) {
    state.markers.push(new google.maps.Marker({ map: state.map, position: state.userLocation, title: "You are here", icon: { path: google.maps.SymbolPath.CIRCLE, scale: 8, fillColor: "#2563EB", fillOpacity: 1, strokeColor: "#fff", strokeWeight: 3 } }));
    state.map.setCenter(state.userLocation);
    state.map.setZoom(13);
  }
}

function iconFor(l) {
  if (l.type === "DRIVE") {
    return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2v6M12 16v6M2 12h6M16 12h6" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;
  }
  return `<svg viewBox="0 0 24 24" fill="none"><path d="M12 2 4 6v6c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V6l-8-4Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
}

/* ---------- List view ---------- */
function renderList() {
  const listEl = document.getElementById("listingList");
  const emptyEl = document.getElementById("emptyState");
  const items = getFilteredListings();
  listEl.innerHTML = "";

  if (items.length === 0) {
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  items.forEach(l => {
    const card = document.createElement("button");
    card.className = "listing-card" + (l.type === "DRIVE" ? " drive" : "");
    card.innerHTML = `
      <span class="card-icon">${iconFor(l)}</span>
      <span class="card-body">
        <span class="card-top">
          <span class="card-name">${localised(l.name)}</span>
          <span class="card-dist">${l.distanceKm === null ? "" : `${l.distanceKm} km`}</span>
        </span>
        <span class="card-sub">${displayLabel(localised(l.org))}</span>
        <span class="badge-row">
          ${badgeCost(l.cost)}
          ${l.type === "DRIVE" ? `<span class="badge badge-time">${localised(l.timeLabel)}</span>` : (l.openNow ? `<span class="badge badge-open">${t("openNow")}</span>` : "")}
          ${badgeFreshness(l.freshness, l.confirmationCount)}
        </span>
      </span>
    `;
    card.addEventListener("click", () => openDetail(l));
    listEl.appendChild(card);
  });
}

function badgeCost(cost) {
  const map = { FREE: ["badge-free", t("free")], SUBSIDISED: ["badge-open", t("subsidised")], PAID: ["", t("paid")] };
  const [cls, label] = map[cost] || ["", cost];
  return `<span class="badge ${cls}">${label}</span>`;
}

function badgeFreshness(level, confirmationCount) {
  if (Number(confirmationCount) >= 10) {
    return `<span class="badge badge-verified">${t("freshTrusted")}</span>`;
  }
  const map = {
    verified: ["badge-verified", t("freshVerified")],
    likely: ["badge-likely", t("freshLikely")],
    checking: ["badge-checking", t("freshChecking")],
  };
  const [cls, label] = map[level] || ["", level];
  return `<span class="badge ${cls}">${label}</span>`;
}

function renderResultCount() {
  const n = getFilteredListings().length;
  document.getElementById("resultCount").textContent = `${n} ${t("resultsFound")}`;
}

function renderAll() {
  if (window.google?.maps) renderMap();
  renderList();
  renderResultCount();
}

async function loadLocations() {
  const response = await fetch("/api/locations");
  if (!response.ok) throw new Error("Could not load locations");
  LISTINGS.splice(0, LISTINGS.length, ...(await response.json()));
}

function loadGoogleMaps() {
  return fetch("/api/config").then(response => response.json()).then(config => new Promise((resolve, reject) => {
    if (!config.googleMapsApiKey) {
      reject(new Error("Missing GOOGLE_MAPS_API_KEY"));
      return;
    }
    window.initGoogleMaps = resolve;
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(config.googleMapsApiKey)}&loading=async&callback=initGoogleMaps`;
    script.async = true;
    script.defer = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  }));
}

function locateUser() {
  if (!navigator.geolocation) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => resolve();
  navigator.geolocation.getCurrentPosition(position => {
    state.userLocation = { lat: position.coords.latitude, lng: position.coords.longitude };
    updateDistances();
      renderAll();
      finish();
    }, finish, { enableHighAccuracy: false, timeout: 4000, maximumAge: 120000 });
  });
}

/* ---------- Detail panel ---------- */
function openDetail(l) {
  const body = document.getElementById("detailBody");
  const trusted = Number(l.confirmationCount) >= 10;
  const freshCls = trusted || l.freshness === "verified" ? "" : l.freshness === "likely" ? "likely" : "checking";
  const freshLabel = trusted ? t("freshTrusted") : l.freshness === "verified" ? t("freshVerified") : l.freshness === "likely" ? t("freshLikely") : t("freshChecking");

  body.innerHTML = `
    ${l.photo ? `<img class="detail-photo" src="${l.photo}" alt="${localised(l.name)}">` : ""}
    <div class="detail-type">${l.type === "DRIVE" ? "Drive" : displayLabel(l.facilityType || "Facility")}</div>
    <div class="detail-name">${localised(l.name)}</div>
    <div class="detail-org">${displayLabel(localised(l.org))}</div>
    <div class="detail-badges">
      ${badgeCost(l.cost)}
      ${l.type === "DRIVE" ? `<span class="badge badge-time">${localised(l.timeLabel)}</span>` : (l.openNow ? `<span class="badge badge-open">${t("openNow")}</span>` : "")}
    </div>
    <div class="detail-freshness ${freshCls}">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="1.8"/><path d="M12 7v5l3.5 2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
      <span>${freshLabel} — ${localised(l.freshnessNote)}</span>
    </div>
    ${driveStartNotice(l)}
    ${driveEndNotice(l)}

    ${l.address ? `<div class="detail-section"><div class="detail-label">${t("addressLabel")}</div><div class="detail-value">${localised(l.address)}</div></div>` : ""}
    ${l.hours ? `<div class="detail-section"><div class="detail-label">${t("hoursLabel")}</div><div class="detail-value">${displayHours(l.hours)}</div></div>` : ""}
    ${serviceSearchText(l.services) ? `<div class="detail-section"><div class="detail-label">${t("servicesOffered")}</div><div class="detail-value">${displayServices(l.services)}</div></div>` : ""}
    ${l.documents ? `<div class="detail-section"><div class="detail-label">${t("documentsNeeded")}</div><div class="detail-value">${localised(l.documents)}</div></div>` : ""}

    <div class="detail-actions">
      <a class="action-btn primary" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${l.location.lat},${l.location.lng}`)}" target="_blank" rel="noopener">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>
        ${t("getDirections")}
      </a>
      ${l.phone && l.phone !== "—" ? `
      <a class="action-btn" href="tel:${l.phone.replace(/[^0-9+]/g, "")}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        ${t("call")}
      </a>` : `<span class="action-btn" style="opacity:.4;cursor:default">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.4c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.2 1L6.6 10.8Z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        ${t("call")}
      </span>`}
      <button class="action-btn" id="shareBtn">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="18" cy="5" r="2.4" stroke="currentColor" stroke-width="1.6"/><circle cx="6" cy="12" r="2.4" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="19" r="2.4" stroke="currentColor" stroke-width="1.6"/><path d="M8.1 10.8 15.9 6.2M8.1 13.2l7.8 4.6" stroke="currentColor" stroke-width="1.6"/></svg>
        ${t("share")}
      </button>
    </div>

    <div class="detail-footer-actions">
      <button class="text-btn" id="confirmBtn"></button>
      <button class="text-btn" id="reportBtn">${t("reportProblem")}</button>
    </div>
  `;

  document.getElementById("detailOverlay").classList.add("open");

  const shareBtn = document.getElementById("shareBtn");
  if (shareBtn) {
    shareBtn.addEventListener("click", () => {
      const text = `${localised(l.name)} — ${localised(l.address) || ""}`;
      if (navigator.share) {
        navigator.share({ title: localised(l.name), text }).catch(() => {});
      } else {
        navigator.clipboard?.writeText(text);
        shareBtn.querySelector("svg").insertAdjacentHTML("afterend", "");
      }
    });
  }
  const confirmBtn = document.getElementById("confirmBtn");
  const confirmationKey = `confirmed:${l.id}`;
  let confirmedByUser = Boolean(sessionStorage.getItem(confirmationKey));
  const updateConfirmationButton = count => {
    confirmBtn.textContent = `${confirmedByUser ? t("retractAccurate") : t("confirmAccurate")} (${count})`;
  };
  updateConfirmationButton(l.confirmationCount || 0);

  confirmBtn.addEventListener("click", (e) => {
    const button = e.target;
    if (button.disabled) return;
    button.disabled = true;
    const retracting = confirmedByUser;
    fetch(`/api/locations/${encodeURIComponent(l.id)}/confirm`, { method: retracting ? "DELETE" : "POST" })
      .then(async response => {
        const result = await response.json();
        if (!retracting && response.status === 409 && result.alreadyConfirmed) {
          const error = new Error("Confirmation already recorded");
          error.confirmationCount = result.confirmationCount;
          throw error;
        }
        if (!response.ok) throw new Error("Confirmation failed");
        return result;
      })
      .then(({ confirmationCount }) => {
        l.confirmationCount = confirmationCount;
        confirmedByUser = !retracting;
        if (confirmedByUser) sessionStorage.setItem(confirmationKey, "1");
        else sessionStorage.removeItem(confirmationKey);
        updateConfirmationButton(confirmationCount);
        button.disabled = false;
        renderList();
        renderResultCount();
      })
      .catch(error => {
        if (error.message === "Confirmation already recorded") {
          l.confirmationCount = error.confirmationCount;
          confirmedByUser = true;
          sessionStorage.setItem(confirmationKey, "1");
          updateConfirmationButton(error.confirmationCount);
          button.disabled = false;
          renderList();
          renderResultCount();
          return;
        }
        button.disabled = false;
        updateConfirmationButton(l.confirmationCount || 0);
      });
  });
  document.getElementById("reportBtn").addEventListener("click", () => {
    openReportSheet(l);
  });
}

function closeDetail() {
  document.getElementById("detailOverlay").classList.remove("open");
}

/* ---------- Report a problem ---------- */
function openReportSheet(l) {
  const select = document.getElementById("reportReasonSelect");
  const details = document.getElementById("reportDetailsInput");
  const error = document.getElementById("reportError");
  const submitBtn = document.getElementById("reportSubmitBtn");
  select.value = "";
  details.value = "";
  error.textContent = t("reportChooseError");
  error.classList.add("hidden");
  submitBtn.disabled = false;
  submitBtn.textContent = t("reportSubmit");
  submitBtn.onclick = () => {
    const reason = select.value;
    if (!reason) {
      error.classList.remove("hidden");
      return;
    }
    error.classList.add("hidden");
    submitBtn.disabled = true;
    submitBtn.textContent = t("reportSubmitting");
    fetch(`/api/locations/${encodeURIComponent(l.id)}/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, details: details.value.trim() }),
    })
      .then(response => {
        if (!response.ok) throw new Error("Report failed");
        return response.json();
      })
      .then(() => {
        submitBtn.textContent = t("reportThanks");
        setTimeout(() => {
          document.getElementById("reportSheetOverlay").classList.remove("open");
        }, 900);
      })
      .catch(() => {
        submitBtn.disabled = false;
        submitBtn.textContent = t("reportSubmit");
        error.textContent = t("reportFailed");
        error.classList.remove("hidden");
      });
  };
  document.getElementById("reportSheetOverlay").classList.add("open");
}

/* ---------- Radius sheet ---------- */
function renderRadiusOptions() {
  const wrap = document.getElementById("radiusOptions");
  wrap.innerHTML = "";
  RADIUS_OPTIONS.forEach(r => {
    const btn = document.createElement("button");
    btn.className = "radius-opt" + (state.radius === r ? " active" : "");
    btn.textContent = `${r} km`;
    btn.addEventListener("click", () => {
      state.radius = r;
      document.getElementById("radiusLabel").textContent = `${r} km`;
      renderRadiusOptions();
      document.getElementById("radiusSheetOverlay").classList.remove("open");
      if (state.userLocation) renderAll();
      else locateUser().then(renderAll);
    });
    wrap.appendChild(btn);
  });
}

/* ---------- Wiring ---------- */
function initLangPicker(isFirstLaunch) {
  const modal = document.getElementById("langModal");
  if (!isFirstLaunch) {
    modal.classList.add("hidden");
    return;
  }
  modal.classList.remove("hidden");
  modal.querySelectorAll(".lang-option").forEach(btn => {
    btn.addEventListener("click", () => {
      modal.classList.add("hidden");
      setLang(btn.getAttribute("data-lang"));
    });
  });
  document.getElementById("langSkip").addEventListener("click", () => {
    modal.classList.add("hidden");
    setLang("en");
  });
}

function initPolicyGate(isFirstLaunch) {
  const modal = document.getElementById("policyModal");
  if (localStorage.getItem("sm_policy_agreed") === "1") {
    modal.classList.add("hidden");
    return false;
  }
  modal.classList.remove("hidden");
  document.getElementById("policyAgree").addEventListener("click", () => {
    localStorage.setItem("sm_policy_agreed", "1");
    modal.classList.add("hidden");
    initLangPicker(isFirstLaunch);
  });
  return true;
}

async function init() {
  const isFirstLaunch = !state.lang;
  if (!state.lang) state.lang = "en";
  if (!initPolicyGate(isFirstLaunch)) initLangPicker(isFirstLaunch);
  const locationsPromise = loadLocations().then(() => {
    updateDistances();
    renderAll();
  }).catch(() => {});
  locateUser();
  let mapsAvailable = false;
  loadGoogleMaps().then(() => {
    mapsAvailable = true;
    renderAll();
  }).catch(() => {
    document.getElementById("mapCanvas").textContent = "Add GOOGLE_MAPS_API_KEY and restart the server to show the live map.";
    document.getElementById("mapCanvas").classList.add("map-config-error");
  });
  document.getElementById("langBtnLabel").textContent = state.lang.toUpperCase();
  applyTranslations();
  renderChips();
  renderRadiusOptions();
  if (mapsAvailable && window.google?.maps) renderAll();

  document.querySelectorAll(".view-tab").forEach(tab => {
    tab.addEventListener("click", () => {
      document.querySelectorAll(".view-tab").forEach(x => x.classList.remove("active"));
      tab.classList.add("active");
      state.view = tab.getAttribute("data-view");
      document.getElementById("mapView").classList.toggle("hidden", state.view !== "map");
      document.getElementById("listView").classList.toggle("hidden", state.view !== "list");
    });
  });

  document.getElementById("searchInput").addEventListener("input", (e) => {
    state.query = e.target.value;
    renderAll();
  });

  document.getElementById("radiusBtn").addEventListener("click", () => {
    document.getElementById("radiusSheetOverlay").classList.add("open");
  });
  document.getElementById("radiusSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "radiusSheetOverlay") e.target.classList.remove("open");
  });

  document.getElementById("reportCancelBtn").addEventListener("click", () => {
    document.getElementById("reportSheetOverlay").classList.remove("open");
  });
  document.getElementById("reportSheetOverlay").addEventListener("click", (e) => {
    if (e.target.id === "reportSheetOverlay") e.target.classList.remove("open");
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

  document.getElementById("detailClose").addEventListener("click", closeDetail);
  document.getElementById("detailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "detailOverlay") closeDetail();
  });

  document.getElementById("recenterBtn").addEventListener("click", () => {
    if (state.userLocation && state.map) state.map.setCenter(state.userLocation);
    else locateUser();
  });
}

document.addEventListener("DOMContentLoaded", init);
