
/* GREENPULSE - Complete working JavaScript */

"use strict";

const $ = id => document.getElementById(id);

const TREE_KEY = "greenpulseTrees";
const PROFILE_KEY = "greenpulseProfile";

let trees = [];
let map = null;
let markerLayer = null;
let selectedMarker = null;
let selectedLocation = null;
let lastGeoRequest = 0;

/* ---------- SAFE HTML ---------- */

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;"
  })[ch]);
}

function newId() {
  return "tree-" + Date.now() + "-" +
    Math.random().toString(36).slice(2, 7);
}

function hasGPS(tree) {
  return tree.lat !== null && tree.lat !== "" &&
    tree.lon !== null && tree.lon !== "" &&
    tree.lat !== undefined && tree.lon !== undefined &&
    Number.isFinite(Number(tree.lat)) &&
    Number.isFinite(Number(tree.lon));
}

/* ---------- LOCAL STORAGE ---------- */

function loadTrees() {
  try {
    const saved = localStorage.getItem(TREE_KEY);

    if (saved === null) {
      trees = [
        {
          id: newId(), name: "Neem", location: "Chennai",
          date: "", status: "Healthy", notes: "",
          lat: null, lon: null
        },
        {
          id: newId(), name: "Mango", location: "Cuddalore",
          date: "", status: "Need Water", notes: "",
          lat: null, lon: null
        },
        {
          id: newId(), name: "Banyan", location: "Tambaram",
          date: "", status: "Healthy", notes: "",
          lat: null, lon: null
        }
      ];
      saveTrees();
    } else {
      const parsed = JSON.parse(saved);
      trees = Array.isArray(parsed) ? parsed : [];
    }

    // Preserve existing records, including saved GPS coordinates.
    trees = trees.map(tree => ({
      ...tree,
      id: tree.id || newId(),
      name: tree.name || "Unnamed tree",
      location: tree.location || "Unknown location",
      status: tree.status || "Healthy",
      lat: tree.lat ?? null,
      lon: tree.lon ?? null
    }));

    saveTrees();
  } catch (error) {
    console.error("Tree storage error:", error);
    trees = [];
  }
}

function saveTrees() {
  localStorage.setItem(TREE_KEY, JSON.stringify(trees));
}

/* ---------- NAVIGATION ---------- */

const pageNames = {
  overview: "Overview",
  trees: "My Trees",
  "map-page": "Real Map",
  analytics: "Analytics",
  profile: "My Profile"
};

function navigate(pageId) {
  if (!$ (pageId)) return;

  document.querySelectorAll(".page").forEach(page => {
    page.classList.toggle("active", page.id === pageId);
  });

  document.querySelectorAll("[data-page]").forEach(button => {
    button.classList.toggle("active", button.dataset.page === pageId);
  });

  $("page-title").textContent = pageNames[pageId] || "GreenPulse";

  if (pageId === "map-page") {
    initializeMap();
    setTimeout(() => {
      if (map) map.invalidateSize();
      renderMapMarkers();
    }, 250);
  }

  if (pageId === "analytics") renderAnalytics();

  history.replaceState(null, "", "#" + pageId);
}

/* ---------- GEOCODING ---------- */

// Use Nominatim only in response to an explicit user action.
// Public service requests are spaced at least 1.1 seconds apart.
async function geoWait() {
  const delay = Math.max(0, 1100 - (Date.now() - lastGeoRequest));

  if (delay) {
    await new Promise(resolve => setTimeout(resolve, delay));
  }

  lastGeoRequest = Date.now();
}

function addressLabel(address, fallback) {
  const locality =
    address.suburb ||
    address.neighbourhood ||
    address.city_district ||
    address.town ||
    address.city ||
    address.village ||
    address.hamlet;

  const district = address.state_district || address.county;
  const state = address.state;

  const parts = [...new Set([locality, district, state].filter(Boolean))];

  return parts.length ? parts.join(", ") :
    (fallback || "Location found");
}

