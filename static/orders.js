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
// let map = null;

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

// ============================================================
// MAP HELPERS (shared between the two tracking entry points)
// ============================================================

function ensureMapInitialized() {
    // BUG FIX: this used to be `if (map)`, which only created the map
    // when one already existed (i.e. never, on first load) and would
    // silently blow away an existing map + markers on later calls.
    if (!map) {
        map = L.map("map");

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            { attribution: "© OpenStreetMap contributors" }
        ).addTo(map);
    }

    setTimeout(() => {
        if (map) map.invalidateSize();
    }, 300);
}

function setWarehouseMarker(latLng) {
    if (!latLng) return;

    warehouseLat = latLng.lat;
    warehouseLng = latLng.lng;

    if (!warehouseMarker) {
        warehouseMarker = L.marker(latLng).addTo(map).bindPopup("Warehouse");
    } else {
        warehouseMarker.setLatLng(latLng);
    }
}

function setOrCreateDriverMarker(latLng) {
    if (!driverMarker) {
        driverMarker = L.marker(latLng).addTo(map).bindPopup("Driver");
    } else {
        driverMarker.setLatLng(latLng);
    }
    currentDriverPosition = latLng;
}

function fitMapToDriverAndWarehouse() {
    if (!warehouseMarker || !currentDriverPosition) return;

    map.fitBounds(
        L.latLngBounds([warehouseMarker.getLatLng(), currentDriverPosition]),
        { padding: [40, 40] }
    );
}

// Shared entry point used both by the "driver_assigned" inline Track button
// and by the delegated click handler on already-rendered cards.
async function beginTracking(orderId, warehouseCoords, driverCoords) {
    trackingOrderId = orderId;
    log("Tracking order:", trackingOrderId);

    socket.emit("track_order", { order_id: trackingOrderId });

    const mapBlock = document.getElementById("map-block");
    if (mapBlock) mapBlock.classList.add("active");

    ensureMapInitialized();

    const warehouseLatLng = extractLatLng(warehouseCoords);
    setWarehouseMarker(warehouseLatLng);

    if (!driverRouteLine) {
        driverRouteLine = L.polyline([], { weight: 5, opacity: 0.8 }).addTo(map);
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
    log("Driver assigned:", data.order_id);

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
            beginTracking(orderId, data.warehouse_coords, data.driver_coords);
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

    const newPosition = extractLatLng({ lat: data.lat, lng: data.lng });
    if (!newPosition) return;

    // First driver location for this tracking session
    if (!driverMarker) {
        driverMarker = L.marker(newPosition).addTo(map).bindPopup("Driver");
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

    // GeoJSON is [lng, lat] — flip to Leaflet's [lat, lng].
    return result.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

// Redraws the route line. If the driver is still close to the last computed
// route, this just trims off the part already covered (no network call).
// If the driver has drifted past ROUTE_DEVIATION_METERS from that route —
// e.g. took a different street — it fetches a fresh OSRM route from the
// driver's current position. Pass { force: true } to always refetch
// (used the first time a route is drawn for a tracking session).
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
        const coords = await fetchOsrmRoute(
            driverLat, driverLng,
            warehousePos.lat, warehousePos.lng
        );

        if (coords) {
            driverRouteCoords = coords;
            driverRouteLine.setLatLngs(coords);
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
    const uid = window.APP_USER_ID || window.location.pathname.split("/").pop();
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

        let controlBtnHTML;

        if (order.delivery_status !== "searching" && order.delivery_status !== "delivered") {
            const wLat = safeNumberAttr(order.warehouse_coords?.latt ?? order.warehouse_coords?.lat);
            const wLng = safeNumberAttr(order.warehouse_coords?.long ?? order.warehouse_coords?.lng);
            const dLat = safeNumberAttr(order.driver_coords?.latt ?? order.driver_coords?.lat);
            const dLng = safeNumberAttr(order.driver_coords?.long ?? order.driver_coords?.lng);

            controlBtnHTML = `
                <button
                    class="TrackOrderBtn statusBtn"
                    style="opacity: 1; cursor: pointer; visibility: visible; display: inline-block;"
                    data-warehouse_lat="${wLat}"
                    data-warehouse_lng="${wLng}"
                    data-driver_lat="${dLat}"
                    data-driver_lng="${dLng}"
                >Track Driver</button>
            `;
        } else {
            controlBtnHTML = `
                <button
                    class="cancelBtn"
                    style="background: red; color: white; padding: 5px 11px; border-radius: 7px; border: none;"
                >Cancel Order</button>
            `;
        }

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
// FILTER
// ============================================================

function applyFilterFor(filterDropdown, no_order_container) {
    no_order_container.classList.remove("show");

    const cards = document.querySelectorAll(".order-card");
    let visibleCards = 0;

    cards.forEach(card => {
        const statusEl = card.querySelector(".order-status");
        const statusText = statusEl ? statusEl.textContent.trim().toLowerCase() : "";

        if (
            filterDropdown.value.toLowerCase() === "all" ||
            statusText === filterDropdown.value.toLowerCase()
        ) {
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

    const pathParts = window.location.pathname.split("/");
    const userId = window.APP_USER_ID || pathParts[pathParts.length - 1];

    const no_order_container = document.getElementById("No_orders_container");
    const filterDropdown = document.getElementById("filterDropdown");

    filterDropdown.addEventListener("change", () =>
        applyFilterFor(filterDropdown, no_order_container)
    );

    loadOrders(userId).then(() =>
        applyFilterFor(filterDropdown, no_order_container)
    );

    ordersList.addEventListener("click", async (e) => {
        if (e.target.classList.contains("cancelBtn")) {
            const card = e.target.closest(".order-card");
            const orderId = card.querySelector(".order-id").textContent.replace("#", "").trim();
            const tokenNo = card.querySelector(".token-no").textContent.split(": ")[1];

            const res = await fetch("/update_order_user", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    order_id: orderId,
                    status: "canceled",
                    user_id: userId
                })
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
                statusSpan.textContent = "canceled";
                statusSpan.className = "order-status status-canceled";

                e.target.style.display = "none";

                await loadOrders(userId, { background: true });
                applyFilterFor(filterDropdown, no_order_container);
            } else {
                alert("Failed to update order status. Please try again.");
            }
        }

        if (e.target.classList.contains("TrackOrderBtn")) {
            const trackBtn = e.target;
            const card = e.target.closest(".order-card");

            const orderId = card
                .querySelector(".order-header")
                .querySelector(".order-id")
                .textContent
                .replace("#", "")
                .trim();

            const warehouseCoords = {
                lat: trackBtn.dataset.warehouse_lat,
                lng: trackBtn.dataset.warehouse_lng
            };
            const driverCoords = {
                lat: trackBtn.dataset.driver_lat,
                lng: trackBtn.dataset.driver_lng
            };

            await beginTracking(orderId, warehouseCoords, driverCoords);
        }
    });
}

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

// ============================================================
// BACK BUTTON
// ============================================================

const backBtn = document.getElementById("backBtn");

if (backBtn) {
    backBtn.addEventListener("click", () => {
        document.getElementById("map-block").classList.remove("active");
    });
}

document.getElementById("searchInput").style.display="none"
