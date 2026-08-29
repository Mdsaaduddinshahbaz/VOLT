// Socket connects ONCE, the first time this script loads, and stays alive
// across all SPA navigation (this script tag is only ever injected once —
// see spa-router.js's ensureScriptLoaded).

// --------------------------------------------------------------------------
// SECURITY NOTE (server-side, can't be fixed from this file alone):
// - Authenticate the socket connection (e.g. `io({ auth: { token }, autoConnect:false })`)
//   and verify on the server that the connecting user actually owns the
//   order_id they ask to join/track. Right now any client that knows an
//   order_id can emit "track_order" / "join_user_room" for it.
// - Validate order ownership + order_id format on /get_orders/:userId and
//   /update_order_user server-side (never trust the client's userId alone).
// --------------------------------------------------------------------------

const socket = io({
    autoConnect: false
});

const DEBUG = false; // flip to true only while debugging locally
function log(...args) {
    if (DEBUG) console.log(...args);
}

// ============================================================
// DRIVER / MAP STATE
// ============================================================

let driverMarker = null;
let warehouseMarker = null;
let driverRouteLine = null;
let maps = null;

let currentDriverPosition = null; // L.LatLng
let driverRouteCoords = [];        // [[lat,lng], ...] of the *current* OSRM route
let animationFrame = null;

let trackingOrderId = null;
let warehouseLat = null;
let warehouseLng = null;

// If the driver strays further than this from the last computed route,
// treat it as "took a different road" and recompute instead of trimming.
const ROUTE_DEVIATION_METERS = 150;

// ============================================================
// SMALL UTILITIES
// ============================================================

// Escape untrusted text before it goes into innerHTML.
function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Coordinates have shown up under a few different key spellings
// (lat/lng, lat/long, latt/long, latitude/longitude). Normalize them
// all here instead of guessing at each call site.
function extractLatLng(coords) {
    if (!coords) return null;

    const rawLat = coords.lat ?? coords.latt ?? coords.latitude;
    const rawLng = coords.lng ?? coords.long ?? coords.longitude;

    const lat = Number(rawLat);
    const lng = Number(rawLng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.error("Invalid coordinates:", coords);
        return null;
    }

    return L.latLng(lat, lng);
}

