// Socket connects ONCE, the first time this script loads, and stays alive
// across all SPA navigation (this script tag is only ever injected once —
// see spa-router.js's ensureScriptLoaded).

// const socket = io();

const socket = io({
    autoConnect: false
});


// ============================================================
// DRIVER VARIABLES
// ============================================================

let driverMarker = null;
let warehouseMarker = null;
let driverRouteLine = null;
// let map = null;

let currentDriverPosition = null;
let animationFrame = null;

let trackingOrderId = null;
let warehouseLat = null;
let warehouseLng = null;


// ============================================================
// DRIVER ASSIGNED
// ============================================================

socket.on("driver_assigned", (data) => {
    console.log(data);
    
    console.log(
        "Driver assigned:",
        data.order_id
    );

    const ordersList =
        document.getElementById("orders-list");

    const cards =
        document.querySelectorAll(".order-card");


    cards.forEach(card => {

        const orderId =
            card
                .querySelector(".order-id")
                .textContent
                .replace("#", "")
                .trim();


        if (orderId !== String(data.order_id)) {
            return;
        }


        // Move card to top
        ordersList.prepend(card);


        // Visual indication
        card.style.transition =
            "background-color 0.3s";

        card.style.backgroundColor =
            "#fff8e1";


        const status =
            card.querySelector(
                ".order-header .order-status"
            );


        status.textContent =
            "Driver is Arriving...";

        status.style.backgroundColor =
            "#25a140";

        status.style.color =
            "blanchedalmond";


        // Hide cancel button
        const cancelBtn =
            card.querySelector(
                "#controlBtn .cancelBtn"
            );


        if (cancelBtn) {
            cancelBtn.style.display = "none";
        }


        // Prevent duplicate Track buttons
        if (
            card.querySelector(
                ".TrackOrderBtn"
            )
        ) {
            return;
        }


        const trackBtn =
            document.createElement("button");


        trackBtn.className =
            "TrackOrderBtn statusBtn";

        trackBtn.textContent =
            "Track Driver";


        trackBtn.style.cssText = `
            opacity: 1;
            cursor: pointer;
            visibility: visible;
            display: inline-block;
        `;


        const controlBtn =
            card.querySelector(
                "#controlBtn"
            );


        if (controlBtn) {
            controlBtn.appendChild(trackBtn);
        }


        // ====================================================
        // TRACK DRIVER CLICK
        // ====================================================

        trackBtn.addEventListener(
            "click",
            async () => {

                trackingOrderId =
                    orderId;


                console.log(
                    "Tracking order:",
                    trackingOrderId
                );


                socket.emit(
                    "track_order",
                    {
                        order_id:
                            trackingOrderId
                    }
                );


                // Show map
                document
                    .getElementById("map-block")
                    .classList.add("active");


                // ------------------------------------------------
                // Warehouse coordinates
                // ------------------------------------------------
                let warehouseLoc=data.warehouse_coords
                
                // console.log(warehouseLoc.lat);
                // console.log(warehouseLoc.long)
                warehouseLat =
                    Number(
                        warehouseLoc.lat
                    );

                warehouseLng =
                    Number(
                        warehouseLoc.long
                    );


                // ------------------------------------------------
                // Initialize map only once
                // ------------------------------------------------
                console.log("in map");
                console.log(!map);
                
                if (map) {

                    map = L.map("map");

                    L.tileLayer(
                        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
                        {
                            attribution:
                                "© OpenStreetMap contributors"
                        }
                    ).addTo(map);
                }

                console.log("after map");
                
                // ------------------------------------------------
                // Warehouse marker
                // ------------------------------------------------

                if (!warehouseMarker) {
                    console.log("if ! warehouse");
                    console.log(warehouseLat,warehouseLng);
                    console.log("map:", map);
console.log("map.addLayer:", map?.addLayer);
console.log("map instanceof Leaflet Map:", map instanceof L.Map);
                    warehouseMarker =
                        L.marker([
                            warehouseLat,
                            warehouseLng
                        ])
                            .addTo(map)
                            .bindPopup(
                                "Warehouse"
                            );

                } else {
                    console.log("in else ! warehouse");
                    
                    warehouseMarker.setLatLng([
                        warehouseLat,
                        warehouseLng
                    ]);
                }
                console.log("after warehouse");
                

                // ------------------------------------------------
                // Route line
                // ------------------------------------------------

                if (!driverRouteLine) {

                    driverRouteLine =
                        L.polyline(
                            [],
                            {
                                weight: 5,
                                opacity: 0.8
                            }
                        ).addTo(map);
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

                if (
                    currentDriverPosition
                ) {

                    await updateDriverRoute(
                        currentDriverPosition.lat,
                        currentDriverPosition.lng
                    );


                    map.fitBounds(
                        L.latLngBounds([
                            warehouseMarker
                                .getLatLng(),

                            currentDriverPosition
                        ]),
                        {
                            padding: [
                                40,
                                40
                            ]
                        }
                    );

                } else {

                    // map.setView(
                    //     [
                    //         warehouseLat,
                    //         warehouseLng
                    //     ],
                    //     13
                    // );
                    currentDriverPosition=data.driver_coords
                    let latt=data.driver_coords.latt
                    let long=data.driver_coords.long
                    currentDriverPosition = L.latLng(
                        latt,
                        long
                    )
                    await updateDriverRoute(
                        latt,
                        long
                    );

                    driverMarker =
                        L.marker([
                            latt,
                            long
                        ])
                            .addTo(map)
                            .bindPopup("Driver");
                    map.fitBounds(
                        L.latLngBounds([
                            warehouseMarker
                                .getLatLng(),

                            currentDriverPosition
                        ]),
                        {
                            padding: [
                                40,
                                40
                            ]
                        }
                    );
                }
            }
        );


        // Reset card highlight
        setTimeout(() => {

            card.style.backgroundColor =
                "";

        }, 2000);

    });
});


// ============================================================
// DRIVER LOCATION
// ============================================================

socket.on(
    "update_driver_location",
    async (data) => {

        console.log(
            "Received new location:",
            data
        );


        // Ignore updates for another order
        if (
            trackingOrderId &&
            String(data.order_id) !==
            String(trackingOrderId)
        ) {
            return;
        }


        const lat =
            Number(data.lat);

        const lng =
            Number(data.lng);


        if (
            !Number.isFinite(lat) ||
            !Number.isFinite(lng)
        ) {

            console.error(
                "Invalid driver coordinates:",
                data
            );

            return;
        }

        console.log(lat,lng);
        
        const newPosition =
            L.latLng(
                lat,
                lng
            );


        // ========================================================
        // FIRST DRIVER LOCATION
        // ========================================================

        if (!driverMarker) {

            driverMarker =
                L.marker([
                    lat,
                    lng
                ])
                    .addTo(map)
                    .bindPopup("Driver");


            currentDriverPosition =
                newPosition;


            if (warehouseMarker) {

                await updateDriverRoute(
                    lat,
                    lng
                );


                map.fitBounds(
                    L.latLngBounds([
                        warehouseMarker
                            .getLatLng(),

                        newPosition
                    ]),
                    {
                        padding: [
                            40,
                            40
                        ]
                    }
                );
            }

            return;
        }


        // ========================================================
        // SMOOTH DRIVER MOVEMENT
        // ========================================================

        animateDriverMarker(
            currentDriverPosition,
            newPosition
        );


        currentDriverPosition =
            newPosition;
    }
);


// ============================================================
// SMOOTH MARKER ANIMATION
// ============================================================

function animateDriverMarker(
    from,
    to
) {

    if (!from) {

        driverMarker.setLatLng(to);

        return;
    }


    if (animationFrame) {

        cancelAnimationFrame(
            animationFrame
        );
    }


    const startTime =
        performance.now();


    const duration = 2500;


    function animate(now) {

        const progress =
            Math.min(
                (now - startTime) /
                duration,
                1
            );


        const eased =
            progress < 0.5
                ? 2 *
                progress *
                progress

                : 1 -
                Math.pow(
                    -2 *
                    progress +
                    2,
                    2
                ) /
                2;


        const lat =
            from.lat +
            (to.lat - from.lat) *
            eased;


        const lng =
            from.lng +
            (to.lng - from.lng) *
            eased;


        driverMarker.setLatLng([
            lat,
            lng
        ]);


        if (progress < 1) {

            animationFrame =
                requestAnimationFrame(
                    animate
                );
        }
    }


    animationFrame =
        requestAnimationFrame(
            animate
        );
}


// ============================================================
// OSRM ROUTING
// ============================================================

async function updateDriverRoute(
    driverLat,
    driverLng
) {

    if (!warehouseMarker) {
        return;
    }


    const warehousePosition =
        warehouseMarker.getLatLng();


    const warehouseLat =
        warehousePosition.lat;

    const warehouseLng =
        warehousePosition.lng;


    const url =
        `https://router.project-osrm.org/route/v1/driving/` +
        `${driverLng},${driverLat};` +
        `${warehouseLng},${warehouseLat}` +
        `?overview=full&geometries=geojson`;


    try {

        const response =
            await fetch(url);


        const result =
            await response.json();


        if (
            !result.routes ||
            !result.routes.length
        ) {

            console.error(
                "No OSRM route found"
            );

            return;
        }


        const route =
            result.routes[0];


        const coordinates =
            route.geometry.coordinates.map(
                ([lng, lat]) =>
                    [lat, lng]
            );


        driverRouteLine.setLatLngs(
            coordinates
        );

    }
    catch (error) {

        console.error(
            "OSRM error:",
            error
        );
    }
}


// ============================================================
// ORDER STATUS UPDATED
// ============================================================

socket.on(
    "order_status_updated",
    (data) => {

        const orderCards =
            document.querySelectorAll(
                ".order-card"
            );


        orderCards.forEach(card => {

            const tokenNo =
                card
                    .querySelector(
                        ".token-no"
                    )
                    .textContent
                    .split(": ")[1]
                    .trim();


            if (
                tokenNo ===
                `${data.token_no}`
            ) {

                const statusSpan =
                    card.querySelector(
                        ".order-status"
                    );


                statusSpan.textContent =
                    data.status;


                statusSpan.className =
                    `order-status status-${data.status}`;
            }
        });


        // Keep cache in sync
        const uid =
            window.APP_USER_ID ||
            window.location.pathname
                .split("/")
                .pop();


        const cacheKey =
            `cachedOrders_${uid}`;


        const cached =
            sessionStorage.getItem(
                cacheKey
            );


        if (cached) {

            try {

                const orders =
                    JSON.parse(cached);


                const order =
                    orders.find(
                        o =>
                            `#${o.order_id}` ===
                            data.order_id ||
                            `${o.order_id}` ===
                            data.order_id
                                .replace(
                                    "#",
                                    ""
                                )
                    );


                if (order) {

                    order.status =
                        data.status;
                }


                sessionStorage.setItem(
                    cacheKey,
                    JSON.stringify(
                        orders
                    )
                );

            }
            catch (e) { }
        }
    }
);


// ============================================================
// RENDER ORDERS
// ============================================================

function renderOrders(
    orders,
    ordersList,
    no_order_container
) {

    if (
        !orders ||
        orders.length === 0
    ) {

        no_order_container.classList.add(
            "show"
        );

        ordersList.innerHTML = "";

        return;
    }


    no_order_container.classList.remove(
        "show"
    );


    const html =
        orders.map(order => {

            /*
             * NEW CART STRUCTURE:
             *
             * order.items = {
             *     uid,
             *     total,
             *     items: {
             *         item_id: {
             *             name,
             *             qty,
             *             price,
             *             available_qty
             *         }
             *     }
             * }
             *
             * No restaurant grouping anymore.
             */

            const cart =
                order.items?.items ||
                order.resturants.items ||
                {};
            console.log(cart);


            let total = 0;

            let restaurantsHTML = "";


            Object.entries(cart)
                .forEach(
                    ([itemid, item]) => {

                        const itemTotal =
                            item.price *
                            item.qty;


                        total +=
                            itemTotal;


                        restaurantsHTML += `
                            <div
                                class="item"
                                item_id="${itemid}"
                            >
                                <span>
                                    ${item.name} x ${item.qty}
                                </span>

                                <span>
                                    ₹${itemTotal}
                                </span>
                            </div>
                        `;
                    }
                );


            /*
             * Prefer the stored order total.
             * Fall back to calculated total.
             */

            if (
                typeof order.items?.total ===
                "number"
            ) {

                total =
                    order.items.total;

            } else if (
                typeof order.total ===
                "number"
            ) {

                total =
                    order.total;
            }


            return `
                <div class="order-card">

                    <div class="order-header">

                        <span class="order-id">
                            #${order.order_id}
                        </span>

                        <span
                            class="order-status status-${order.status}"
                        >
                            ${order.status}
                        </span>

                    </div>


                    <div class="token-no">
                        Token No: ${order.token_no}
                    </div>


                    <div class="order-date">
                        ${order.date}
                    </div>


                    ${restaurantsHTML}


                    <div class="total">
                        Total: ₹${total}
                    </div>


                    <div id="controlBtn">

                        <button
                            class="cancelBtn"
                            style="
                                background: red;
                                color: white;
                                padding: 5px 11px;
                                border-radius: 7px;
                                border: none;
                            "
                        >
                            Cancel Order
                        </button>

                    </div>

                </div>
            `;
        })
            .join("");


    ordersList.innerHTML =
        html;
}


// ============================================================
// FILTER
// ============================================================

function applyFilterFor(
    filterDropdown,
    no_order_container
) {

    no_order_container.classList.remove(
        "show"
    );


    const cards =
        document.querySelectorAll(
            ".order-card"
        );


    let visibleCardss = 0;


    cards.forEach(card => {

        const statusText =
            card
                .querySelector(
                    ".order-status"
                )
                .textContent
                .trim()
                .toLowerCase();


        if (
            filterDropdown.value
                .toLowerCase() ===
            "all" ||

            statusText ===
            filterDropdown.value
                .toLowerCase()
        ) {

            card.style.display =
                "block";

            visibleCardss++;

        } else {

            card.style.display =
                "none";
        }
    });


    no_order_container.classList.toggle(
        "show",
        visibleCardss === 0
    );
}


// ============================================================
// LOAD ORDERS
// ============================================================

async function loadOrders(
    userId,
    { background = false } = {}
) {

    const ordersList =
        document.getElementById(
            "orders-list"
        );


    const no_order_container =
        document.getElementById(
            "No_orders_container"
        );


    if (!ordersList) {
        return;
    }


    const cacheKey =
        `cachedOrders_${userId}`;


    if (!background) {

        const cached =
            sessionStorage.getItem(
                cacheKey
            );


        if (cached) {

            try {

                renderOrders(
                    JSON.parse(cached),
                    ordersList,
                    no_order_container
                );

            }
            catch (e) {

                console.warn(
                    "bad orders cache, ignoring",
                    e
                );
            }
        }
    }


    const res =
        await fetch(
            `/get_orders/${userId}`,
            {
                method: "POST"
            }
        );


    if (res.status == 401) {

        alert(
            "unauthorized User,Please Log in"
        );

        window.location.href =
            "/login/user";

        return;
    }


    const data =
        await res.json();


    console.log(data);


    if (!data.success) {

        if (
            !sessionStorage.getItem(
                cacheKey
            )
        ) {

            ordersList.innerHTML =
                "<p>Error loading orders</p>";
        }

        return;
    }


    // ========================================================
    // SOCKET
    // ========================================================

    /*
     * Prevent adding another connect listener
     * every time loadOrders() runs.
     */

    if (!socket.connected) {

        socket.once(
            "connect",
            () => {

                console.log(
                    "Connected:",
                    socket.id
                );


                if (
                    data.orders &&
                    data.orders.length
                ) {

                    const order_id =
                        data.orders[
                            data.orders.length - 1
                        ].order_id;


                    console.log(
                        "emittin join_user_room",
                        order_id
                    );


                    socket.emit(
                        "join_user_room",
                        {
                            order_id:
                                order_id
                        }
                    );
                }
            }
        );


        socket.connect();

    } else {

        if (
            data.orders &&
            data.orders.length
        ) {

            const order_id =
                data.orders[
                    data.orders.length - 1
                ].order_id;


            socket.emit(
                "join_user_room",
                {
                    order_id:
                        order_id
                }
            );
        }
    }


    sessionStorage.setItem(
        cacheKey,
        JSON.stringify(
            data.orders || []
        )
    );

    console.log(data.orders);

    renderOrders(
        data.orders,
        ordersList,
        no_order_container
    );
}


// ============================================================
// INIT ORDERS PAGE
// ============================================================

function initOrdersPage() {

    const ordersList =
        document.getElementById(
            "orders-list"
        );


    if (!ordersList) {
        return;
    }


    const pathParts =
        window.location.pathname
            .split("/");


    const userId =
        window.APP_USER_ID ||
        pathParts[
        pathParts.length - 1
        ];


    const no_order_container =
        document.getElementById(
            "No_orders_container"
        );


    const filterDropdown =
        document.getElementById(
            "filterDropdown"
        );


    filterDropdown.addEventListener(
        "change",
        () =>
            applyFilterFor(
                filterDropdown,
                no_order_container
            )
    );


    loadOrders(userId)
        .then(
            () =>
                applyFilterFor(
                    filterDropdown,
                    no_order_container
                )
        );


    // ========================================================
    // CANCEL ORDER
    // ========================================================

    ordersList.addEventListener(
        "click",
        async (e) => {

            if (
                !e.target.classList.contains(
                    "cancelBtn"
                )
            ) {
                return;
            }


            const card =
                e.target.closest(
                    ".order-card"
                );


            const orderId =
                card
                    .querySelector(
                        ".order-id"
                    )
                    .textContent
                    .replace(
                        "#",
                        ""
                    );


            const tokenNo =
                card
                    .querySelector(
                        ".token-no"
                    )
                    .textContent
                    .split(": ")[1];


            const res =
                await fetch(
                    "/update_order_user",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body:
                            JSON.stringify({
                                order_id:
                                    orderId,

                                status:
                                    "canceled",

                                user_id:
                                    userId
                            })
                    }
                );


            const data =
                await res.json();


            console.log(data);


            if (data.success) {

                /*
                 * No res_ids anymore because
                 * the cart/order is no longer
                 * restaurant based.
                 */

                socket.emit(
                    "user_cancelled_order",
                    {
                        order_id:
                            orderId,

                        token_no:
                            tokenNo,

                        user_id:
                            userId,

                        status:
                            "canceled"
                    }
                );


                const statusSpan =
                    card.querySelector(
                        ".order-status"
                    );


                statusSpan.textContent =
                    "canceled";


                statusSpan.className =
                    "order-status status-canceled";


                e.target.style.display =
                    "none";


                await loadOrders(
                    userId,
                    {
                        background: true
                    }
                );


                applyFilterFor(
                    filterDropdown,
                    no_order_container
                );

            } else {

                alert(
                    "failed updating status"
                );
            }
        }
    );
}


// ============================================================
// INITIAL LOAD
// ============================================================

initOrdersPage();


// ============================================================
// SPA NAVIGATION
// ============================================================

document.addEventListener(
    "spa:pageload",
    (e) => {

        if (
            e.detail.page ===
            "orders"
        ) {

            initOrdersPage();
        }
    }
);


// ============================================================
// BACK BUTTON
// ============================================================

const backBtn =
    document.getElementById(
        "backBtn"
    );


if (backBtn) {

    backBtn.addEventListener(
        "click",
        () => {

            document
                .getElementById(
                    "map-block"
                )
                .classList.remove(
                    "active"
                );
        }
    );
}