async function searchPlace(query) {
  query = String(query || "").trim();

  if (!query) throw new Error("Enter a city, district, or place name.");

  await geoWait();

  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2" +
    "&limit=1&addressdetails=1&q=" + encodeURIComponent(query);

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Place search failed. Check your internet connection.");
  }

  const results = await response.json();

  if (!results.length) {
    throw new Error("Place not found. Try a nearby city or district.");
  }

  const item = results[0];

  return {
    lat: Number(item.lat),
    lon: Number(item.lon),
    label: addressLabel(item.address || {}, item.display_name)
  };
}

async function reverseGeocode(lat, lon) {
  await geoWait();

  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2" +
    "&lat=" + encodeURIComponent(lat) +
    "&lon=" + encodeURIComponent(lon) +
    "&zoom=18&addressdetails=1";

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error("Could not look up the place name.");
  }

  const data = await response.json();

  if (data.error) throw new Error(data.error);

  return addressLabel(data.address || {}, data.display_name);
}

/* ---------- LEAFLET MAP ---------- */

function initializeMap() {
  if (!$("map") || typeof L === "undefined") {
    setMapMessage("The map library did not load. Check your internet connection.");
    return;
  }

  if (map) {
    setTimeout(() => map.invalidateSize(), 100);
    return;
  }

  map = L.map("map").setView([11.2, 79.3], 7);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">' +
      'OpenStreetMap</a> contributors'
  }).addTo(map);

  markerLayer = L.layerGroup().addTo(map);

  map.on("click", async event => {
    const lat = event.latlng.lat;
    const lon = event.latlng.lng;

    selectedLocation = { lat, lon, label: "" };

    if ($("tree-lat")) $("tree-lat").value = lat;
    if ($("tree-lon")) $("tree-lon").value = lon;

    setSelectedMarker(lat, lon, "Selected location");
    setMapMessage("Looking up the selected location...");

    try {
      const label = await reverseGeocode(lat, lon);

      selectedLocation.label = label;

      if ($("tree-location")) $("tree-location").value = label;
      if ($("tree-lat")) $("tree-lat").value = lat;
      if ($("tree-lon")) $("tree-lon").value = lon;

      setSelectedMarker(lat, lon, label);
      setMapMessage("Selected: " + label);
    } catch (error) {
      setMapMessage(
        "Coordinates selected. The place name could not be loaded."
      );
    }
  });

  renderMapMarkers();
}

function setMapMessage(message) {
  if ($("map-message")) $("map-message").textContent = message;
}

function setFormMessage(message) {
  if ($("form-location-message")) {
    $("form-location-message").textContent = message;
  }
}

function setSelectedMarker(lat, lon, label) {
  if (!map) return;

  if (selectedMarker) map.removeLayer(selectedMarker);

  selectedMarker = L.marker([lat, lon])
    .addTo(map)
    .bindPopup(esc(label))
    .openPopup();

  map.setView([lat, lon], 15);
}

function renderMapMarkers() {
  if (!map || !markerLayer) return;

  markerLayer.clearLayers();

  trees.forEach(tree => {
    if (!hasGPS(tree)) return;

    L.marker([Number(tree.lat), Number(tree.lon)])
      .bindPopup(
        "<strong>" + esc(tree.name) + "</strong><br>" +
        esc(tree.location) + "<br>" +
        "Health: " + esc(tree.status) + "<br>" +
        "Coordinates: " + Number(tree.lat).toFixed(5) +
        ", " + Number(tree.lon).toFixed(5)
      )
      .addTo(markerLayer);
  });

  renderLocationList();
}

async function searchMap() {
  const query = $("map-search").value.trim();

  if (!query) {
    setMapMessage("Enter a place to search.");
    return;
  }

  setMapMessage("Searching for place...");

  try {
    const place = await searchPlace(query);

    navigate("map-page");
    initializeMap();

    if (!map) return;

    setSelectedMarker(place.lat, place.lon, place.label);
    selectedLocation = place;

    $("map-search").value = query;
    setMapMessage("Found: " + place.label);
  } catch (error) {
    setMapMessage(error.message);
  }
}

/* ---------- GPS LOCATION ---------- */