function safeNumberAttr(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

function currentUserId() {
    return window.APP_USER_ID || window.location.pathname.split("/").pop();
}

// ============================================================
// MAP HELPERS (shared between the two tracking entry points)
// ============================================================

function ensureMapInitialized() {
    // BUG FIX: this used to be `if (map)`, which only created the map
    // when one already existed (i.e. never, on first load) and would
    // silently blow away an existing map + markers on later calls.
    if (!maps) {
        maps = L.map("map", { zoomControl: true });

        // CARTO's dark basemap instead of stock OSM tiles: no building
        // fills/POI clutter at delivery zoom levels, and it's already
        // dark so we don't need the old grayscale/invert/hue-rotate CSS
        // hack (which looked pretty rough on real OSM tiles anyway).
        L.tileLayer(
            "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
            {
                attribution:
                    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
                subdomains: "abcd",
                maxZoom: 19
            }
        ).addTo(maps);
    }

    setTimeout(() => {
        if (maps) maps.invalidateSize();
    }, 300);
}

// Small colored dots instead of Leaflet's default blue pin, so the map
// reads as part of the app's theme rather than a generic embed.
function driverIcon() {
    return L.divIcon({
        className: "",
        html: '<div class="driver-marker-dot"></div>',
        iconSize: [18, 18],
        iconAnchor: [9, 9]
    });
}

function pickupIcon() {
    return L.divIcon({
        className: "",
        html: '<div class="pickup-marker-dot"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7]
    });
}

function setWarehouseMarker(latLng) {
    if (!latLng) return;

    warehouseLat = latLng.lat;
    warehouseLng = latLng.lng;

    if (!warehouseMarker) {
        warehouseMarker = L.marker(latLng, { icon: pickupIcon() }).addTo(maps);
    } else {
        warehouseMarker.setLatLng(latLng);
    }

    reverseGeocodePickup(latLng.lat, latLng.lng);
}

function setOrCreateDriverMarker(latLng) {
    if (!driverMarker) {
        driverMarker = L.marker(latLng, { icon: driverIcon() }).addTo(maps);
    } else {
        driverMarker.setLatLng(latLng);
    }
    currentDriverPosition = latLng;
}

function fitMapToDriverAndWarehouse() {
    if (!warehouseMarker || !currentDriverPosition) return;

    maps.fitBounds(
        L.latLngBounds([warehouseMarker.getLatLng(), currentDriverPosition]),
        { padding: [40, 120] } // extra bottom padding so the tracking sheet doesn't cover the pins
    );
}

// Reverse-geocodes the pickup/warehouse point into a short readable address
// for the "Pickup" line in the tracking sheet.
async function reverseGeocodePickup(lat, lng) {
    const pickupAddressEl = document.getElementById("pickupAddress");
    if (!pickupAddressEl) return;

    try {
        const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`
        );
        const data = await res.json();
        const addr = data.address || {};

        const readable = [addr.road, addr.suburb || addr.neighbourhood, addr.city || addr.town]
            .filter(Boolean)
            .join(", ");

        pickupAddressEl.textContent = readable || data.display_name || "Restaurant location";
    } catch (e) {
        pickupAddressEl.textContent = "Restaurant location";
    }
}

// ============================================================
// TRACKING SHEET (driver info / ETA / pickup / trip details)
// ============================================================

function resetTrackingSheet() {
    const nameEl = document.getElementById("driverName");
    const subEl = document.getElementById("driverVehicle");
    const avatarEl = document.getElementById("driverAvatar");
    const callBtn = document.getElementById("callDriverBtn");
    const statusEl = document.getElementById("trackingStatusText");
    const etaEl = document.getElementById("etaMinutes");
    const pickupEl = document.getElementById("pickupAddress");
    const panel = document.getElementById("tripDetailsPanel");
    const detailsBtn = document.getElementById("tripDetailsBtn");

    if (nameEl) nameEl.textContent = "Your delivery partner";
    if (subEl) subEl.textContent = "";
    if (avatarEl) avatarEl.src = "../static/driver-placeholder.png";
    // if (callBtn) callBtn.style.display = "none";
    if (statusEl) statusEl.textContent = "Driver is on the way";
    if (etaEl) etaEl.textContent = "--";
    if (pickupEl) pickupEl.textContent = "Locating pickup point...";
    if (panel) { panel.classList.remove("show"); panel.innerHTML = ""; }
    if (detailsBtn) { detailsBtn.classList.remove("active"); detailsBtn.textContent = "Trip Details"; }
}

// `meta` is best-effort: driver_assigned / order data may not carry a
// name/phone/vehicle yet. The sheet degrades gracefully when they're absent
// (generic "Your delivery partner" label, call button hidden). Wire these
// through from the backend (driver_name, driver_phone, vehicle_no) whenever
// that data becomes available and this'll pick it up automatically.
function populateTrackingSheet(orderId, meta = {}) {
    resetTrackingSheet();

    const nameEl = document.getElementById("driverName");
    const subEl = document.getElementById("driverVehicle");
    const avatarEl = document.getElementById("driverAvatar");
    const callBtn = document.getElementById("callDriverBtn");

    if (meta.driverName && nameEl) nameEl.textContent = meta.driverName;
    if (meta.vehicleNo && subEl) subEl.textContent = meta.vehicleNo;
    if (meta.driverPhoto && avatarEl) avatarEl.src = meta.driverPhoto;

    if (meta.driverPhone && callBtn) {
        console.log(meta.driverPhone);
        
        callBtn.href = `tel:${meta.driverPhone}`;
        callBtn.style.display = "flex";
    }

    renderTripDetails(orderId);
}

function updateEtaDisplay(durationSeconds) {
    const etaEl = document.getElementById("etaMinutes");
    if (!etaEl || durationSeconds == null || !Number.isFinite(durationSeconds)) return;

    const mins = Math.max(1, Math.round(durationSeconds / 60));
    etaEl.textContent = `${mins} min${mins === 1 ? "" : "s"}`;
}

function renderTripDetails(orderId) {
    const panel = document.getElementById("tripDetailsPanel");
    if (!panel) return;

    const cached = sessionStorage.getItem(`cachedOrders_${currentUserId()}`);
    if (!cached) { panel.innerHTML = ""; return; }

    try {
        const orders = JSON.parse(cached);
        const order = orders.find(o => String(o.order_id) === String(orderId));
        if (!order) { panel.innerHTML = ""; return; }

        const cart = order.items?.items || order.items || {};
        let total = 0;
        let itemsHTML = "";

        Object.entries(cart).forEach(([itemId, item]) => {
            const price = Number(item.price) || 0;
            const qty = Number(item.qty) || 0;
            total += price * qty;

            itemsHTML += `
                <div class="item">
                    <span>${escapeHtml(item.name)} x ${qty}</span>
                    <span>₹${price * qty}</span>
                </div>
            `;
        });

        if (typeof order.items?.total === "number") total = order.items.total;
        else if (typeof order.total === "number") total = order.total;

        panel.innerHTML = `${itemsHTML}<div class="total">Total: ₹${total}</div>`;
    } catch (e) {
        console.warn("Failed to render trip details:", e);
        panel.innerHTML = "";
    }
}

// Shared entry point used both by the "driver_assigned" inline Track button
// and by the delegated click handler on already-rendered cards.
async function beginTracking(orderId, warehouseCoords, driverCoords, meta = {}) {
    console.log("beginning to track");
    
    trackingOrderId = orderId;
    log("Tracking order:", trackingOrderId);

    socket.emit("track_order", { order_id: trackingOrderId });

    const mapBlock = document.getElementById("map-block");
    if (mapBlock) mapBlock.classList.add("active");

    populateTrackingSheet(orderId, meta);

    ensureMapInitialized();

    const warehouseLatLng = extractLatLng(warehouseCoords);
    setWarehouseMarker(warehouseLatLng);

    if (!driverRouteLine) {
        driverRouteLine = L.polyline([], { color: "#FF5D2E", weight: 5, opacity: 0.85 }).addTo(maps);
    }

    if (currentDriverPosition) {
        await updateDriverRoute(currentDriverPosition.lat, currentDriverPosition.lng);
        fitMapToDriverAndWarehouse();
        return;
    }

    const driverLatLng = extractLatLng(driverCoords);
    if (!driverLatLng) return;

    setOrCreateDriverMarker(driverLatLng);
    await updateDriverRoute(driverLatLng.lat, driverLatLng.lng, { force: true });
    fitMapToDriverAndWarehouse();
}

// ============================================================
// DRIVER ASSIGNED
// ============================================================

socket.on("driver_assigned", (data) => {
    log("Driver assigned:", data.order_id, data);

    const ordersList = document.getElementById("orders-list");
    const cards = document.querySelectorAll(".order-card");

    cards.forEach(card => {
        const orderIdEl = card.querySelector(".order-id");
        if (!orderIdEl) return;

        const orderId = orderIdEl.textContent.replace("#", "").trim();
        if (orderId !== String(data.order_id)) return;

        // Move card to top
        ordersList.prepend(card);

        // Visual indication
        card.style.transition = "background-color 0.3s";
        card.style.backgroundColor = "#fff8e1";

        const status = card.querySelector(".order-header .order-status");
        if (status) {
            status.textContent = "Driver is Arriving...";
            status.style.backgroundColor = "#25a140";
            status.style.color = "blanchedalmond";
        }

        // Hide cancel button
        const cancelBtn = card.querySelector("#controlBtn .cancelBtn");
        if (cancelBtn) cancelBtn.style.display = "none";

        // Prevent duplicate Track buttons
        if (card.querySelector(".TrackOrderBtn")) return;

        const trackBtn = document.createElement("button");
        trackBtn.className = "TrackOrderBtn statusBtn";
        trackBtn.textContent = "Track Driver";
        trackBtn.style.cssText = `
            opacity: 1;
            cursor: pointer;
            visibility: visible;
            display: inline-block;
        `;

        const controlBtn = card.querySelector("#controlBtn");
        if (controlBtn) controlBtn.appendChild(trackBtn);

        trackBtn.addEventListener("click", () => {
            beginTracking(orderId, data.warehouse_coords, data.driver_coords, {
                driverName: data.driver_name,
                // driverPhone: data.driver_phone,
                vehicleNo: data.vehicle_no,
                driverPhoto: data.driver_photo,
                driverPhone: data.driver_number
            });
        });

        // Reset card highlight
        setTimeout(() => {
            card.style.backgroundColor = "";
        }, 2000);
    });
});

// ============================================================
// DRIVER LOCATION
// ============================================================

socket.on("update_driver_location", async (data) => {
    log("Received new location:", data);

    // Ignore updates for another order
    if (trackingOrderId && String(data.order_id) !== String(trackingOrderId)) {
        return;
    }

    if(data.msg){
        let driver_status_text=document.getElementById("trackingStatusText")
        driver_status_text.textContent=data.msg
    }
    const newPosition = extractLatLng({ lat: data.lat, lng: data.lng });
    if (!newPosition) return;

    // First driver location for this tracking session
    if (!driverMarker) {
        driverMarker = L.marker(newPosition, { icon: driverIcon() }).addTo(maps);
        currentDriverPosition = newPosition;

        if (warehouseMarker) {
            await updateDriverRoute(newPosition.lat, newPosition.lng, { force: true });
            fitMapToDriverAndWarehouse();
        }
        return;
    }
    // Smooth movement to the new spot, then trim/recompute the route.
    animateDriverMarker(currentDriverPosition, newPosition);
    currentDriverPosition = newPosition;
    await updateDriverRoute(newPosition.lat, newPosition.lng);
});

// ============================================================
// SMOOTH MARKER ANIMATION
// ============================================================

function animateDriverMarker(from, to) {
    if (!from) {
        driverMarker.setLatLng(to);
        return;
    }

    if (animationFrame) cancelAnimationFrame(animationFrame);

    const startTime = performance.now();
    const duration = 2500;

    function animate(now) {
        const progress = Math.min((now - startTime) / duration, 1);

        const eased = progress < 0.5
            ? 2 * progress * progress
            : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const lat = from.lat + (to.lat - from.lat) * eased;
        const lng = from.lng + (to.lng - from.lng) * eased;

        driverMarker.setLatLng([lat, lng]);

        if (progress < 1) {
            animationFrame = requestAnimationFrame(animate);
        }
    }

    animationFrame = requestAnimationFrame(animate);
}

// ============================================================
// ROUTE GEOMETRY: trim covered path, reroute on deviation
// ============================================================

// Finds the closest point on the current route polyline to the driver's
// live position. Returns both the distance (meters) and its index, so the
// caller can decide whether to just trim or to fetch a brand new route.
function closestPointOnRoute(driverLatLng, routeCoords) {
    let minDist = Infinity;
    let minIndex = 0;

    routeCoords.forEach(([lat, lng], idx) => {
        const dist = driverLatLng.distanceTo(L.latLng(lat, lng));
        if (dist < minDist) {
            minDist = dist;
            minIndex = idx;
        }
    });

    return { minDist, minIndex };
}

async function fetchOsrmRoute(driverLat, driverLng, warehouseLatVal, warehouseLngVal) {
    const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${driverLng},${driverLat};${warehouseLngVal},${warehouseLatVal}` +
        `?overview=full&geometries=geojson`;

    const response = await fetch(url);
    const result = await response.json();

    if (!result.routes || !result.routes.length) {
        console.error("No OSRM route found");
        return null;
    }

    const route = result.routes[0];

    // GeoJSON is [lng, lat] — flip to Leaflet's [lat, lng].
    return {
        coords: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
        durationSeconds: route.duration
    };
}

// Redraws the route line. If the driver is still close to the last computed
// route, this just trims off the part already covered (no network call, and
// the ETA banner is left as-is since we didn't get a fresh duration).
// If the driver has drifted past ROUTE_DEVIATION_METERS from that route —
// e.g. took a different street — it fetches a fresh OSRM route (and a fresh
// ETA) from the driver's current position. Pass { force: true } to always
// refetch (used the first time a route is drawn for a tracking session).
async function updateDriverRoute(driverLat, driverLng, { force = false } = {}) {
    if (!warehouseMarker || !driverRouteLine) return;

    const driverLatLng = L.latLng(driverLat, driverLng);

    if (!force && driverRouteCoords.length > 0) {
        const { minDist, minIndex } = closestPointOnRoute(driverLatLng, driverRouteCoords);

        if (minDist <= ROUTE_DEVIATION_METERS) {
            // Still on the planned route — just drop the covered portion.
            driverRouteCoords = driverRouteCoords.slice(minIndex);
            driverRouteLine.setLatLngs(driverRouteCoords);
            return;
        }
        // Otherwise fall through and recompute below.
        log("Driver deviated from route by", minDist, "m — recalculating");
    }

    const warehousePos = warehouseMarker.getLatLng();

    try {
        const route = await fetchOsrmRoute(
            driverLat, driverLng,
            warehousePos.lat, warehousePos.lng
        );

        if (route) {
            driverRouteCoords = route.coords;
            driverRouteLine.setLatLngs(route.coords);
            updateEtaDisplay(route.durationSeconds);
        }
    } catch (error) {
        console.error("OSRM error:", error);
    }
}

// ============================================================
// ORDER STATUS UPDATED
// ============================================================

socket.on("order_status_updated", (data) => {
    const orderCards = document.querySelectorAll(".order-card");

    orderCards.forEach(card => {
        const tokenEl = card.querySelector(".token-no");
        if (!tokenEl) return;

        const tokenNo = tokenEl.textContent.split(": ")[1]?.trim();
        if (tokenNo !== `${data.token_no}`) return;

        const statusSpan = card.querySelector(".order-status");
        if (!statusSpan) return;

        statusSpan.textContent = data.status;
        statusSpan.className = `order-status status-${data.status}`;
    });

    // Keep cache in sync
    const uid = currentUserId();
    const cacheKey = `cachedOrders_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);

    if (cached) {
        try {
            const orders = JSON.parse(cached);
            const order = orders.find(o =>
                `#${o.order_id}` === data.order_id ||
                `${o.order_id}` === String(data.order_id).replace("#", "")
            );

            if (order) order.status = data.status;

            sessionStorage.setItem(cacheKey, JSON.stringify(orders));
        } catch (e) {
            console.warn("Failed to update cached orders:", e);
        }
    }
});

