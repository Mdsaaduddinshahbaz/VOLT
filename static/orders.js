// Socket connects ONCE, the first time this script loads, and stays alive
// across all SPA navigation (this script tag is only ever injected once —
// see spa-router.js's ensureScriptLoaded).
// const socket = io();
const socket = io({ autoConnect: false });
// socket.connect(orderid)
// socket.on("connect", () => {
//     console.log("Connected:", socket.id);
//     const uid = window.APP_USER_ID || window.location.pathname.split("/").pop();
//     console.log("emittin join_user_room",uid);

//     socket.emit('join_user_room', { user_id: uid });
// });
// socket.on("connect", () => {
//     console.log("Connected:", socket.id);
//     const uid = window.APP_USER_ID || window.location.pathname.split("/").pop();
//     console.log("emittin join_user_room",uid);

//     socket.emit('join_user_room', { order_id: order_id });
// });
let driverMarker = null;
let map = null
map = L.map("map").setView([17.385, 78.4867], 13);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
}).addTo(map);
let warehouseMarker = null;
let driverRouteLine = null;

let currentDriverPosition = null;
let animationFrame = null;
socket.on("driver_assigned", (data) => {
    const ordersList = document.getElementById("orders-list");
    console.log("Driver assigned:", data.order_id);

    const cards = document.querySelectorAll(".order-card");

    cards.forEach(card => {
        const orderId = card
            .querySelector(".order-id")
            .textContent
            .replace("#", "")
            .trim();

        if (orderId === String(data.order_id)) {
            // Move this card to the very top
            ordersList.prepend(card);

            // Optional: make it visually noticeable
            card.style.transition = "background-color 0.3s";
            card.style.backgroundColor = "#fff8e1";
            card.querySelector(".order-header .order-status").textContent = "Driver is Arriving..."
            card.querySelector(".order-header .order-status").style.backgroundColor = "#25a140"
            card.querySelector(".order-header .order-status").style.color = "blanchedalmond"
            card.querySelector(".cancelBtn").style.display = "none";
            const trackBtn = document.createElement("button");
            trackBtn.className = "TrackOrderBtn statusBtn";
            trackBtn.textContent = "Track Driver";
            trackBtn.style.cssText = `
                opacity: 1;
                cursor: pointer;
                visibility: visible;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: calc(50% - 5px) !important;
                margin-top: 14px !important;
                padding: 11px 0 !important;
                border-radius: 9px !important;
                border: none !important;
                font-family: var(--font-body);
                font-weight: 700;
                font-size: 13px;
                letter-spacing: 0.03em;
                cursor: pointer;
                transition: transform 0.12s ease, box-shadow 0.12s ease, background 0.12s ease;
                display: inline-block;
            `;
            const controlBtn = card.querySelector("#controlBtn");
            controlBtn.appendChild(trackBtn);
            trackBtn.addEventListener("click", () => {
                const orderid = card
                    .querySelector(".order-id")
                    .textContent
                    .replace("#", "")
                    .trim();
                console.log("emitting")
                socket.emit("track_order", { order_id: orderid });
                console.log("Track:", orderid);
                document.getElementById("map-block").classList.add("active")
                if (!map) {
                    map = L.map("map").setView([17.385, 78.4867], 13);

                    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
                        attribution: "© OpenStreetMap contributors"
                    }).addTo(map);
                }
                driverMarker = L.marker([17.385, 78.4867])
                    .addTo(map)
                    .bindPopup("Driver")
                    .openPopup();

                setTimeout(async () => {
                    await map.invalidateSize();
                }, 500);
            });
            setTimeout(() => {
                card.style.backgroundColor = "";
            }, 2000);
        }
    });
});
socket.on("update_driver_location", (data) => {
    console.log("recieved new location", data);
    let lat = Number(data.lat);
    let lng = Number(data.lng);
    if (!driverMarker) {

        driverMarker = L.marker([lat, lng])
            .addTo(map)
            .bindPopup("Driver");

    } else {

        driverMarker.setLatLng([lat, lng]);

    }
    map.setView([lat, lng]);
})
socket.on("order_status_updated", (data) => {
    const orderCards = document.querySelectorAll(".order-card");
    orderCards.forEach(card => {
        const tokenNo = card.querySelector(".token-no").textContent.split(": ")[1].trim();
        if (tokenNo === `${data.token_no}`) {
            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = data.status;
            statusSpan.className = `order-status status-${data.status}`;
        }
    });
    // keep the cache in sync so a later revisit shows the updated status too
    const uid = window.APP_USER_ID || window.location.pathname.split("/").pop();
    const cacheKey = `cachedOrders_${uid}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
        try {
            const orders = JSON.parse(cached);
            const order = orders.find(o => `#${o.order_id}` === data.order_id || `${o.order_id}` === data.order_id.replace("#", ""));
            if (order) order.status = data.status;
            sessionStorage.setItem(cacheKey, JSON.stringify(orders));
        } catch (e) { }
    }
});