function getGPS() {
  if (!navigator.geolocation) {
    const message = "Your browser does not support GPS location.";
    setFormMessage(message);
    setMapMessage(message);
    alert(message);
    return;
  }

  setFormMessage("Requesting laptop location permission...");
  setMapMessage("Requesting laptop location permission...");

  navigator.geolocation.getCurrentPosition(
    async position => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      // Coordinates are retained even if address lookup fails.
      selectedLocation = { lat, lon, label: "" };

      if ($("tree-lat")) $("tree-lat").value = lat;
      if ($("tree-lon")) $("tree-lon").value = lon;

      let label = `GPS location (${lat.toFixed(5)}, ${lon.toFixed(5)})`;

      setFormMessage("GPS found. Looking up district and place name...");
      setMapMessage("GPS found. Looking up district and place name...");

      try {
        label = await reverseGeocode(lat, lon);
      } catch (error) {
        console.warn("Address lookup failed:", error);
      }

      selectedLocation = { lat, lon, label };

      if ($("tree-location")) $("tree-location").value = label;
      if ($("tree-lat")) $("tree-lat").value = lat;
      if ($("tree-lon")) $("tree-lon").value = lon;

      setFormMessage(
        "Location selected: " + label +
        ` (${lat.toFixed(5)}, ${lon.toFixed(5)})`
      );
      setMapMessage(
        "Your location: " + label +
        ` (${lat.toFixed(5)}, ${lon.toFixed(5)})`
      );

      // If the map page is visible, show the GPS marker.
      if ($("map-page").classList.contains("active")) {
        initializeMap();
        if (map) setSelectedMarker(lat, lon, label);
      }
    },
    error => {
      const messages = {
        1: "Location permission denied. Allow Location in Chrome site settings.",
        2: "Location unavailable. Check Windows Location services and Wi-Fi.",
        3: "Location request timed out. Please try again."
      };

      const message = messages[error.code] ||
        "Could not access your location.";

      setFormMessage(message);
      setMapMessage(message);
      alert(message);
    },
    {
      enableHighAccuracy: true,
      timeout: 25000,
      maximumAge: 60000
    }
  );
}

/* ---------- ADD TREE ---------- */

function openModal() {
  $("tree-form").reset();
  $("tree-lat").value = "";
  $("tree-lon").value = "";

  selectedLocation = null;
  setFormMessage("");

  $("tree-modal").classList.add("open");
  $("tree-modal").setAttribute("aria-hidden", "false");
  $("tree-name").focus();
}

function closeModal() {
  $("tree-modal").classList.remove("open");
  $("tree-modal").setAttribute("aria-hidden", "true");
}

async function findPlaceForTree() {
  const query = $("tree-location").value.trim();

  setFormMessage("Searching for place...");

  try {
    const place = await searchPlace(query);

    selectedLocation = place;
    $("tree-location").value = place.label;
    $("tree-lat").value = place.lat;
    $("tree-lon").value = place.lon;

    setFormMessage(
      "Location selected: " + place.label +
      ` (${place.lat.toFixed(5)}, ${place.lon.toFixed(5)})`
    );

    initializeMap();

    if (map) setSelectedMarker(place.lat, place.lon, place.label);
  } catch (error) {
    setFormMessage(error.message);
  }
}

function addTree(event) {
  event.preventDefault();

  const name = $("tree-name").value.trim();
  const location = $("tree-location").value.trim();

  if (!name || !location) {
    alert("Please enter both the tree name and location.");
    return;
  }

  const latValue = $("tree-lat").value;
  const lonValue = $("tree-lon").value;

  const tree = {
    id: newId(),
    name,
    location,
    date: $("tree-date").value || "",
    status: $("tree-status").value,
    notes: $("tree-notes").value.trim(),
    lat: latValue !== "" && lonValue !== ""
      ? Number(latValue) : null,
    lon: latValue !== "" && lonValue !== ""
      ? Number(lonValue) : null
  };

  if (!Number.isFinite(tree.lat)) tree.lat = null;
  if (!Number.isFinite(tree.lon)) tree.lon = null;

  trees.unshift(tree);
  saveTrees();
  closeModal();
  renderAll();

  alert("Tree saved successfully! 🌱");
}

/* ---------- TREE TABLE ---------- */

