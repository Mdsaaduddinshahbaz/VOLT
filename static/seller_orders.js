// --------------------------------------------------------------------------
// SECURITY NOTE (server-side, can't be fixed from this file alone):
// - "join_seller_room" / "track_order" trust whatever seller_id / order_id
//   the client sends. Verify server-side that the authenticated seller
//   actually owns that restaurant/order before joining the room or
//   streaming location data.
// - /update_order trusts a client-supplied `user_id` read straight out of a
//   DOM attribute (fully editable via devtools). Always re-derive the
//   owning user/seller from the authenticated session on the server, never
//   from a value the client hands back to you.
// --------------------------------------------------------------------------

const pathParts = window.location.pathname.split("/");

const resId = pathParts[pathParts.length - 1];
const type = pathParts[pathParts.length - 4];
const resname = pathParts[pathParts.length - 2];

const DEBUG = false; // flip to true only while debugging locally
function log(...args) {
    if (DEBUG) console.log(...args);
}

log(resId, resname, type); // BUG FIX: was `name` (undefined var / window.name), meant `resname`

const filterDropdown = document.getElementById("filterDropdown");
filterDropdown.addEventListener("change", applyFilter);

// Initial filter when the page loads
applyFilter();

function applyFilter() {
    const selected = filterDropdown.value.toLowerCase();
    const cards = document.querySelectorAll(".order-card");
    const noOrdersMessage = document.getElementById("noOrdersMessage");
    let hasVisibleCards = false;

    cards.forEach(card => {
        const statusEl = card.querySelector(".order-status");
        const statusText = statusEl ? statusEl.textContent.trim().toLowerCase() : "";
        const show = selected === "all" || statusText === selected;

        card.style.display = show ? "block" : "none";
        if (show) hasVisibleCards = true;

        const buttons = card.querySelectorAll(".statusBtn");
        const enable = selected === "placed";

        buttons.forEach(btn => {
            btn.disabled = !enable;
            btn.style.opacity = enable ? "1" : "0.5";
            btn.style.cursor = enable ? "pointer" : "not-allowed";
            btn.style.visibility = enable ? "visible" : "hidden";
            btn.style.display = enable ? "inline-block" : "none";
        });
    });

    if (hasVisibleCards) {
        noOrdersMessage.style.display = "none";
    } else {
        noOrdersMessage.style.display = "block";

        if (selected === "pending") {
            noOrdersMessage.textContent = "No pending orders.";
        } else if (selected === "completed") {
            noOrdersMessage.textContent = "No completed orders.";
        } else if (selected === "placed") {
            noOrdersMessage.textContent = "No placed orders.";
        } else {
            noOrdersMessage.textContent = "No orders found.";
        }
    }
}

const ordersList = document.getElementById("orders-list");

const socket = io();

socket.on("connect", () => {
    log("Connected:", socket.id);
    socket.emit("join_seller_room", { seller_id: resId });
});

socket.on("new_order", () => {
    log("New order received → reloading...");
    loadOrders();
});

// ============================================================
// SMALL UTILITIES (shared shape with the customer-side script)
// ============================================================

function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Coordinates show up under different key spellings depending on which
// part of the backend produced them (lat/lng, lat/long, latt/long...).
// Normalize once instead of guessing per call site.
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

function getOrderId(card) {
    return card.querySelector(".order-id")?.dataset.orderId || "";
}

// ============================================================
// DRIVER TRACKING STATE
// ============================================================

let driverMarker = null;
let map = null;
let warehouseMarker = null;
let driverRouteLine = null;
let driverRouteCoords = []; // [[lat,lng], ...] of the current OSRM route

let currentDriverPosition = null;
let animationFrame = null;

let trackingOrderId = null;
let warehouseLat = null;
let warehouseLng = null;

const ROUTE_DEVIATION_METERS = 150;

// ============================================================
// MAP HELPERS (shared between driver_assigned and TrackOrderBtn click)
// ============================================================

