let pendingCartItem = null;

document.addEventListener("DOMContentLoaded", async () => {
    const path = window.location.pathname;

    // Path shape:
    // /menu/:res_name/:address/:res_id/:userId
    const userId = path.split("/")[5];
    const res_id = path.split("/")[4];
    const addresss = path.split("/")[3];
    const res_name = path.split("/")[2];

    const decoded = decodeURIComponent(res_name);
    const addresss_decoded = decodeURIComponent(addresss);

    const menu_items_container = document.getElementById("menu_container");
    const cartBtn = document.getElementById("cartBtn");
    const orderBtn = document.getElementById("orderBtn");
    const res_info = document.querySelector(".res-info");
    const heading = res_info?.querySelector("h1");
    const res_location = res_info?.querySelector(".res-location");
    const breadcrump = document.querySelector(".breadcrumbs");
    const loading = document.getElementById("loading");
    const menu_container = document.querySelector(".menu-section");
    const current_total_amount = document.getElementById("amount");
    const footer = document.getElementsByTagName("footer")[0];
    const gotoCartBtn = document.getElementById("GoCartBtn");
    const message = document.getElementById("message");
    const ReplaceContainer = document.getElementById("ReplaceContainer");
    const overlayContainer = document.getElementById("overlayContainer");

    if (breadcrump) {
        breadcrump.innerText =
            `Home / ${addresss_decoded} / ${decoded}`;
    }

    if (res_location) {
        res_location.innerText = addresss_decoded;
    }

    if (heading) {
        heading.innerText = decoded;
    }

    // ============================================================
    // LOAD CART
    // ============================================================

    const rest = await fetch("/get_cart_items", {
        method: "POST",
        headers: {
            "Content-type": "application/json"
        },
        body: JSON.stringify({
            userid: userId
        })
    });

    if (rest.status === 401) {
        alert("Unauthorized user. Please log in");
        window.location.href = "/login/user";
        return;
    }

    if (!rest.ok) {
        alert("Error loading cart");
        return;
    }

    const datas = await rest.json();
    console.log(datas);
    
    if (
        datas.results !== null &&
        datas.results.total > 0
    ) {
        footer.classList.add("show");
        current_total_amount.innerText = datas.results.total;
    }

    // ============================================================
    // LOAD MENU
    // ============================================================

    const res = await fetch("/list_items", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            res_id: res_id,
            type: "user"
        })
    });

    if (res.status === 401) {
        alert("Unauthorized user. Please log in");
        window.location.href = "/login/user";
        return;
    }

    if (!res.ok) {
        alert("Error loading menu");
        return;
    }

    const data = await res.json();

    if (!data.success) {
        return;
    }

    const mergedd = mergeMenuWithCart(data, datas);

    loading.style.display = "none";

    // ============================================================
    // MASTER ITEM LIST
    //
    // This never changes.
    // Search filters this array and rebuilds the grid.
    // ============================================================

    const items = Object.values(mergedd);

    // ============================================================
    // CREATE INDIVIDUAL ITEM
    // ============================================================

    function createItem(item) {

        const controls = item.qty === 0
            ? `
                <button
                    class="add-btn"
                    id="${escapeHtml(item.id)}">
                    ADD
                </button>
            `
            : `
                <div class="quantity-control">
                    <button class="qty-btn reduce">-</button>

                    <span class="item_qty">
                        ${escapeHtml(item.qty)}
                    </span>

                    <button class="qty-btn increase">+</button>
                </div>
            `;

        return `
            <div
                class="menu-item"
                id="${escapeHtml(item.id)}"
                available="${escapeHtml(item.item_qty)}"
            >

                <div class="item-img-wrapper">
                    <img
                        src="${escapeHtml(item.file_url)}"
                        alt="${escapeHtml(item.name)}"
                    >
                </div>

                <div class="item-details">

                    <div
                        style="
                            display:flex;
                            justify-content:space-between;
                            align-items:center;
                            gap:8px;
                        "
                    >
                        <h3>
                            ${escapeHtml(item.name)}
                        </h3>

                        <p class="price">
                            ${escapeHtml(item.price)}
                        </p>
                    </div>

                    ${controls}

                </div>

            </div>
        `;
    }

    // ============================================================
    // RENDER MENU
    //
    // Always creates 2 columns.
    // If there is only one item left, it stays on the left.
    // ============================================================

    function renderMenu(itemsToRender) {

        let html = "";

        for (let i = 0; i < itemsToRender.length; i += 2) {

            const item1 = itemsToRender[i];
            const item2 = itemsToRender[i + 1];

            html += `
                <div class="menu-row">

                    ${createItem(item1)}

                    ${
                        item2
                            ? createItem(item2)
                            : ""
                    }

                </div>
            `;
        }

        menu_items_container.innerHTML = html;
    }

    // Initial menu render
    renderMenu(items);

    // ============================================================
    // CART / ORDER BUTTONS
    // ============================================================

    if (cartBtn) {
        cartBtn.addEventListener("click", () => {
            window.location.href = `/cart/${userId}`;
        });
    }

    if (orderBtn) {
        orderBtn.addEventListener("click", () => {
            window.location.href = `/orders/${userId}`;
        });
    }

    // ============================================================
    // ADD TO CART
    // ============================================================

    menu_items_container.addEventListener("click", async (e) => {

        if (!e.target.classList.contains("add-btn")) {
            return;
        }

        const item = e.target.closest(".menu-item");

        if (!item) {
            return;
        }

        const names = item.querySelector("h3").innerText;
        const price = item.querySelector(".price").innerText;
        const item_id = item.getAttribute("id");

        const available = parseInt(
            item.getAttribute("available")
        );

        const button = item.querySelector(".add-btn");

        // Out of stock
        if (
            !Number.isNaN(available) &&
            available <= 0
        ) {
            alert("This item is currently out of stock");
            return;
        }

        try {

            const res = await fetch("/add_to_cart", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    resid: res_id,
                    userid: userId,
                    item: names,
                    ress_name: decoded,
                    qty: 1,
                    item_id: item_id,
                    price: parseInt(price),
                    replace: false
                })
            });
            const data = await res.json();
            console.log(data);
            
            if (res.status === 401) {
                alert("Unauthorized user. Please log in");
                window.location.href = "/login/user";
                return;
            }

            if (!res.ok) {
                throw new Error(
                    `add_to_cart failed: ${res.status}`
                );
            }

            // const data = await res.json();
            // console.log(data);
            
            if (data.success) {

                button.outerHTML = `
                    <div class="quantity-control">

                        <button class="qty-btn reduce">
                            -
                        </button>

                        <span class="item_qty">
                            1
                        </span>

                        <button class="qty-btn increase">
                            +
                        </button>

                    </div>
                `;

                footer.classList.add("show");
                current_total_amount.innerText = data.Total;

            } else {

                pendingCartItem = {
                    resid: res_id,
                    userid: userId,
                    item: names,
                    ress_name: decoded,
                    qty: 1,
                    item_id: item_id,
                    price: parseInt(price)
                };

                button.innerText = "ADD";

                ReplaceContainer.classList.add("show");
                overlayContainer.classList.add("show");

                message.innerText =
                    data.message || "Please try again";
            }

        } catch (err) {

            console.error(
                "add_to_cart failed",
                err
            );

            alert(
                "Something went wrong adding this item. Please try again."
            );
        }
    });

    // ============================================================
    // QUANTITY UPDATE STATE
    // ============================================================

    const pendingUpdates = new Map();
    const inFlightControllers = new Map();

    function scheduleCartUpdate(
        itemId,
        userId,
        delta,
        qtyEl,
        onSuccess,
        onFailure
    ) {

        let entry = pendingUpdates.get(itemId);

        if (entry) {

            entry.accumulatedDelta += delta;

            clearTimeout(entry.timer);

        } else {

            entry = {
                accumulatedDelta: delta,
                timer: null
            };

            pendingUpdates.set(itemId, entry);
        }

        entry.timer = setTimeout(async () => {

            const netDelta =
                entry.accumulatedDelta;

            pendingUpdates.delete(itemId);

            if (netDelta === 0) {
                return;
            }

            // Cancel older request
            inFlightControllers
                .get(itemId)
                ?.abort();

            const controller =
                new AbortController();

            inFlightControllers.set(
                itemId,
                controller
            );

            try {

                const res = await fetch(
                    "/update_cart",
                    {
                        method: "POST",
                        headers: {
                            "Content-Type":
                                "application/json"
                        },
                        body: JSON.stringify({
                            user_id: userId,
                            item_id: itemId,
                            qty: netDelta
                        }),
                        signal:
                            controller.signal
                    }
                );

                if (!res.ok) {
                    throw new Error(
                        `update_cart failed: ${res.status}`
                    );
                }

                const data =
                    await res.json();

                if (data.success) {

                    onSuccess(data);

                } else {

                    onFailure(
                        data.message ||
                        "Failed updating cart"
                    );
                }

            } catch (err) {

                if (
                    err.name !==
                    "AbortError"
                ) {

                    console.error(
                        "cart update failed",
                        err
                    );

                    onFailure(
                        "Network error"
                    );
                }

            } finally {

                if (
                    inFlightControllers.get(
                        itemId
                    ) === controller
                ) {

                    inFlightControllers.delete(
                        itemId
                    );
                }
            }

        }, 400);
    }

    // ============================================================
    // INCREASE / REDUCE
    // ============================================================

    menu_container.addEventListener(
        "click",
        async (e) => {

            const itemRow =
                e.target.closest(".menu-item");

            if (!itemRow) {
                return;
            }

            const itemId =
                itemRow.id;

            const availableRaw =
                itemRow.getAttribute(
                    "available"
                );

            const item_qty =
                availableRaw !== null &&
                availableRaw !== ""
                    ? parseInt(availableRaw)
                    : Infinity;

            // ----------------------------------------------------
            // INCREASE
            // ----------------------------------------------------

            if (
                e.target.classList.contains(
                    "increase"
                )
            ) {

                const qtyEl =
                    e.target.parentElement
                        .querySelector(
                            ".item_qty"
                        );

                const prevQty =
                    Number(
                        qtyEl.textContent
                    );

                if (
                    prevQty + 1 >
                    item_qty
                ) {

                    alert(
                        `only ${item_qty} in stock`
                    );

                    return;
                }

                // Optimistic update
                qtyEl.textContent =
                    prevQty + 1;

                scheduleCartUpdate(
                    itemId,
                    userId,
                    1,
                    qtyEl,

                    (data) => {

                        if (
                            data.total > 0
                        ) {

                            footer.classList.add(
                                "show"
                            );

                            current_total_amount.innerText =
                                data.total;

                        } else {

                            footer.classList.remove(
                                "show"
                            );
                        }
                    },

                    (msg) => {

                        qtyEl.textContent =
                            prevQty;

                        alert(msg);
                    }
                );
            }

            // ----------------------------------------------------
            // REDUCE
            // ----------------------------------------------------

            else if (
                e.target.classList.contains(
                    "reduce"
                )
            ) {

                const qtyEl =
                    e.target.parentElement
                        .querySelector(
                            ".item_qty"
                        );

                const prevQty =
                    Number(
                        qtyEl.textContent
                    );

                // Optimistic update
                qtyEl.textContent =
                    Math.max(
                        0,
                        prevQty - 1
                    );

                scheduleCartUpdate(
                    itemId,
                    userId,
                    -1,
                    qtyEl,

                    (data) => {

                        if (
                            data.total > 0
                        ) {

                            footer.classList.add(
                                "show"
                            );

                            current_total_amount.innerText =
                                data.total;

                        } else {

                            footer.classList.remove(
                                "show"
                            );
                        }

                        if (
                            data.removed
                        ) {

                            const qtyControl =
                                e.target.closest(
                                    ".quantity-control"
                                );

                            if (qtyControl) {

                                qtyControl.outerHTML = `
                                    <button
                                        class="add-btn"
                                        id="${itemId}">
                                        ADD
                                    </button>
                                `;
                            }
                        }
                    },

                    (msg) => {

                        qtyEl.textContent =
                            prevQty;

                        alert(msg);
                    }
                );
            }
        }
    );

    // ============================================================
    // SEARCH
    // ============================================================

    const searchContainer =
    document.getElementById("searchContainer");