// ============================================================
// RENDER ORDERS
// ============================================================

function renderOrders(orders, ordersList, no_order_container) {
    if (!orders || orders.length === 0) {
        no_order_container.classList.add("show");
        ordersList.innerHTML = "";
        return;
    }

    no_order_container.classList.remove("show");

    const html = orders.map(order => {
        const cart = order.items?.items || order.items || {};

        let total = 0;
        let itemsHTML = "";

        Object.entries(cart).forEach(([itemId, item]) => {
            const price = Number(item.price) || 0;
            const qty = Number(item.qty) || 0;
            const itemTotal = price * qty;
            total += itemTotal;

            itemsHTML += `
                <div class="item" item_id="${escapeHtml(itemId)}">
                    <span>${escapeHtml(item.name)} x ${qty}</span>
                    <span>₹${itemTotal}</span>
                </div>
            `;
        });

        if (typeof order.items?.total === "number") {
            total = order.items.total;
        } else if (typeof order.total === "number") {
            total = order.total;
        }

        const orderStatus = (order.status || "").toLowerCase();
        const deliveryStatus = (order.delivery_status || "").toLowerCase();
        const isFinalOrder = orderStatus === "completed" || orderStatus === "canceled";

        // Prefer an explicit delivery_status when the backend sends one.
        // If it doesn't (or spells it differently), fall back to "does this
        // order actually have real driver coordinates" as the signal that a
        // driver has been assigned and tracking is possible.
        const wLat = safeNumberAttr(order.warehouse_coords?.latt ?? order.warehouse_coords?.lat);
        const wLng = safeNumberAttr(order.warehouse_coords?.long ?? order.warehouse_coords?.lng);
        const dLat = safeNumberAttr(order.driver_coords?.latt ?? order.driver_coords?.lat);
        const dLng = safeNumberAttr(order.driver_coords?.long ?? order.driver_coords?.lng);
        const hasDriverCoords = Boolean(dLat) && Boolean(dLng);

        const driverAssigned = deliveryStatus
            ? (deliveryStatus !== "searching" && deliveryStatus !== "delivered")
            : hasDriverCoords;

        let controlBtnHTML = "";

        if (!isFinalOrder && driverAssigned) {
            controlBtnHTML = `
                <button
                    class="TrackOrderBtn statusBtn"
                    style="opacity: 1; cursor: pointer; visibility: visible; display: inline-block;"
                    data-warehouse_lat="${wLat}"
                    data-warehouse_lng="${wLng}"
                    data-driver_lat="${dLat}"
                    data-driver_lng="${dLng}"
                    data-driver_name="${escapeHtml(order.driver_name || "")}"
                    data-driver_phone="${escapeHtml(order.driver_phone || "")}"
                    data-vehicle_no="${escapeHtml(order.vehicle_no || "")}"
                >Track Driver</button>
            `;
        } else if (!isFinalOrder) {
            // No driver yet (still searching/placed) — order can still be cancelled.
            controlBtnHTML = `
                <button
                    class="cancelBtn"
                    style="background: red; color: white; padding: 5px 11px; border-radius: 7px; border: none;"
                >Cancel Order</button>
            `;
        }
        // else: completed/canceled orders get no action button at all.

        return `
            <div class="order-card">
                <div class="order-header">
                    <span class="order-id">#${escapeHtml(order.order_id)}</span>
                    <span class="order-status status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
                </div>

                <div class="token-no">Token No: ${escapeHtml(order.token_no)}</div>
                <div class="order-date">${escapeHtml(order.date)}</div>

                ${itemsHTML}

                <div class="total">Total: ₹${total}</div>

                <div id="controlBtn">
                    ${controlBtnHTML}
                </div>
            </div>
        `;
    }).join("");

    ordersList.innerHTML = html;
}

