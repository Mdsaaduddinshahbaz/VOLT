const pathParts = window.location.pathname.split("/");

const resId = pathParts[pathParts.length - 1];
const type = pathParts[pathParts.length - 4];
const resname = pathParts[pathParts.length - 2]
console.log(resId, name, type);
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
        const statusText = card.querySelector(".order-status")
            .textContent
            .trim()
            .toLowerCase();
        const show = selected === "all" || statusText === selected;

        card.style.display = show ? "block" : "none";

        if (show) {
            hasVisibleCards = true;
        }
        const buttons = card.querySelectorAll(".statusBtn");

        card.style.display = show ? "block" : "none";

        buttons.forEach(btn => {
            const enable = selected === "placed";
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

console.log(resId)
const socket = io();

socket.on("connect", () => {
    console.log("Connected:", socket.id);

    socket.emit("join_seller_room", {
        seller_id: resId
    });
});
socket.on("new_order", () => {
    console.log("New order received → reloading...");
    loadOrders();   // 🔥 call your API again
});

// ============================================================
// DRIVER TRACKING VARIABLES
// ============================================================

let driverMarker = null;
let map = null
let warehouseMarker = null;
let driverRouteLine = null;

let currentDriverPosition = null;
let animationFrame = null;

let trackingOrderId = null;
let warehouseLat = null;
let warehouseLng = null;

// ============================================================
// DRIVER ASSIGNED
// ============================================================

socket.on("driver_assigned", (data) => {
    console.log("Driver assigned:", data.order_id);

    const cards = document.querySelectorAll(".order-card");

    cards.forEach(card => {
        const orderId = card
            .querySelector(".order-id")
            .getAttribute("id")

        if (orderId !== String(data.order_id)) {
            return;
        }

        // Move this card to the very top
        ordersList.prepend(card);

        // Optional: make it visually noticeable
        card.style.transition = "background-color 0.3s";
        card.style.backgroundColor = "#fff8e1";
        card.querySelector(".order-header .order-status").textContent = "Driver is Arriving...";
        card.querySelector(".order-header .order-status").style.backgroundColor = "#25a140";
        card.querySelector(".order-header .order-status").style.color = "blanchedalmond";

        const cancelBtn = card.querySelector("#controlBtn .cancelBtn");
        console.log(cancelBtn);

        if (cancelBtn) {
            cancelBtn.style.display = "none";
        }

        // Prevent duplicate Track buttons
        if (card.querySelector(".TrackOrderBtn")) {
            return;
        }

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
        if (controlBtn) {
            controlBtn.appendChild(trackBtn);
        }

        // ====================================================
        // TRACK DRIVER CLICK
        // ====================================================

        trackBtn.addEventListener("click", async () => {
            const orderid = card
                .querySelector(".order-id").getAttribute("id")

            trackingOrderId = orderid;

            console.log("Tracking order:", trackingOrderId);

            socket.emit("track_order", { order_id: trackingOrderId });

            // Show map
            document.getElementById("map-block").classList.add("active");

            // ------------------------------------------------
            // Warehouse coordinates
            // ------------------------------------------------
            const warehouseLoc = data.warehouse_coords;

            warehouseLat = Number(warehouseLoc.lat);
            warehouseLng = Number(warehouseLoc.long);

            // ------------------------------------------------
            // Initialize map only once
            // ------------------------------------------------
            if (!map) {
                map = L.map("map");

                L.tileLayer(
                    "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                    { attribution: "© OpenStreetMap contributors" }
                ).addTo(map);
            }

            // ------------------------------------------------
            // Warehouse marker
            // ------------------------------------------------
            if (!warehouseMarker) {
                warehouseMarker = L.marker([warehouseLat, warehouseLng])
                    .addTo(map)
                    .bindPopup("Warehouse");
            } else {
                warehouseMarker.setLatLng([warehouseLat, warehouseLng]);
            }

            // ------------------------------------------------
            // Route line
            // ------------------------------------------------
            if (!driverRouteLine) {
                driverRouteLine = L.polyline([], {
                    weight: 5,
                    opacity: 0.8
                }).addTo(map);
            }

            // ------------------------------------------------
            // Resize map
            // ------------------------------------------------
            setTimeout(() => {
                map.invalidateSize();
            }, 300);

            // ------------------------------------------------
            // Existing driver location
            // ------------------------------------------------
            if (currentDriverPosition) {

                await updateDriverRoute(
                    currentDriverPosition.lat,
                    currentDriverPosition.lng
                );

                map.fitBounds(
                    L.latLngBounds([
                        warehouseMarker.getLatLng(),
                        currentDriverPosition
                    ]),
                    { padding: [40, 40] }
                );

            } else {

                const driverLoc = data.driver_coords;
                const latt = Number(driverLoc.latt);
                const long = Number(driverLoc.long);

                currentDriverPosition = L.latLng(latt, long);

                await updateDriverRoute(latt, long);

                driverMarker = L.marker([latt, long])
                    .addTo(map)
                    .bindPopup("Driver");

                map.fitBounds(
                    L.latLngBounds([
                        warehouseMarker.getLatLng(),
                        currentDriverPosition
                    ]),
                    { padding: [40, 40] }
                );
            }
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
    console.log("Received new location:", data);

    // Ignore updates for another order
    if (trackingOrderId && String(data.order_id) !== String(trackingOrderId)) {
        return;
    }

    const lat = Number(data.lat);
    const lng = Number(data.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        console.error("Invalid driver coordinates:", data);
        return;
    }

    const newPosition = L.latLng(lat, lng);

    // ========================================================
    // FIRST DRIVER LOCATION
    // ========================================================
    if (!driverMarker) {

        driverMarker = L.marker([lat, lng])
            .addTo(map)
            .bindPopup("Driver");

        currentDriverPosition = newPosition;

        if (warehouseMarker) {

            await updateDriverRoute(lat, lng);

            map.fitBounds(
                L.latLngBounds([warehouseMarker.getLatLng(), newPosition]),
                { padding: [40, 40] }
            );
        }

        return;
    }

    // ========================================================
    // SMOOTH DRIVER MOVEMENT
    // ========================================================
    animateDriverMarker(currentDriverPosition, newPosition);

    currentDriverPosition = newPosition;
});

// ============================================================
// SMOOTH MARKER ANIMATION
// ============================================================

function animateDriverMarker(from, to) {

    if (!from) {
        driverMarker.setLatLng(to);
        return;
    }

    if (animationFrame) {
        cancelAnimationFrame(animationFrame);
    }

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
// OSRM ROUTING
// ============================================================

async function updateDriverRoute(driverLat, driverLng) {

    if (!warehouseMarker) {
        return;
    }
    console.log("in update route");
    
    const warehousePosition = warehouseMarker.getLatLng();

    const warehouseLatVal = warehousePosition.lat;
    const warehouseLngVal = warehousePosition.lng;

    const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${driverLng},${driverLat};` +
        `${warehouseLngVal},${warehouseLatVal}` +
        `?overview=full&geometries=geojson`;

    try {
        const response = await fetch(url);
        const result = await response.json();

        if (!result.routes || !result.routes.length) {
            console.error("No OSRM route found");
            return;
        }

        const route = result.routes[0];

        const coordinates = route.geometry.coordinates.map(
            ([lng, lat]) => [lat, lng]
        );

        driverRouteLine.setLatLngs(coordinates);

    } catch (error) {
        console.error("OSRM error:", error);
    }
}

// Add this to seller_orders.js
socket.on("seller_order_cancelled", (data) => {
    console.log("User cancelled order:", data);

    const cards = document.querySelectorAll(".order-card");
    cards.forEach(card => {
        const cardToken = card.querySelector(".token-no").textContent.split(": ")[1].trim();
        const status = card
            .querySelector(".order-header")
            .querySelector(".order-status")
            .classList.replace(
                'status-placed',
                `status-${data.status}`
            );

        card
            .querySelector(".order-header")
            .querySelector(".order-status").textContent = "cancelled"
        console.log(status);

        console.log(cardToken, data.token_no);

        if (String(cardToken).trim() === String(data.token_no).trim()) {
            // print("equal")
            // Optional: Show a "User Cancelled" overlay before removing
            card.style.backgroundColor = "#ffebee";
            setTimeout(() => card.remove(), 1500);
        }
    });
});
async function loadOrders() {
    const res = await fetch(`/seller/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "res_id": resId })
    });
    if (res.status == 401) {
        alert("unauthorized,Please Log in")
        window.location.href = "/login/seller";
        return;
    }
    const data = await res.json();
    console.log(data)
    if (!data.success) {
        ordersList.innerHTML = `<p>Error loading orders - ${data.message}</p>`;
        return;
    }

    const htmlParts = [];
    let total_orders = 0;

    data.orders.forEach(order => {
        let total = 0;
        let restaurantsHTML = "";
        Object.entries(order.items).forEach(([itemName, detail]) => {
            const itemTotal = detail.price * detail.qty;
            total += itemTotal;
            restaurantsHTML += `
                <div class="item" item_id=${itemName}>
                    <span>${detail.name} x ${detail.qty}</span>
                    <span>₹${itemTotal}</span>
                </div>`;
        });
        let final_btn = null
        if (order.delivery_status !== "searching"&&order.delivery_status !== "delivered" ) {
            console.log(order);
            
            final_btn = `<button class="TrackOrderBtn statusBtn" style="opacity: 1;cursor: pointer;visibility: visible;display: inline-block;" data-warehouse_lat=${order.warehouse_coords.latt} data-warehouse_lng=${order.warehouse_coords.long} data-driver_lat=${order.driver_coords.latt} data-driver_lng=${order.driver_coords.long}>Track Driver</button>`
        }
        else {
            final_btn = `<button class="cancelBtn statusBtn" style="...">Cancel Order</button>`
            final_btn.add
        }
        htmlParts.push(`
            <div class="order-card" user_id=${order.user_id}>
                <div class="order-header">
                    <span class="order-id" id=${order.order_id}>#${order.order_id}</span>
                    <span class="order-status status-${order.status}">${order.status}</span>
                </div>
                <div class="token-no">Token No: ${order.token_no}</div>
                <div class="order-date">${order.time}</div>
                ${restaurantsHTML}
                <div class="total">Total: ₹${total}</div>
                <div id=controlBtn>
                <button class="completeBtn statusBtn" style="...">Completed</button>
                ${final_btn}
                </div>
            </div>
        `);

        if (order.status === "placed") total_orders++;
    });

    ordersList.innerHTML = htmlParts.join(""); // single write
    document.getElementById("active_orders").textContent = total_orders;
    applyFilter();
}
total_orders = 0;
async function loadOrderss() {
    const res = await fetch(`/seller/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "res_id": resId })
    });
    if (res.status == 401) {
        alert("unauthorized,Please Log in")
        window.location.href = "/login/seller";
        return;
    }
    const data = await res.json();
    console.log(data)
    if (!data.success) {
        ordersList.innerHTML = `<p>Error loading orders - ${data.message}</p>`;
        return;
    }

    ordersList.innerHTML = "";

    data.orders.forEach(order => {
        console.log(order)
        let total = 0;

        let restaurantsHTML = "";

        Object.entries(order.items).forEach(([itemName, detail]) => {
            console.log(itemName)
            console.log(detail)
            const itemTotal = detail.price * detail.qty;
            total += itemTotal;

            restaurantsHTML += `
                    <div class="item" item_id=${itemName}>
                        <span>${detail.name} x ${detail.qty}</span>
                        <span>₹${itemTotal}</span>
                    </div>
                `;
        });

        const orderHTML = `
            <div class="order-card" user_id=${order.user_id}>
                <div class="order-header">
                    <span class="order-id">#${order.order_id}</span>
                    <span class="order-status status-${order.status}">
                        ${order.status}
                    </span>
                </div>
                <div class="token-no">Token No: ${order.token_no}</div>
                <div class="order-date">${order.time}</div>

                ${restaurantsHTML}

                <div class="total">Total: ₹${total}</div>
                <button class="completeBtn statusBtn" style="
                    background: green;
                    color: white;
                    padding: 5px 11px;
                    border-radius: 7px;
                    border: none;
                    cursor: pointer;
                ">Completed</button>
                <button class="cancelBtn statusBtn" style="
                    background: red;
                    cursor: pointer;
                    color: white;
                    padding: 5px 11px;
                    border-radius: 7px;
                    border: none;
                ">Cancel Order</button>
            </div>
        `;

        ordersList.innerHTML += orderHTML;
        if (order.status === "placed") {
            total_orders += 1;
        }
    });
    console.log("Total orders:", total_orders);
    document.getElementById("active_orders").textContent = total_orders;
    applyFilter()
}
function renderSingleOrder(order, prepend = false) {
    let total = 0;
    let restaurantsHTML = "";

    Object.entries(order.items).forEach(([itemName, detail]) => {
        const itemTotal = detail.price * detail.qty;
        total += itemTotal;

        restaurantsHTML += `
            <div class="item">
                <span>${itemName} x ${detail.qty}</span>
                <span>₹${itemTotal}</span>
            </div>
        `;
    });

    const orderHTML = `
        <div class="order-card">
            <div class="order-header">
                <span class="order-id">#${order.order_id}</span>
                <span class="order-status status-${order.status}">
                    ${order.status}
                </span>
            </div>

            <div class="order-date">${order.time}</div>

            ${restaurantsHTML}

            <div class="total">Total: ₹${total}</div>
        </div>
    `;

    if (prepend) {
        ordersList.innerHTML = orderHTML + ordersList.innerHTML;
    } else {
        ordersList.innerHTML += orderHTML;
    }
}

loadOrders();

document.addEventListener("click", async (e) => {
    if (e.target.classList.contains("completeBtn")) {
        const card = e.target.closest(".order-card");
        const item = card.querySelector(".item");
        const item_id = item.getAttribute("item_id")

        // 🔥 select BOTH buttons inside this card
        const buttons = card.querySelectorAll(".statusBtn");

        const orderId = card
            .querySelector(".order-id")
            .textContent.replace("#", "");

        const tokenNo = card
            .querySelector(".token-no")
            .textContent.split(": ")[1];

        const userid = card.getAttribute("user_id")
        const res = await fetch("/update_order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                order_id: orderId,
                status: "completed",
                user_id: userid
            })
        })
        const data = await res.json()
        console.log(data);

        if (data.success) {

            socket.emit("order_completed", {
                order_id: orderId,
                userid: userid,
                token_no: tokenNo,
                res_id: resId,
                status: "completed"   // 🔥 send this instead
            }
            );
            // 🔥 UPDATE UI HERE
            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "completed";   // or "completed"
            statusSpan.className = "order-status status-completed";

            card.remove();
        }
        else {
            alert("failed updating status")
        }

        console.log("Completed sent:", orderId, tokenNo);
    }
    if (e.target.classList.contains("cancelBtn")) {
        const card = e.target.closest(".order-card");

        const orderId = card
            .querySelector(".order-id")
            .textContent.replace("#", "");

        const tokenNo = card
            .querySelector(".token-no")
            .textContent.split(": ")[1];

        const userid = card.getAttribute("user_id")
        const res = await fetch("/update_order", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                order_id: orderId,
                status: "canceled",
                user_id: userid
            })
        })
        const data = await res.json()
        console.log(data);

        if (data.success) {
            console.log("emitted order_completed");

            socket.emit("order_completed", {
                order_id: orderId,
                userid: userid,
                token_no: tokenNo,
                res_id: resId,
                status: "canceled"  // 🔥 send this instead
            });
            // 🔥 UPDATE UI HERE
            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "canceled";   // or "completed"
            statusSpan.className = "order-status status-canceled";

            card.remove();
            console.log("Completed sent:", orderId, tokenNo);
        }
        else {
            alert("failed updating status")
        }
    }
    if (e.target.classList.contains("TrackOrderBtn")) {
        const card = e.target.closest(".order-card");
        const item = card.querySelector(".item");

        // 🔥 select BOTH buttons inside this card
        const buttons = card.querySelectorAll(".statusBtn");

        const orderId = card
            .querySelector(".order-id")
            .textContent.replace("#", "");
        const trackBtn = e.target;
        console.log(trackBtn.dataset);
        
        const driverLat = Number(trackBtn.dataset.driver_lat);
        const driverLng = Number(trackBtn.dataset.driver_lng);

        const warehouseLat = Number(trackBtn.dataset.warehouse_lat);
        const warehouseLng = Number(trackBtn.dataset.warehouse_lng);

        console.log("Driver:", driverLat, driverLng);
        console.log("Warehouse:", warehouseLat, warehouseLng);

        // your tracking code here
        trackDriver(card,trackBtn)
    }
});
document.getElementById("backBtn").addEventListener("click", () => {
    document.getElementById("map-block").classList.remove("active")
})
const overlay = document.querySelector(".overlay")
document.getElementById("menuToggle").onclick = function () {
    const sidebar = document.querySelector(".sidebar")
    sidebar.classList.add("show")
    sidebar.style.display = "block"
    overlay.classList.add("show")
};

document.getElementById("hideCategoryBtn").addEventListener("click", function () {
    const sidebar = document.querySelector(".sidebar")
    sidebar.style.display = "none"
    overlay.classList.remove("show")
});
overlay.addEventListener("click", () => {
    const sidebar = document.querySelector(".sidebar")
    overlay.classList.remove("show")
    sidebar.style.display = "none"
    sidebar.classList.remove("show")
})

async function trackDriver(card, trackBtn) {
    const orderid = card
        .querySelector(".order-id")
        .getAttribute("id");

    trackingOrderId = orderid;

    console.log("Tracking order:", trackingOrderId);

    socket.emit("track_order", {
        order_id: trackingOrderId
    });

    document.getElementById("map-block").classList.add("active");

    // ------------------------------------------------
    // Coordinates from Track Driver button
    // ------------------------------------------------
    
    const driverLat = Number(trackBtn.dataset.driver_lat);
    const driverLng = Number(trackBtn.dataset.driver_lng);

    const warehouseLatVal = Number(trackBtn.dataset.warehouse_lat);
    const warehouseLngVal = Number(trackBtn.dataset.warehouse_lng);

    warehouseLat = warehouseLatVal;
    warehouseLng = warehouseLngVal;

    // ------------------------------------------------
    // Initialize map only once
    // ------------------------------------------------

    if (!map) {
        map = L.map("map");

        L.tileLayer(
            "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
            { attribution: "© OpenStreetMap contributors" }
        ).addTo(map);
    }

    // ------------------------------------------------
    // Warehouse marker
    // ------------------------------------------------

    if (!warehouseMarker) {
        warehouseMarker = L.marker([warehouseLat, warehouseLng])
            .addTo(map)
            .bindPopup("Warehouse");
    } else {
        warehouseMarker.setLatLng([warehouseLat, warehouseLng]);
    }

    // ------------------------------------------------
    // Route line
    // ------------------------------------------------

    if (!driverRouteLine) {
        driverRouteLine = L.polyline([], {
            weight: 5,
            opacity: 0.8
        }).addTo(map);
    }

    // ------------------------------------------------
    // Resize map
    // ------------------------------------------------

    setTimeout(() => {
        map.invalidateSize();
    }, 300);

    // ------------------------------------------------
    // Existing driver location
    // ------------------------------------------------

    if (currentDriverPosition) {

        await updateDriverRoute(
            currentDriverPosition.lat,
            currentDriverPosition.lng
        );

        map.fitBounds(
            L.latLngBounds([
                warehouseMarker.getLatLng(),
                currentDriverPosition
            ]),
            { padding: [40, 40] }
        );

    } else {

        currentDriverPosition = L.latLng(
            driverLat,
            driverLng
        );

        await updateDriverRoute(
            driverLat,
            driverLng
        );

        driverMarker = L.marker([
            driverLat,
            driverLng
        ])
            .addTo(map)
            .bindPopup("Driver");

        map.fitBounds(
            L.latLngBounds([
                warehouseMarker.getLatLng(),
                currentDriverPosition
            ]),
            { padding: [40, 40] }
        );
    }
}