const searchInput =
    document.getElementById("searchInput");

if (searchContainer && searchInput) {

    let searchTimeout;

    searchInput.addEventListener("input", () => {

        const searchTerm = searchInput.value
            .trim()
            .toLowerCase();

        clearTimeout(searchTimeout);

        searchTimeout = setTimeout(() => {

            if (!searchTerm) {
                renderMenu(items);
                return;
            }

            const filteredItems = items.filter(item =>
                item.name
                    .toLowerCase()
                    .includes(searchTerm)
            );

            renderMenu(filteredItems);

        }, 100);
    });
}
});


// ================================================================
// ESCAPE HTML
// ================================================================

function escapeHtml(str) {

    if (
        str === null ||
        str === undefined
    ) {
        return "";
    }

    return String(str)
        .replace(
            /&/g,
            "&amp;"
        )
        .replace(
            /</g,
            "&lt;"
        )
        .replace(
            />/g,
            "&gt;"
        )
        .replace(
            /"/g,
            "&quot;"
        )
        .replace(
            /'/g,
            "&#39;"
        );
}


// ================================================================
// MERGE MENU WITH CART
// ================================================================

function mergeMenuWithCart(data, datas) {
    const cartItems =
        datas?.results?.items || {};

    const merged = Object.entries(data.res).reduce(
        (acc, [name, item]) => {

            acc[item.id] = {
                id: item.id,
                name: name,
                price: item.price,
                file_url: item.file_url,
                item_qty: item.item_qty ?? 0,
                qty: cartItems[item.id]?.qty || 0
            };

            return acc;

        },
        {}
    );

    return merged;
}