function renderTrees() {
  const tbody = $("trees-table-body");
  const search = $("tree-search").value.toLowerCase().trim();
  const filter = $("status-filter").value;

  const filtered = trees.filter(tree => {
    const matches =
      `${tree.name} ${tree.location} ${tree.status}`
        .toLowerCase().includes(search);

    return matches && (!filter || tree.status === filter);
  });

  if (!filtered.length) {
    tbody.innerHTML =
      '<tr><td colspan="6">No trees found. Add your first tree!</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(tree => {
    const coordinates = hasGPS(tree)
      ? `${Number(tree.lat).toFixed(5)}, ${Number(tree.lon).toFixed(5)}`
      : "Not saved";

    const locationAction = hasGPS(tree)
      ? `<button data-action="show" data-id="${esc(tree.id)}">Show map</button>`
      : `<button data-action="locate" data-id="${esc(tree.id)}">Locate</button>`;

    return `
      <tr>
        <td>🌱 ${esc(tree.name)}</td>
        <td>${esc(tree.location)}</td>
        <td>${esc(tree.date || "Not specified")}</td>
        <td><strong>${esc(tree.status)}</strong></td>
        <td>${esc(coordinates)}</td>
        <td>
          ${locationAction}
          <button data-action="remove" data-id="${esc(tree.id)}">Remove</button>
        </td>
      </tr>
    `;
  }).join("");
}

function removeTree(id) {
  const tree = trees.find(item => String(item.id) === String(id));
  if (!tree) return;

  if (!confirm(`Remove ${tree.name} from your records?`)) return;

  trees = trees.filter(item => String(item.id) !== String(id));
  saveTrees();
  renderAll();
}

async function locateTree(id) {
  const tree = trees.find(item => String(item.id) === String(id));
  if (!tree) return;

  if (hasGPS(tree)) {
    showTreeOnMap(id);
    return;
  }

  try {
    setMapMessage("Finding " + tree.location + "...");

    const place = await searchPlace(tree.location);

    tree.lat = place.lat;
    tree.lon = place.lon;
    tree.location = place.label;

    saveTrees();
    renderAll();

    navigate("map-page");

    setTimeout(() => {
      if (map) setSelectedMarker(place.lat, place.lon, place.label);
    }, 250);
  } catch (error) {
    alert("Could not locate this tree: " + error.message);
  }
}

function showTreeOnMap(id) {
  const tree = trees.find(item => String(item.id) === String(id));
  if (!tree || !hasGPS(tree)) return;

  navigate("map-page");

  setTimeout(() => {
    if (!map) initializeMap();

    if (map) {
      setSelectedMarker(
        Number(tree.lat),
        Number(tree.lon),
        tree.name + " — " + tree.location
      );
    }
  }, 300);
}

function renderLocationList() {
  const container = $("location-list");
  if (!container) return;

  const located = trees.filter(hasGPS);

  if (!located.length) {
    container.innerHTML =
      "<p>No saved GPS locations yet. Add a tree using GPS or place search.</p>";
    return;
  }

  container.innerHTML = located.map(tree => `
    <div class="location-card">
      <strong>🌳 ${esc(tree.name)}</strong>
      <p>${esc(tree.location)}</p>
      <p>${Number(tree.lat).toFixed(5)}, ${Number(tree.lon).toFixed(5)}</p>
      <button class="secondary-btn" data-action="show"
        data-id="${esc(tree.id)}">Show on map</button>
    </div>
  `).join("");
}

/* ---------- DASHBOARD ---------- */

function renderOverview() {
  $("total-trees").textContent = trees.length;
  $("healthy-trees").textContent =
    trees.filter(t => t.status === "Healthy").length;
  $("water-trees").textContent =
    trees.filter(t => t.status === "Need Water").length;
  $("care-trees").textContent =
    trees.filter(t => t.status === "Needs Care").length;

  $("recent-trees").innerHTML = trees.length
    ? trees.slice(0, 5).map(tree => `
        <div class="list-item">
          <strong>🌱 ${esc(tree.name)}</strong>
          <p>${esc(tree.location)}</p>
          <span>${esc(tree.status)}</span>
        </div>
      `).join("")
    : "<p>No trees added yet.</p>";

  const reminders = trees.filter(t =>
    t.status === "Need Water" || t.status === "Needs Care"
  );

  $("care-reminders").innerHTML = reminders.length
    ? reminders.map(tree => `
        <div class="care-item">
          <strong>${esc(tree.name)}</strong>
          <p>${esc(tree.location)}</p>
          <span>${esc(tree.status)}</span>
        </div>
      `).join("")
    : "<p>All your trees are looking good! 🌿</p>";
}

