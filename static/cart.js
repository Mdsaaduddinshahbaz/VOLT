let pendingUpdatess = new Map();       // itemId -> { timer, accumulatedDelta }
let inFlightControllerss = new Map();

function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject("Geolocation is not supported by your browser");
            return; // bugfix: without this we'd still call getCurrentPosition on undefined
        }

        navigator.geolocation.getCurrentPosition(resolve, reject);
    });
}

async function reverseGeocode(lat, lon) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
    );

    const data = await response.json();
    const address = data.address;

    return `${address.suburb || ""}, ${address.city || address.town || ""}`;
}

function isValidPhone(phone) {
    // 10-digit Indian mobile number, optionally prefixed with +91 / 91 / 0
    return /^(?:\+?91|0)?[6-9]\d{9}$/.test((phone || "").trim());
}

function normalizePhone(phone) {
    return (phone || "").replace(/^(?:\+?91|0)/, "").trim();
}

function scheduleCartUpdate(itemId, userId, delta, onSuccess, onFailure) {
    let entry = pendingUpdatess.get(itemId);

    if (entry) {
        // Fold this click into the pending batch
        entry.accumulatedDelta += delta;
        clearTimeout(entry.timer);
    } else {
        entry = { accumulatedDelta: delta, timer: null };
        pendingUpdatess.set(itemId, entry);
    }

    // Latest call's onSuccess/onFailure wins, since only the final (non-cleared)
    // timer for this item ever fires.
    entry.timer = setTimeout(async () => {
        const netDelta = entry.accumulatedDelta;
        pendingUpdatess.delete(itemId); // clear before await so new clicks start a fresh batch

        // Clicks cancelled each other out (e.g. +1 then -1) — UI is already correct
        // from the optimistic updates, nothing to send to the server.
        if (netDelta === 0) return;

        // Cancel any older in-flight request for this item so responses can't race.
        inFlightControllerss.get(itemId)?.abort();
        const controller = new AbortController();
        inFlightControllerss.set(itemId, controller);

        try {
            const res = await fetch("/update_cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, item_id: itemId, qty: netDelta }),
                signal: controller.signal
            });

            if (!res.ok) throw new Error(`update_cart failed: ${res.status}`);
            const data = await res.json();

            if (data.success) {
                onSuccess(data);
            } else {
                onFailure(data.message || "Failed updating cart");
            }
        } catch (err) {
            if (err.name !== "AbortError") {
                console.error("cart update failed", err);
                onFailure("Network error");
            }
        } finally {
            if (inFlightControllerss.get(itemId) === controller) {
                inFlightControllerss.delete(itemId);
            }
        }
    }, 400); // debounce window — tune to taste (300-500ms feels good)
}