// ================================================================
// CART UPDATE STATE
// ================================================================
//
// Kept here if you need these globally elsewhere.
// ================================================================

// const pendingUpdates = new Map();
// const inFlightControllers = new Map();




let map;
let marker;
let userLatt = null;
let userLong = null;

function getRestaurantCacheKey(userId) {
    return `cachedRestaurants_${userId}`;
}

// Basic HTML-escaping so restaurant/address/suggestion data from the API
// can never break out of the markup it's injected into (XSS guard).
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// addListenerOnce(): prevents the same handler from being bound multiple
// times when initHomePage() re-runs (SPA re-navigation, request_location
// click, etc.) without the DOM node being recreated.
function addListenerOnce(el, event, handler) {
    if (!el) return;
    const key = `bound_${event}`;
    if (el.dataset[key]) return;
    el.dataset[key] = "true";
    el.addEventListener(event, handler);
}

function renderRestaurants(results, containers) {
    const { display_resturants, no_results_container } = containers;

    if (!results || Object.keys(results).length === 0) {
        display_resturants.innerHTML = "";
        no_results_container.style.display = "block";
        return;
    }

    no_results_container.style.display = "none";
    const html = Object.entries(results).map(([id, detail]) => `
        <div class="card" id=${escapeHtml(id)}>
            <div class="card-img">
                <img src=${escapeHtml(detail.file_url)} alt="Food">
            </div>
            <div class="card-details">
                <h3 class="resturant_name" >${escapeHtml(detail.res_name)}</h3>
                <p class="rating"><i class="fa-solid fa-circle-star"></i> 4.2 • 25-30 mins</p>
                <p class="cuisine">Burgers, American</p>
                <p class="area">${escapeHtml(detail.address)}</p>
            </div>
        </div>`).join("");
    display_resturants.innerHTML = html;
}

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject("Geolocation is not supported by your browser");
            return; // bugfix: without this, code fell through and called
                     // navigator.geolocation.getCurrentPosition on undefined
        }
        navigator.geolocation.getCurrentPosition(resolve, reject);
    });
}