/* ---------- ANALYTICS ---------- */

function makeBar(label, count, max) {
  const percent = max ? (count / max) * 100 : 0;

  return `
    <div class="bar-row">
      <div class="bar-label">
        <span>${esc(label)}</span><strong>${count}</strong>
      </div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function renderAnalytics() {
  const statuses = ["Healthy", "Need Water", "Needs Care"];

  $("analytics-summary").innerHTML = `
    <div class="stat-card"><span>Total trees</span><strong>${trees.length}</strong></div>
    <div class="stat-card"><span>Located trees</span><strong>${trees.filter(hasGPS).length}</strong></div>
    <div class="stat-card"><span>Different places</span><strong>${new Set(trees.map(t => t.location).filter(Boolean)).size}</strong></div>
    <div class="stat-card"><span>Care needed</span><strong>${trees.filter(t => t.status !== "Healthy").length}</strong></div>
  `;

  const counts = statuses.map(status =>
    trees.filter(tree => tree.status === status).length
  );

  $("health-breakdown").innerHTML = statuses.map((status, index) =>
    makeBar(status, counts[index], Math.max(...counts, 1))
  ).join("");

  const locationCounts = {};

  trees.forEach(tree => {
    const name = tree.location || "Unknown";
    locationCounts[name] = (locationCounts[name] || 0) + 1;
  });

  const entries = Object.entries(locationCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  const max = Math.max(1, ...entries.map(item => item[1]));

  $("location-breakdown").innerHTML = entries.length
    ? entries.map(([name, count]) => makeBar(name, count, max)).join("")
    : "<p>No location data yet.</p>";
}

/* ---------- PROFILE ---------- */

function loadProfile() {
  try {
    const profile = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");

    $("profile-name").value = profile.name || "";
    $("profile-email").value = profile.email || "";
    $("profile-location").value = profile.location || "";
  } catch (error) {
    console.warn("Could not load profile:", error);
  }
}

function saveProfile(event) {
  event.preventDefault();

  const profile = {
    name: $("profile-name").value.trim(),
    email: $("profile-email").value.trim(),
    location: $("profile-location").value.trim()
  };

  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  alert("Profile saved successfully!");
}

/* ---------- RENDER ---------- */

function renderAll() {
  renderOverview();
  renderTrees();
  renderLocationList();
  renderAnalytics();
}

/* ---------- BUTTON EVENTS ---------- */

document.addEventListener("DOMContentLoaded", () => {
  loadTrees();

  document.querySelectorAll("[data-page]").forEach(button => {
    button.addEventListener("click", event => {
      event.preventDefault();
      navigate(button.dataset.page);
    });
  });

  document.querySelectorAll("[data-open-modal]").forEach(button => {
    button.addEventListener("click", openModal);
  });

  $("close-modal").addEventListener("click", closeModal);
  $("cancel-modal").addEventListener("click", closeModal);

  $("tree-modal").addEventListener("click", event => {
    if (event.target === $("tree-modal")) closeModal();
  });

  $("tree-form").addEventListener("submit", addTree);
  $("tree-find-place").addEventListener("click", findPlaceForTree);
  $("tree-use-gps").addEventListener("click", getGPS);

  $("map-search-btn").addEventListener("click", searchMap);
  $("map-gps-btn").addEventListener("click", getGPS);

  $("map-search").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      searchMap();
    }
  });

  $("tree-search").addEventListener("input", renderTrees);
  $("status-filter").addEventListener("change", renderTrees);
  $("profile-form").addEventListener("submit", saveProfile);

  document.addEventListener("click", event => {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    const id = button.dataset.id;

    if (button.dataset.action === "remove") removeTree(id);
    if (button.dataset.action === "show") showTreeOnMap(id);
    if (button.dataset.action === "locate") locateTree(id);
  });

  loadProfile();
  renderAll();

  // Support direct opening of a section through a URL hash.
  const requestedPage = location.hash.replace("#", "");
  const validPages = ["overview", "trees", "map-page", "analytics", "profile"];

  if (validPages.includes(requestedPage)) {
    navigate(requestedPage);
  }
});