async function initCartPage() {

    const cart_items_container = document.getElementById("cart_items");
    if (!cart_items_container) return;

    const pathParts = window.location.pathname.split("/");
    const userId = window.APP_USER_ID || pathParts[pathParts.length - 1];

    const res_info = document.querySelector(".res-info");
    const heading = res_info.querySelector("h4");

    const placeorder = document.getElementById("placeorder");
    const orderBtn = document.getElementById("orderBtn");
    const totalPrice = document.getElementById("totalPrice");
    const toPay = document.getElementById("toPay");

    const addressChgBtn = document.getElementById("ChangeAdrs");
    const deliveryAdrs = document.getElementById("Deliveryaddress");
    const deliveryPhone = document.getElementById("deliveryPhone");
    const typeaddrs = document.getElementById("type");

    const box = document.getElementById("addressOptions");
    const overlay = document.getElementById("locationOverlay"); // bugfix: this was never assigned before
    const savedAddressList = document.getElementById("savedAddressList");
    const addAddressBtn = document.getElementById("addAddressBtn");
    const addAddressForm = document.getElementById("addAddressForm");
    const newAddrType = document.getElementById("newAddrType");
    const newAddrText = document.getElementById("newAddrText");
    const newAddrPhone = document.getElementById("newAddrPhone");
    const useLocationForNewAddr = document.getElementById("useLocationForNewAddr");
    const saveAddressBtn = document.getElementById("saveAddressBtn");
    const cancelAddressBtn = document.getElementById("cancelAddressBtn");

    const loading_container = document.getElementById("loading_container");
    const no_order_container = document.getElementById("No_orders_container");
    const cartContainer = document.querySelector(".cart-container");

    heading.innerText = "Order List";

    const CART_CACHE_KEY = `cachedCart_${userId}`;
    const SELECTED_ADDR_KEY = `selectedAddress_${userId}`;

    let restaurants = {};
    let newAddrCoords = null; // { lat, long } picked up from "use current location" inside the form
    let editingIdx = null; // index into `addresses` when the form is editing an existing one, else null

    // ---------------------------------------------------------------
    // Cart rendering
    // ---------------------------------------------------------------

    function renderCart(cart) {

        if (!cart || Object.keys(cart).length === 0) {

            cart_items_container.innerHTML = "";

            const cl = cartContainer.querySelector(".cart-left");
            const cr = cartContainer.querySelector(".cart-right");

            if (cl) cl.outerHTML = "";
            if (cr) cr.outerHTML = "";

            cartContainer.style.display = "block";
            no_order_container.classList.add("show");

            totalPrice.innerText = 0;
            toPay.innerText = 0;

            return 0;
        }

        no_order_container.classList.remove("show");

        let total = 0;

        const html = Object.entries(cart).map(([item_id, detail]) => {
            total += detail.price * detail.qty;

            const atMax = detail.available_qty != null && detail.qty >= detail.available_qty;

            return `
                <div class="cart-item" id="${item_id}">
                    <span class="veg-icon">
                        <i class="fa-regular fa-circle-stop"></i>
                    </span>

                    <span class="item-name">
                        ${detail.name}
                    </span>

                    <div class="quantity-control">
                        <button class="qty-btn reduce">-</button>
                        <span class="item_qty">${detail.qty}</span>
                        <button class="qty-btn increase" ${atMax ? "disabled" : ""}>+</button>
                    </div>

                    <span class="unit-price">${detail.price}</span>
                    <span class="item-price">${detail.price * detail.qty}</span>
                </div>
            `;
        }).join("");

        cart_items_container.innerHTML = html;
        totalPrice.innerText = total;
        toPay.innerText = total;

        return total;
    }

    function persistCart() {
        sessionStorage.setItem(CART_CACHE_KEY, JSON.stringify(restaurants));
    }

    // Applies an optimistic qty change locally; returns the pre-change snapshot
    // so it can be restored if the server call fails.
    function changeQty(itemId, delta) {
        const item = restaurants[itemId];
        if (!item) return;

        if (delta > 0 && item.available_qty != null && item.qty + delta > item.available_qty) {
            alert(`Only ${item.available_qty} in stock`);
            return;
        }

        const snapshot = { ...item };
        const newQty = item.qty + delta;

        if (newQty <= 0) {
            delete restaurants[itemId];
        } else {
            item.qty = newQty;
        }

        renderCart(restaurants);
        persistCart();

        scheduleCartUpdate(itemId, userId, delta,
            (data) => {
                // Server is the source of truth for remaining stock, if it sends one back.
                if (data.available_qty != null && restaurants[itemId]) {
                    restaurants[itemId].available_qty = data.available_qty;
                    renderCart(restaurants);
                }
            },
            (msg) => {
                restaurants[itemId] = snapshot;
                renderCart(restaurants);
                persistCart();
                alert(msg || "Something went wrong updating your cart, please try again.");
            }
        );
    }

    const cachedCart = sessionStorage.getItem(CART_CACHE_KEY);

    if (cachedCart) {
        try {
            restaurants = JSON.parse(cachedCart);
            renderCart(restaurants);
        } catch (e) {
            console.warn("bad cart cache, ignoring", e);
        }
    }

    const shopBtn = document.getElementById("shopBtn");
    if (shopBtn) {
        shopBtn.addEventListener("click", () => {
            window.location.href = `/user/${userId}`;
        });
    }

    const res = await fetch("/get_cart_items", {
        method: "POST",
        headers: { "Content-type": "application/json" },
        body: JSON.stringify({ userid: userId })
    });

    if (res.status == 401) {
        alert("unauthorized User,Please Log in");
        window.location.href = "/login/user";
        return;
    }

    const data = await res.json();

    if (data.success) {
        /*
            NEW CART STRUCTURE:
            data.results = {
                items: { item_id: { name, price, qty, available_qty } },
                total,
                uid
            }
        */
        restaurants = data.results?.items || {};
        persistCart();
        renderCart(restaurants);
    } else if (!cachedCart) {
        renderCart({});
    }

    cartContainer.addEventListener("click", (e) => {

        if (!e.target.classList.contains("qty-btn") || e.target.disabled) return;

        const itemRow = e.target.closest(".cart-item");
        if (!itemRow) return;

        const itemId = itemRow.id;

        if (e.target.classList.contains("increase")) {
            changeQty(itemId, +1);
        } else if (e.target.classList.contains("reduce")) {
            changeQty(itemId, -1);
        }
    });

    // ---------------------------------------------------------------
    // Address management
    // ---------------------------------------------------------------

    let addresses = []; // [{ _id, adrs_type, address, phone, coordinates: { long, latt } }]
    let selectedAddressId = null;

    function applySelectedAddress(addr) {
        console.log(addr);
        
        typeaddrs.innerText = `${addr.adrs_type} -`; // kept for scripts/analytics that may read it; hidden in cart.css
        deliveryAdrs.textContent = `${addr.adrs_type} - ${addr.address}`;
        deliveryPhone.textContent = addr.phone ? `📞 ${addr.phone}` : "";

        deliveryAdrs.dataset.long = addr.coordinates?.long ?? "";
        deliveryAdrs.dataset.lat = addr.coordinates?.latt ?? "";
        deliveryAdrs.dataset.phone = addr.phone ?? "";
        deliveryAdrs.dataset.type = addr.adrs_type ?? "";

        selectedAddressId = addr._id ?? null;
        localStorage.setItem(SELECTED_ADDR_KEY, JSON.stringify(addr));
    }

    function renderAddressList() {
        savedAddressList.innerHTML = addresses.map((addr, idx) => `
            <div class="address-option" data-idx="${idx}">
                <div class="address-option-main">
                    <span class="address-type">${addr.adrs_type}</span>
                    <span class="address-text">${addr.address}</span>
                    <span class="address-phone ${addr.phone ? "" : "missing"}" data-idx="${idx}">
                        ${addr.phone ? `📞 ${addr.phone}` : "⚠️ Add a phone number"}
                    </span>
                </div>
                <div class="address-option-actions">
                    <button type="button" class="address-edit-btn" data-idx="${idx}" title="Edit address">✎</button>
                    <button type="button" class="address-delete-btn" data-idx="${idx}" title="Remove address">✕</button>
                </div>
            </div>
        `).join("");
    }

    function openEditForm(idx) {
        const addr = addresses[idx];
        if (!addr) return;

        editingIdx = idx;
        newAddrType.value = addr.adrs_type || "Home";
        newAddrText.value = addr.address || "";
        newAddrPhone.value = addr.phone || "";
        newAddrCoords = addr.coordinates
            ? { lat: addr.coordinates.latt, long: addr.coordinates.long }
            : null;

        saveAddressBtn.textContent = "Update Address";
        addAddressForm.classList.add("show");
        newAddrPhone.focus();
    }

    savedAddressList.addEventListener("click", async (e) => {
        const phoneSpan = e.target.closest(".address-phone.missing");
        if (phoneSpan) {
            openEditForm(Number(phoneSpan.dataset.idx));
            return;
        }

        const editBtn = e.target.closest(".address-edit-btn");
        if (editBtn) {
            openEditForm(Number(editBtn.dataset.idx));
            return;
        }

        const delBtn = e.target.closest(".address-delete-btn");
        if (delBtn) {
            const idx = Number(delBtn.dataset.idx);
            const addr = addresses[idx];
            if (!addr) return;
            if (!confirm("Remove this address?")) return;

            try {
                const delRes = await fetch("/delete_address", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ user_id: userId, address_id: addr._id })
                });
                const delData = await delRes.json();
                if (!delData.success) {
                    alert(delData.message || "Could not remove address");
                    return;
                }
            } catch (err) {
                console.error(err);
                alert("Network error while removing address");
                return;
            }

            addresses.splice(idx, 1);
            renderAddressList();
            return;
        }

        const option = e.target.closest(".address-option");
        if (!option) return;

        const idx = Number(option.dataset.idx);
        const addr = addresses[idx];
        if (!addr) return;

        applySelectedAddress(addr);
        closeAddressPanel();
    });

    function openAddressPanel() {
        box.classList.add("show");
        overlay.classList.add("show");
    }

    function closeAddressPanel() {
        box.classList.remove("show");
        overlay.classList.remove("show");
        addAddressForm.classList.remove("show");
    }

    overlay.addEventListener("click", closeAddressPanel);

    addressChgBtn.addEventListener("click", () => {
        openAddressPanel();
    });

    addAddressBtn.addEventListener("click", () => {
        editingIdx = null;
        newAddrType.value = "Home";
        newAddrText.value = "";
        newAddrPhone.value = "";
        newAddrCoords = null;
        saveAddressBtn.textContent = "Save Address";
        addAddressForm.classList.add("show");
    });

    cancelAddressBtn.addEventListener("click", () => {
        editingIdx = null;
        saveAddressBtn.textContent = "Save Address";
        addAddressForm.classList.remove("show");
    });

    useLocationForNewAddr.addEventListener("click", async () => {
        try {
            useLocationForNewAddr.disabled = true;
            useLocationForNewAddr.textContent = "Locating...";

            const livelctn = await getPosition();
            const lat = livelctn.coords.latitude;
            const long = livelctn.coords.longitude;

            const address = await reverseGeocode(lat, long);

            newAddrText.value = address;
            newAddrCoords = { lat, long };

        } catch (error) {
            console.error("Location error:", error);
            alert("Unable to get your location. You can still type the address manually.");
        } finally {
            useLocationForNewAddr.disabled = false;
            useLocationForNewAddr.textContent = "📍 Use Current Location";
        }
    });

    saveAddressBtn.addEventListener("click", async () => {
        const adrs_type = newAddrType.value;
        const address = newAddrText.value.trim();
        const phone = normalizePhone(newAddrPhone.value);

        if (!address) {
            alert("Please enter an address");
            return;
        }
        if (!isValidPhone(phone)) {
            alert("Please enter a valid 10-digit phone number for this address");
            return;
        }
        if (!newAddrCoords) {
            alert("Please tap \"Use Current Location\" so we can pinpoint this address");
            return;
        }

        const coordinates = { long: newAddrCoords.long, latt: newAddrCoords.lat };
        const isEditing = editingIdx !== null;
        const existingAddr = isEditing ? addresses[editingIdx] : null;

        const payload = isEditing
            ? { user_id: userId, address_id: existingAddr._id, adrs_type, address, phone, coordinates }
            : { user_id: userId, adrs_type, address, phone, coordinates };

        const endpoint = isEditing ? "/update_address" : "/save_address";

        saveAddressBtn.disabled = true;
        try {
            const saveRes = await fetch(endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
            const saveData = await saveRes.json();

            if (!saveData.success) {
                alert(saveData.message || "Could not save address");
                return;
            }

            const savedAddr = saveData.address || {
                _id: isEditing ? existingAddr._id : `local_${Date.now()}`,
                adrs_type, address, phone, coordinates
            };

            if (isEditing) {
                addresses[editingIdx] = savedAddr;
            } else {
                addresses.push(savedAddr);
            }
            renderAddressList();

            // If we just edited the address that's currently applied to this
            // order (e.g. added a phone number to it), refresh the display too.
            if (isEditing && existingAddr._id === selectedAddressId) {
                applySelectedAddress(savedAddr);
            } else if (!isEditing) {
                applySelectedAddress(savedAddr);
            }

            editingIdx = null;
            saveAddressBtn.textContent = "Save Address";
            closeAddressPanel();

        } catch (err) {
            console.error(err);
            alert("Network error while saving address");
        } finally {
            saveAddressBtn.disabled = false;
        }
    });

    // Fetch saved addresses
    const addressRes = await fetch("/fetch_address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId })
    });

    const addressData = await addressRes.json();

    if (addressData.success && addressData.address?.length) {
        addresses = addressData.address;
        renderAddressList();
    }

    // Restore previously selected address if we have one, otherwise fall back
    // to the first saved address.
    let restoredSelection = null;
    try {
        restoredSelection = JSON.parse(localStorage.getItem(SELECTED_ADDR_KEY));
    } catch (e) {
        restoredSelection = null;
    }

    if (restoredSelection && restoredSelection.address) {
        applySelectedAddress(restoredSelection);
    } else if (addresses.length) {
        applySelectedAddress(addresses[0]);
    }

    // ---------------------------------------------------------------
    // Place order
    // ---------------------------------------------------------------

    placeorder.addEventListener("click", async () => {

        const remainingItems = document.querySelectorAll(".cart-item");
        if (remainingItems.length === 0) {
            alert("Your cart is empty");
            return;
        }

        const longitude = deliveryAdrs.dataset.long;
        const latitude = deliveryAdrs.dataset.lat;
        const phone = deliveryAdrs.dataset.phone;

        if (!longitude || !latitude) {
            alert("Please choose a delivery address first");
            openAddressPanel();
            return;
        }
        if (!isValidPhone(phone)) {
            alert("Please add a phone number for this delivery address");
            openAddressPanel();
            return;
        }

        const selectedPayment = document.querySelector('input[name="payment"]:checked')?.value || "cash";

        const res = await fetch("/store_orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                user_id: userId,
                items: restaurants,
                coordinates: { long: longitude, latt: latitude },
                number: phone,
                payment_method: selectedPayment
            })
        });

        const data = await res.json();

        if (data.success) {
            alert("order placed");
            sessionStorage.removeItem(CART_CACHE_KEY);
            sessionStorage.removeItem(`cachedOrders_${userId}`);
            window.location.href = `/orders/${userId}`;
        } else {
            alert("error while placing order");
            initCartPage();
        }
    });

    if (orderBtn) {
        orderBtn.addEventListener("click", () => {
            window.location.href = `/orders/${userId}`;
        });
    }
}

// Run on this page's first real load...
initCartPage();

// ...and re-run every time the SPA router swaps Cart back into view
document.addEventListener("spa:pageload", (e) => {
    if (e.detail.page === "cart") {
        initCartPage();
    }
});