async function reverseGeocode(lat, lon) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
    );
    if (!response.ok) throw new Error(`reverseGeocode failed: ${response.status}`);
    const data = await response.json();
    // return data.display_name;
    return data.display_name.split(',').slice(0, 2).join(',');
}

// change(): re-fetches restaurants for a newly picked location. Kept at
// module scope (not inside initHomePage) since it's referenced by click
// handlers that get attached fresh each time initHomePage runs.
async function change(latt, long) {
    const display_resturants = document.getElementById("resturants_container");
    const pathParts = window.location.pathname.split("/");
    const userId = window.APP_USER_ID || pathParts[pathParts.length - 1];
    const no_results_container = document.getElementById("no-results-container");
    const access_denied_container = document.getElementById("deny");
    const Note = document.getElementById("Note");
    const loading = document.getElementById("loading");
    const currentAddress = document.getElementById("currentAddress");

    try {
        userLatt = latt;
        userLong = long;

        const address = await reverseGeocode(userLatt, userLong);

        currentAddress.dataset.long = userLong;
        currentAddress.dataset.lat = userLatt;
        currentAddress.textContent = address;
        const userLocation = { latt: userLatt, long: userLong };
        localStorage.setItem("currentAddress", address);
        localStorage.setItem("userLocation", JSON.stringify(userLocation));
        if (loading) loading.style.visibility = "visible";

        const res = await fetch("/list_resturants", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ latt: userLatt, long: userLong, dist: 5 })
        });
        if (!res.ok) throw new Error(`list_resturants failed: ${res.status}`);
        const data = await res.json();
        console.log(data,datas);
        
        if (data.success) {
            if (loading) loading.style.display = "none";
            if (Note) Note.style.display = "block";
            renderRestaurants(data.results, { display_resturants, no_results_container });
            sessionStorage.setItem(getRestaurantCacheKey(userId), JSON.stringify(data.results));
        } else {
            alert("error loading resturants");
        }
    } catch (e) {
        console.error("change() failed", e);
        if (access_denied_container) access_denied_container.style.visibility = "visible";
        if (Note) Note.style.display = "none";
    }
}