// ============================================================
// FILTER (pill tabs)
// ============================================================

function applyFilterFor(filterValue, no_order_container) {
    no_order_container.classList.remove("show");

    const cards = document.querySelectorAll(".order-card");
    let visibleCards = 0;
    const wanted = (filterValue || "all").toLowerCase();

    cards.forEach(card => {
        const statusEl = card.querySelector(".order-status");
        const statusText = statusEl ? statusEl.textContent.trim().toLowerCase() : "";

        if (wanted === "all" || statusText === wanted) {
            card.style.display = "block";
            visibleCards++;
        } else {
            card.style.display = "none";
        }
    });

    no_order_container.classList.toggle("show", visibleCards === 0);
}

// ============================================================
// LOAD ORDERS
// ============================================================

async function loadOrders(userId, { background = false } = {}) {
    const ordersList = document.getElementById("orders-list");
    const no_order_container = document.getElementById("No_orders_container");

    if (!ordersList) return;

    const cacheKey = `cachedOrders_${userId}`;

    if (!background) {
        const cached = sessionStorage.getItem(cacheKey);

        if (cached) {
            try {
                renderOrders(JSON.parse(cached), ordersList, no_order_container);
            } catch (e) {
                console.warn("bad orders cache, ignoring", e);
            }
        }
    }

    const res = await fetch(`/get_orders/${userId}`, { method: "POST" });

    if (res.status === 401) {
        alert("Unauthorized. Please log in.");
        window.location.href = "/login/user";
        return;
    }

    const data = await res.json();
    console.log(data);
    
    if (!data.success) {
        if (!sessionStorage.getItem(cacheKey)) {
            ordersList.innerHTML = "<p>Error loading orders</p>";
        }
        return;
    }

    // Prevent adding another "connect" listener every time loadOrders() runs.
    if (!socket.connected) {
        socket.once("connect", () => {
            log("Connected:", socket.id);

            if (data.orders && data.orders.length) {
                const order_id = data.orders[data.orders.length - 1].order_id;
                socket.emit("join_user_room", { order_id });
            }
        });

        socket.connect();
    } else if (data.orders && data.orders.length) {
        const order_id = data.orders[data.orders.length - 1].order_id;
        socket.emit("join_user_room", { order_id });
    }

    sessionStorage.setItem(cacheKey, JSON.stringify(data.orders || []));
    renderOrders(data.orders, ordersList, no_order_container);
}