function ensureMapInitialized() {
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

// Shared entry point for both the inline Track button created in
// "driver_assigned" and the delegated click handler on rendered cards.
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

    const cards = document.querySelectorAll(".order-card");

    cards.forEach(card => {
        const orderId = getOrderId(card);
        if (orderId !== String(data.order_id)) return;

        // Move this card to the very top
        ordersList.prepend(card);

        card.style.transition = "background-color 0.3s";
        card.style.backgroundColor = "#fff8e1";

        const statusEl = card.querySelector(".order-header .order-status");
        if (statusEl) {
            statusEl.textContent = "Driver is Arriving...";
            statusEl.style.backgroundColor = "#25a140";
            statusEl.style.color = "blanchedalmond";
        }

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

    if (trackingOrderId && String(data.order_id) !== String(trackingOrderId)) {
        return;
    }

    const newPosition = extractLatLng({ lat: data.lat, lng: data.lng });
    if (!newPosition) return;

    if (!driverMarker) {
        driverMarker = L.marker(newPosition).addTo(map).bindPopup("Driver");
        currentDriverPosition = newPosition;

        if (warehouseMarker) {
            await updateDriverRoute(newPosition.lat, newPosition.lng, { force: true });
            fitMapToDriverAndWarehouse();
        }
        return;
    }

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

    return result.routes[0].geometry.coordinates.map(([lng, lat]) => [lat, lng]);
}

// Trims the already-covered part of the route as the driver moves; only
// hits OSRM again if the driver has drifted more than ROUTE_DEVIATION_METERS
// from the last computed route (i.e. took a different road).
async function updateDriverRoute(driverLat, driverLng, { force = false } = {}) {
    if (!warehouseMarker || !driverRouteLine) return;

    const driverLatLng = L.latLng(driverLat, driverLng);

    if (!force && driverRouteCoords.length > 0) {
        const { minDist, minIndex } = closestPointOnRoute(driverLatLng, driverRouteCoords);

        if (minDist <= ROUTE_DEVIATION_METERS) {
            driverRouteCoords = driverRouteCoords.slice(minIndex);
            driverRouteLine.setLatLngs(driverRouteCoords);
            return;
        }
        log("Driver deviated from route by", minDist, "m — recalculating");
    }

    const warehousePosition = warehouseMarker.getLatLng();

    try {
        const coords = await fetchOsrmRoute(
            driverLat, driverLng,
            warehousePosition.lat, warehousePosition.lng
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
// USER CANCELLED ORDER
// ============================================================

socket.on("seller_order_cancelled", (data) => {
    log("User cancelled order:", data);

    const cards = document.querySelectorAll(".order-card");

    cards.forEach(card => {
        const tokenEl = card.querySelector(".token-no");
        if (!tokenEl) return;

        const cardToken = tokenEl.textContent.split(": ")[1]?.trim();

        // BUG FIX: the old code updated every card's status text/class
        // unconditionally, then only checked the token match afterwards —
        // so cancelling one order visually "cancelled" every visible card.
        // Now the match check gates everything.
        if (String(cardToken).trim() !== String(data.token_no).trim()) return;

        const statusSpan = card.querySelector(".order-header .order-status");
        if (statusSpan) {
            statusSpan.textContent = data.status;
            statusSpan.className = `order-status status-${data.status}`;
        }

        card.style.backgroundColor = "#ffebee";
        setTimeout(() => card.remove(), 1500);
    });
});

// ============================================================
// LOAD ORDERS
// ============================================================

async function loadOrders() {
    const res = await fetch(`/seller/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ res_id: resId })
    });

    if (res.status === 401) {
        alert("Unauthorized. Please log in.");
        window.location.href = "/login/seller";
        return;
    }

    const data = await res.json();

    if (!data.success) {
        ordersList.innerHTML = `<p>Error loading orders - ${escapeHtml(data.message)}</p>`;
        return;
    }

    const htmlParts = [];
    let activeOrders = 0;

    data.orders.forEach(order => {
        let total = 0;
        let itemsHTML = "";

        Object.entries(order.items).forEach(([itemName, detail]) => {
            const price = Number(detail.price) || 0;
            const qty = Number(detail.qty) || 0;
            const itemTotal = price * qty;
            total += itemTotal;

            itemsHTML += `
                <div class="item" data-item-id="${escapeHtml(itemName)}">
                    <span>${escapeHtml(detail.name)} x ${qty}</span>
                    <span>₹${itemTotal}</span>
                </div>`;
        });

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
                >Track Driver</button>`;
        } else {
            controlBtnHTML = `
                <button class="cancelBtn statusBtn" style="
                    background: red;
                    color: white;
                    padding: 5px 11px;
                    border-radius: 7px;
                    border: none;
                    cursor: pointer;
                ">Cancel Order</button>`;
        }

        htmlParts.push(`
            <div class="order-card" data-user-id="${escapeHtml(order.user_id)}">
                <div class="order-header">
                    <span class="order-id" data-order-id="${escapeHtml(order.order_id)}">#${escapeHtml(order.order_id)}</span>
                    <span class="order-status status-${escapeHtml(order.status)}">${escapeHtml(order.status)}</span>
                </div>
                <div class="token-no">Token No: ${escapeHtml(order.token_no)}</div>
                <div class="order-date">${escapeHtml(order.time)}</div>
                ${itemsHTML}
                <div class="total">Total: ₹${total}</div>
                <div id="controlBtn">
                    <button class="completeBtn statusBtn" style="
                        background: green;
                        color: white;
                        padding: 5px 11px;
                        border-radius: 7px;
                        border: none;
                        cursor: pointer;
                    ">Completed</button>
                    ${controlBtnHTML}
                </div>
            </div>
        `);

        if (order.status === "placed") activeOrders++;
    });

    ordersList.innerHTML = htmlParts.join("");
    document.getElementById("active_orders").textContent = activeOrders;
    applyFilter();
}

loadOrders();

// ============================================================
// GLOBAL CLICK HANDLER
// ============================================================

document.addEventListener("click", async (e) => {

    if (e.target.classList.contains("completeBtn")) {
        const card = e.target.closest(".order-card");
        const orderId = getOrderId(card);
        const tokenNo = card.querySelector(".token-no").textContent.split(": ")[1];
        const userId = card.dataset.userId;

        const res = await fetch("/update_order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                order_id: orderId,
                status: "completed",
                user_id: userId
            })
        });

        const data = await res.json();

        if (data.success) {
            socket.emit("order_completed", {
                order_id: orderId,
                userid: userId,
                token_no: tokenNo,
                res_id: resId,
                status: "completed"
            });

            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "completed";
            statusSpan.className = "order-status status-completed";

            card.remove();
        } else {
            alert("Failed to update order status. Please try again.");
        }
    }

    if (e.target.classList.contains("cancelBtn")) {
        const card = e.target.closest(".order-card");
        const orderId = getOrderId(card);
        const tokenNo = card.querySelector(".token-no").textContent.split(": ")[1];
        const userId = card.dataset.userId;

        const res = await fetch("/update_order", {
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
            socket.emit("order_completed", {
                order_id: orderId,
                userid: userId,
                token_no: tokenNo,
                res_id: resId,
                status: "canceled"
            });

            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "canceled";
            statusSpan.className = "order-status status-canceled";

            card.remove();
        } else {
            alert("Failed to update order status. Please try again.");
        }
    }

    if (e.target.classList.contains("TrackOrderBtn")) {
        const trackBtn = e.target;
        const card = e.target.closest(".order-card");
        const orderId = getOrderId(card);

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

const backBtnEl = document.getElementById("backBtn");
if (backBtnEl) {
    backBtnEl.addEventListener("click", () => {
        document.getElementById("map-block").classList.remove("active");
    });
}

// ============================================================
// SIDEBAR TOGGLE
// ============================================================

const overlay = document.querySelector(".overlay");
const sidebar = document.querySelector(".sidebar");

const menuToggle = document.getElementById("menuToggle");
if (menuToggle && sidebar && overlay) {
    menuToggle.onclick = function () {
        sidebar.classList.add("show");
        sidebar.style.display = "block";
        overlay.classList.add("show");
    };
}

const hideCategoryBtn = document.getElementById("hideCategoryBtn");
if (hideCategoryBtn && sidebar && overlay) {
    hideCategoryBtn.addEventListener("click", function () {
        sidebar.style.display = "none";
        overlay.classList.remove("show");
    });
}

if (overlay && sidebar) {
    overlay.addEventListener("click", () => {
        overlay.classList.remove("show");
        sidebar.style.display = "none";
        sidebar.classList.remove("show");
    });
}