async function getLocation() {
    const currentAddress = document.getElementById("currentAddress");
    if (!currentAddress || !map) return;
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
        async (position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            try {
                const address = await reverseGeocode(lat, lng);
                currentAddress.dataset.long = lng;
                currentAddress.dataset.lat = lat;
                currentAddress.textContent = address;
                localStorage.setItem("currentAddress", address);
                const userLocation = { latt: lat, long: lng };
                localStorage.setItem("userLocation", JSON.stringify(userLocation));
                map.setView([lat, lng], 15);
                if (marker) marker.setLatLng([lat, lng]); else marker = L.marker([lat, lng]).addTo(map);
            } catch (e) {
                console.error("getLocation reverse geocode failed", e);
            }
        },
        () => alert("Location access denied")
    );
}

async function initHomePage() {
    console.log("init home page");
    
    // const display_resturants = document.getElementById("resturants_container");
    // if (!display_resturants) return; // safety: not actually on the home content
    console.log("step 2");
    
    const cartBtn = document.getElementById("CartBtn");
    const orderBtn = document.getElementById("OrdersBtn");
    const pathParts = window.location.pathname.split("/");
    const no_results_container = document.getElementById("no-results-container");
    const select_options = document.getElementById("distance_options");
    const access_denied_container = document.getElementById("deny");
    const Note = document.getElementById("Note");
    const loading = document.getElementById("loading");
    const request_location = document.getElementById("requestlocation");
    const currentAddress = document.getElementById("currentAddress");
    const livelocationBtn = document.getElementById("liveLocationBtn");
    const loading_container = document.getElementById("loading_container");
    const savedAddress = document.getElementById("savedAddress");
    const userId = window.APP_USER_ID || pathParts[pathParts.length - 1];
    const maps_btn = document.getElementById("map_btn");
    const cancelbtn = document.getElementById("closeModal");

    const CACHE_KEY = getRestaurantCacheKey(userId);

    // Show cached restaurants instantly — this is what makes tab-switching feel instant
    const cachedRestaurants = sessionStorage.getItem(CACHE_KEY);
    if (cachedRestaurants) {
        try {
            renderRestaurants(JSON.parse(cachedRestaurants), renderContainers);
            if (Note) Note.style.display = "block";
            if (loading) loading.style.display = "none";
        } catch (e) {
            console.warn("bad restaurant cache, ignoring", e);
        }
    }

    // (Re)create the Leaflet map fresh every time — its old DOM node was just
    // discarded by the router's content swap, so the old instance is dead anyway.
    if (map) { try { map.remove(); } catch (e) { } }
    marker = null; // bugfix: old marker belonged to the removed map instance
    map = L.map('map').setView([17.3850, 78.4867], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map);
    console.log("holla");
    
    addListenerOnce(select_options, "change", async (e) => {
        const storedLocation = JSON.parse(localStorage.getItem("userLocation"));
        try {
            const res = await fetch("/list_resturants", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ latt: storedLocation.latt, long: storedLocation.long, dist: e.target.value })
            });
            if (!res.ok) throw new Error(`list_resturants failed: ${res.status}`);
            const data = await res.json();
            if (data.success) {
                renderRestaurants(data.results, renderContainers);
                sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.results));
            } else {
                alert("error loading resturants");
            }
        } catch (err) {
            console.error("distance filter failed", err);
            alert("error loading resturants");
        }
    });

    try {
        const fetchlocation = JSON.parse(localStorage.getItem("userLocation"));
        if (fetchlocation === null) {
            // await getLocation();
            const position=await getPosition()
            userLatt = position.coords.latitude;
            userLong = position.coords.longitude;
            const address = await reverseGeocode(userLatt, userLong);
            currentAddress.dataset.long = userLong;
            currentAddress.dataset.lat = userLatt;
            currentAddress.textContent = address;
            localStorage.setItem("currentAddress", address);
            const userLocation = { latt: userLatt, long: userLong };
            localStorage.setItem("userLocation", JSON.stringify(userLocation));
        } else {
            let locationFound = false;
            const previoussavedAddress = localStorage.getItem("currentAddress");

            // bugfix: was fetchlocation.lat (undefined) — the stored key is "latt"
            if (
                previoussavedAddress &&
                fetchlocation.latt !== null &&
                fetchlocation.long !== null
            ) {
                currentAddress.textContent = previoussavedAddress;
                currentAddress.dataset.long = fetchlocation.long;
                currentAddress.dataset.lat = fetchlocation.latt;
                userLatt = parseFloat(fetchlocation.latt);
                userLong = parseFloat(fetchlocation.long);
                locationFound = true;
            }

            const addressRes = await fetch("/fetch_address", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId })
            });
            if (addressRes.status === 401) {
                alert("Please log in.");
                localStorage.clear();
                window.location.href = "/login/user";
                return;
            }
            const data = await addressRes.json();

            if (data.success && data.address.length > 0) {
                if (locationFound === false) {
                    currentAddress.textContent = data.address[0].adrs_type + " - " + data.address[0].address;
                    currentAddress.dataset.long = data.address[0].coordinates.long;
                    currentAddress.dataset.lat = data.address[0].coordinates.latt;
                    userLatt = parseFloat(data.address[0].coordinates.latt);
                    userLong = parseFloat(data.address[0].coordinates.long);
                    localStorage.setItem("currentAddress", data.address[0].address);

                    const userLocation = { latt: userLatt, long: userLong };
                    localStorage.setItem("userLocation", JSON.stringify(userLocation));
                }

                // bugfix: clear stale entries before rebuilding, or this list
                // grows every time initHomePage() re-runs
                savedAddress.innerHTML = "";
                data.address.forEach((addr) => {
                    savedAddress.innerHTML += `
                        <div class="address" data-latt=${escapeHtml(addr.coordinates.latt)} data-long=${escapeHtml(addr.coordinates.long)}>
                            <span class="type">${escapeHtml(addr.adrs_type)}</span>
                            <span class="address-text">${escapeHtml(addr.address)}</span>
                        </div>
                    `;
                });
            } else {
                if (data.status === 404) {
                    savedAddress.innerHTML = "No saved Addresses";
                } else {
                    await getLocation();
                }
            }
        }

        if (!cachedRestaurants && loading) loading.style.visibility = "visible";
        // const res = await fetch("/list_resturants", {
        //     method: "POST",
        //     headers: { "Content-Type": "application/json" },
        //     body: JSON.stringify({ latt: userLatt, long: userLong, dist: 5 })
        // });
        // if (!res.ok) throw new Error(`list_resturants failed: ${res.status}`);
        // const data = await res.json();
        // if (data.success) {
        // } else if (!cachedRestaurants) {
        //     alert("error loading resturants");
        // }
        if (loading) loading.style.display = "none";
        if (Note) Note.style.display = "block";
        // sessionStorage.setItem(CACHE_KEY, JSON.stringify(data.results));

        // addListenerOnce(display_resturants, "click", function (e) {
        //     const card = e.target.closest(".card");
        //     if (card) {
        //         const name = card.querySelector(".resturant_name").textContent;
        //         const addresss = card.querySelector(".area").textContent;
        //         const res_id = card.getAttribute("id");
        //         window.location.href = `/menu/${encodeURIComponent(name)}/${encodeURIComponent(addresss)}/${encodeURIComponent(res_id)}/${encodeURIComponent(userId)}`;
        //     }
        // });
        // addListenerOnce(cartBtn, "click", () => { window.location.href = `/cart/${userId}`; });
        // addListenerOnce(orderBtn, "click", () => { window.location.href = `/orders/${userId}`; });
    } catch (e) {
        console.error("initHomePage location/restaurant load failed", e);
        if (!cachedRestaurants && Note) Note.style.display = "none";
    }

    addListenerOnce(cancelbtn, "click", () => {
        document.getElementById("addressTagModal").classList.remove("show");
    });

    addListenerOnce(savedAddress, "click", async (e) => {
        const selected_address = e.target.closest(".address");
        if (!selected_address) return;
        const latt = parseFloat(selected_address.dataset.latt);
        const long = parseFloat(selected_address.dataset.long);
        await change(latt, long);
        const addressType = selected_address.querySelector(".type").textContent;
        const addressText = selected_address.querySelector(".address-text").textContent;
        currentAddress.textContent = addressType + " - " + addressText;
        const box = document.getElementById("locationBox");
        const overlay = document.getElementById("locationOverlay");
        if (box) box.classList.remove("show");
        if (overlay) overlay.classList.remove("show");
    });

    addListenerOnce(request_location, "click", async () => {
        try {
            await getLocation();
            initHomePage(); // re-run instead of a full reload
        } catch (err) {
            console.error("request_location failed", err);
        }
    });

    const indicator = document.querySelector(".active-indicator");
    function moveIndicator(btn) {
        if (!indicator || !btn) return;
        const x = btn.offsetLeft + (btn.offsetWidth - indicator.offsetWidth) / 2;
        indicator.style.transform = `translateX(${x}px)`;
    }
    document.querySelectorAll(".nav-btn").forEach(btn => {
        addListenerOnce(btn, "click", () => {
            document.querySelector(".nav-btn.active")?.classList.remove("active");
            btn.classList.add("active");
            moveIndicator(btn);
        });
    });
    moveIndicator(document.querySelector(".nav-btn.active"));

    const input = document.getElementById("addressInput");
    const suggestions = document.getElementById("suggestions");
    let timeout;
    let suggestAbortController = null;
    addListenerOnce(input, "input", () => {
        savedAddress.classList.remove("show");
        clearTimeout(timeout);
        timeout = setTimeout(async () => {
            const query = input.value.trim();
            if (query.length < 3) { suggestions.innerHTML = ""; return; }
            if (suggestAbortController) suggestAbortController.abort();
            suggestAbortController = new AbortController();
            try {
                const response = await fetch(
                    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ", Hyderabad")}&countrycodes=in&addressdetails=1&limit=5`,
                    { signal: suggestAbortController.signal }
                );
                if (!response.ok) throw new Error(`suggest search failed: ${response.status}`);
                const results = await response.json();
                suggestions.innerHTML = results.map(place => {
                    const displayParts = place.display_name.split(",");
                    const title = displayParts[0].trim();
                    const subtitle = displayParts.slice(1, 3).join(", ");
                    return `
            <div class="suggestion-item" data-lat="${escapeHtml(place.lat)}" data-lon="${escapeHtml(place.lon)}" data-address="${escapeHtml(title + ", " + subtitle)}">
                <i class="fa-solid fa-location-dot"></i>
                <div>
                    <div class="location-title">${escapeHtml(title)}</div>
                    <div class="location-subtitle">${escapeHtml(subtitle)}</div>
                </div>
            </div>`;
                }).join("");
            } catch (err) {
                if (err.name === "AbortError") return;
                console.error(err);
                suggestions.innerHTML = "<div class='suggestion-item'>Unable to fetch locations</div>";
            }
        }, 300);
    });

    const trigger = document.getElementById("locationTrigger");
    const box = document.getElementById("locationBox");
    const overlay = document.getElementById("locationOverlay");
    addListenerOnce(trigger, "click", () => {
        box.classList.add("show");
        overlay.classList.add("show");
        savedAddress.classList.add("show");
        document.getElementById("addressInput").focus();
    });
    addListenerOnce(overlay, "click", () => {
        box.classList.remove("show");
        overlay.classList.remove("show");
    });

    addListenerOnce(suggestions, "click", (e) => {
        const item = e.target.closest(".suggestion-item");
        if (!item) return;
        document.getElementById("currentAddress").textContent = item.dataset.address;
        localStorage.setItem("selectedAddress", item.dataset.address);
        document.getElementById("addressTagModal").classList.add("show");
        box.classList.remove("show");
        overlay.classList.remove("show");
        change(parseFloat(item.dataset.lat), parseFloat(item.dataset.lon));
    });

    document.querySelectorAll(".tag-btn").forEach(btn => {
        addListenerOnce(btn, "click", async () => {
            const addressType = btn.dataset.tag;
            const address = document.getElementById("currentAddress").textContent;
            const address_latt = document.getElementById("currentAddress").dataset.lat;
            const address_long = document.getElementById("currentAddress").dataset.long;
            const cordinates = { latt: address_latt, long: address_long };
            document.getElementById("addressTagModal").classList.remove("show");
            try {
                const res = await fetch("/save_address", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address: address, address_type: addressType, userId: userId, cordinates: cordinates })
                });
                if (!res.ok) throw new Error(`save_address failed: ${res.status}`);
            } catch (err) {
                console.error("save_address failed", err);
            }
            currentAddress.textContent = addressType + " - " + address;
        });
    });
     const searchInput = document.getElementById("searchInput");
    searchInput.addEventListener("input", () => {
        const searchTerm = searchInput.value.toLowerCase();
        document.querySelectorAll(".card").forEach(card => {
            const restaurantName = card.querySelector(".resturant_name").textContent.toLowerCase();
            card.style.display = restaurantName.includes(searchTerm) ? "block" : "none";
        });
    });
    addListenerOnce(livelocationBtn, "click", async () => {
        // console.log("in live location btn");
        
        box.classList.remove("show");
        loading_container.classList.add("show");
        try {
            const livelctn = await getPosition();
            const userLocation = { latt: livelctn.coords.latitude, long: livelctn.coords.longitude };
            localStorage.setItem("userLocation", JSON.stringify(userLocation));
            await change(livelctn.coords.latitude, livelctn.coords.longitude);
            // document.getElementById("addressTagModal").classList.add("show");
        } catch (err) {
            console.error("live location failed", err);
            alert("Location access denied");
        } finally {
            
            document.getElementById("addressTagModal").classList.add("show");
            loading_container.classList.remove("show");
            overlay.classList.remove("show");
        }
    });

    const map_container = document.getElementById("map_container");
    map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        try {
            const address = await reverseGeocode(lat, lng);
            currentAddress.dataset.long = userLong;
            currentAddress.dataset.lat = userLatt;
            currentAddress.textContent = address;
            await change(lat, lng);
            document.getElementById("addressTagModal").classList.add("show");
        } catch (err) {
            console.error("map click reverse geocode failed", err);
        }
        if (marker) marker.setLatLng(e.latlng); else marker = L.marker(e.latlng).addTo(map);
        setTimeout(() => {
            box.classList.remove("show");
            overlay.classList.remove("show");
            maps_btn.setAttribute("is_active", false);
            map_container.style.display = "none";
            map_container.style.position = "absolute";
        }, 1000);
    });

    addListenerOnce(maps_btn, "click", async () => {
        if (maps_btn.getAttribute("is_active") === "false") {
            maps_btn.setAttribute("is_active", true);
            map_container.style.display = "block";
            map_container.style.position = "relative";
            savedAddress.classList.remove("show");
            setTimeout(() => { map.invalidateSize(); }, 100);
            await getLocation();
        } else {
            maps_btn.setAttribute("is_active", false);
            map_container.style.display = "none";
            map_container.style.position = "absolute";
        }
    });
}

// Run on this page's first real load...
initHomePage();
// ...and re-run every time the SPA router swaps Home back into view
document.addEventListener("spa:pageload", (e) => {
    if (e.detail.page === "home") initHomePage();
});