// ============================================================
// INIT ORDERS PAGE
// ============================================================

function initOrdersPage() {
    const ordersList = document.getElementById("orders-list");
    if (!ordersList) return;

    const userId = currentUserId();
    const no_order_container = document.getElementById("No_orders_container");
    const activeFilter =
        document.querySelector(".filter-tab.active")?.dataset.filter || "all";

    loadOrders(userId).then(() =>
        applyFilterFor(activeFilter, no_order_container)
    );
}

// ============================================================
// GLOBAL DELEGATED CLICK HANDLER
//
// Bound ONCE to `document` (not to #orders-list / #tripDetailsBtn /
// #backBtn directly). A listener attached to a specific node stops
// working the moment that node is removed or replaced — which is
// exactly what happens if the SPA router ever re-renders the markup
// inside #spa-content after initOrdersPage() already ran once (the
// visible button on screen would then be a brand-new element with no
// listener on it at all: clicks on it would silently do nothing,
// which matches "nothing happens on refresh" exactly).
//
// `document` itself is never replaced, so matching with
// e.target.closest(...) at click time is safe regardless of how many
// times the page content underneath gets swapped out.
// ============================================================

document.addEventListener("click", async (e) => {

    // ---- Filter tabs ----
    const filterTab = e.target.closest(".filter-tab");
    if (filterTab) {
        const no_order_container = document.getElementById("No_orders_container");

        document.querySelectorAll(".filter-tab").forEach(t => {
            t.classList.remove("active");
            t.setAttribute("aria-selected", "false");
        });
        filterTab.classList.add("active");
        filterTab.setAttribute("aria-selected", "true");

        if (no_order_container) applyFilterFor(filterTab.dataset.filter, no_order_container);
        return;
    }

    // ---- Cancel order ----
    const cancelBtn = e.target.closest(".cancelBtn");
    if (cancelBtn) {
        const card = cancelBtn.closest(".order-card");
        if (!card) return;

        const userId = currentUserId();
        const orderId = card.querySelector(".order-id").textContent.replace("#", "").trim();
        const tokenNo = card.querySelector(".token-no").textContent.split(": ")[1];

        const res = await fetch("/update_order_user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id: orderId, status: "canceled", user_id: userId })
        });

        const data = await res.json();

        if (data.success) {
            socket.emit("user_cancelled_order", {
                order_id: orderId,
                token_no: tokenNo,
                user_id: userId,
                status: "canceled"
            });

            const statusSpan = card.querySelector(".order-status");
            if (statusSpan) {
                statusSpan.textContent = "canceled";
                statusSpan.className = "order-status status-canceled";
            }
            cancelBtn.style.display = "none";

            const no_order_container = document.getElementById("No_orders_container");
            const activeFilter =
                document.querySelector(".filter-tab.active")?.dataset.filter || "all";

            await loadOrders(userId, { background: true });
            if (no_order_container) applyFilterFor(activeFilter, no_order_container);
        } else {
            alert("Failed to update order status. Please try again.");
        }
        return;
    }

    // ---- Track driver ----
    const trackBtn = e.target.closest(".TrackOrderBtn");
    if (trackBtn) {
        const card = trackBtn.closest(".order-card");
        if (!card) return;

        const orderIdEl = card.querySelector(".order-header .order-id") || card.querySelector(".order-id");
        if (!orderIdEl) return;
        console.log("After rturn");
        
        const orderId = orderIdEl.textContent.replace("#", "").trim();

        const warehouseCoords = {
            lat: trackBtn.dataset.warehouse_lat,
            lng: trackBtn.dataset.warehouse_lng
        };
        const driverCoords = {
            lat: trackBtn.dataset.driver_lat,
            lng: trackBtn.dataset.driver_lng
        };

        await beginTracking(orderId, warehouseCoords, driverCoords, {
            driverName: trackBtn.dataset.driver_name,
            driverPhone: trackBtn.dataset.driver_phone,
            vehicleNo: trackBtn.dataset.vehicle_no
        });
        return;
    }

    // ---- Trip details toggle (inside the tracking sheet) ----
    const tripDetailsBtn = e.target.closest("#tripDetailsBtn");
    if (tripDetailsBtn) {
        const panel = document.getElementById("tripDetailsPanel");
        if (!panel) return;

        const isShowing = panel.classList.toggle("show");
        tripDetailsBtn.classList.toggle("active", isShowing);
        tripDetailsBtn.textContent = isShowing ? "Hide Details" : "Trip Details";
        return;
    }

    // ---- Call Driver (inside the tracking sheet) ----
    const callDriver = e.target.closest("#callDriverBtn");
    if (callDriver) {
        const panel = document.getElementById("tripDetailsPanel");
        if (!panel) return;

        const isShowing = panel.classList.toggle("show");
        tripDetailsBtn.classList.toggle("active", isShowing);
        tripDetailsBtn.textContent = isShowing ? "Hide Details" : "Trip Details";
        return;
    }

    // ---- Back button (close tracking map) ----
    const backBtnEl = e.target.closest("#backBtn");
    if (backBtnEl) {
        const mapBlock = document.getElementById("map-block");
        if (mapBlock) mapBlock.classList.remove("active");
        resetTrackingSheet();
        return;
    }
});

// ============================================================
// INITIAL LOAD
// ============================================================

initOrdersPage();

// ============================================================
// SPA NAVIGATION
// ============================================================

document.addEventListener("spa:pageload", (e) => {
    if (e.detail.page === "orders") {
        initOrdersPage();
    }
});

// document.getElementById("searchInput").style.display="none"