function renderOrders(orders, ordersList, no_order_container) {
    if (!orders || orders.length === 0) {
        no_order_container.classList.add("show");
        ordersList.innerHTML = "";
        return;
    }
    no_order_container.classList.remove("show");

    const html = orders.map(order => {
        const cart = order.resturants.cart;
        let total = 0;
        let restaurantsHTML = "";

        Object.entries(cart).forEach(([resId, blabla]) => {
            restaurantsHTML += `
        <div class="restaurant-name" res_id=${resId}>
            ${blabla.name}
        </div>
    `;
            Object.entries(blabla.items).forEach(([itemid, item]) => {
                const itemTotal = item.price * item.qty;
                total += itemTotal;
                restaurantsHTML += `
            <div class="item" item_id=${itemid}>
                <span>${item.name} x ${item.qty}</span>
                <span>₹${itemTotal}</span>
            </div>
        `;
            });
        });

        return `
            <div class="order-card">
                <div class="order-header">
                    <span class="order-id">#${order.order_id}</span>
                    <span class="order-status status-${order.status}">
                        ${order.status}
                    </span>
                </div>
                <div class="token-no">Token No: ${order.token_no}</div>
                <div class="order-date">${order.date}</div>
                ${restaurantsHTML}
                <div class="total">Total: ₹${total}</div>
                <div id=controlBtn>
                <button class="cancelBtn" style="
                    background: red;
                    color: white;
                    padding: 5px 11px;
                    border-radius: 7px;
                    border: none;
                ">Cancel Order</button>
                </div>
            </div>
        `;
    }).join("");

    ordersList.innerHTML = html;
}

function applyFilterFor(filterDropdown, no_order_container) {
    no_order_container.classList.remove("show");
    const cards = document.querySelectorAll(".order-card");
    let visibleCardss = 0;
    cards.forEach(card => {
        const statusText = card.querySelector(".order-status").textContent.trim().toLowerCase();
        if (filterDropdown.value.toLowerCase() === "all" || statusText === filterDropdown.value.toLowerCase()) {
            card.style.display = "block";
            visibleCardss++;
        } else {
            card.style.display = "none";
        }
    });
    no_order_container.classList.toggle("show", visibleCardss === 0);
}

async function loadOrders(userId, { background = false } = {}) {
    const ordersList = document.getElementById("orders-list");
    const no_order_container = document.getElementById("No_orders_container");
    if (!ordersList) return;
    const cacheKey = `cachedOrders_${userId}`;

    if (!background) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
            try { renderOrders(JSON.parse(cached), ordersList, no_order_container); }
            catch (e) { console.warn("bad orders cache, ignoring", e); }
        }
    }

    const res = await fetch(`/get_orders/${userId}`, { method: "POST" });
    if (res.status == 401) {
        alert("unauthorized User,Please Log in")
        window.location.href = "/login/user";
        return;
    }
    const data = await res.json();
    console.log(data);

    if (!data.success) {
        if (!sessionStorage.getItem(cacheKey)) ordersList.innerHTML = "<p>Error loading orders</p>";
        return;
    }
    // socket
    socket.on("connect", () => {
        console.log("Connected:", socket.id);
        const uid = window.APP_USER_ID || window.location.pathname.split("/").pop();
        console.log("emittin join_user_room", data.orders[data.orders.length - 1].order_id);

        socket.emit('join_user_room', {
            order_id: data.orders[data.orders.length - 1].order_id
        });;
    });
    socket.connect()
    sessionStorage.setItem(cacheKey, JSON.stringify(data.orders || []));
    renderOrders(data.orders, ordersList, no_order_container);
}

function initOrdersPage() {
    const ordersList = document.getElementById("orders-list");
    if (!ordersList) return; // not actually on the orders content

    const pathParts = window.location.pathname.split("/");
    const userId = window.APP_USER_ID || pathParts[pathParts.length - 1];
    const no_order_container = document.getElementById("No_orders_container");
    const filterDropdown = document.getElementById("filterDropdown");

    filterDropdown.addEventListener("change", () => applyFilterFor(filterDropdown, no_order_container));

    loadOrders(userId).then(() => applyFilterFor(filterDropdown, no_order_container));

    ordersList.addEventListener("click", async (e) => {
        if (!e.target.classList.contains("cancelBtn")) return;
        const card = e.target.closest(".order-card");
        const orderId = card.querySelector(".order-id").textContent.replace("#", "");
        const tokenNo = card.querySelector(".token-no").textContent.split(": ")[1];
        let res_ids = []
        card.querySelectorAll(".restaurant-name").forEach(r => res_ids.push(r.getAttribute("res_id")));

        const res = await fetch("/update_order_user", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order_id: orderId, status: "canceled", user_id: userId })
        })
        const data = await res.json()
        console.log(data);

        if (data.success) {
            socket.emit("user_cancelled_order", {
                order_id: orderId, token_no: tokenNo, res_ids: res_ids, user_id: userId, status: "canceled"
            });
            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "canceled";
            statusSpan.className = "order-status status-canceled";
            e.target.style.display = "none";
            await loadOrders(userId, { background: true });
            applyFilterFor(filterDropdown, no_order_container);
        }
        else {
            alert("failed updating status")
        }
    });
}

// Run on this page's first real load...
initOrdersPage();
// ...and re-run every time the SPA router swaps Orders back into view
document.addEventListener("spa:pageload", (e) => {
    if (e.detail.page === "orders") initOrdersPage();
});