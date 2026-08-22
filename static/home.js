// One pending (not-yet-sent) batch per item, and one in-flight-request tracker per item.
// pendingUpdates handles debouncing rapid clicks; inFlightControllers cancels a request
// that's already been sent if a newer batch needs to go out before the old one resolves.
let pendingUpdates = new Map();       // itemId -> { timer, accumulatedDelta }
let inFlightControllers = new Map();  // itemId -> AbortController
let map;
let marker;
let userLatt = null;
let userLong = null;
let currentAddress = document.getElementById("currentAddress");
const cancelbtn = document.getElementById("closeModal");
// const loading_container = document.getElementById("loading_container");
function addListenerOnce(el, event, handler) {
    if (!el) return;
    const key = `bound_${event}`;
    if (el.dataset[key]) return;
    el.dataset[key] = "true";
    el.addEventListener(event, handler);
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
async function getLocation() {
    currentAddress = document.getElementById("currentAddress");
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
async function reverseGeocode(lat, lon) {
    const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`
    );
    if (!response.ok) throw new Error(`reverseGeocode failed: ${response.status}`);
    const data = await response.json();
    // return data.display_name;
    return data.display_name.split(',').slice(0, 2).join(',');
}
if (map) { try { map.remove(); } catch (e) { } }
marker = null; // bugfix: old marker belonged to the removed map instance
map = L.map('map').setView([17.3850, 78.4867], 13);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap'
}).addTo(map);
const livelocationBtn = document.getElementById("liveLocationBtn");
const maps_btn = document.getElementById("map_btn");
// Basic HTML-escaping so item names/prices/urls from the API can never break
// out of the markup they're injected into (XSS guard).
function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function scheduleCartUpdate(itemId, userId, delta, qtyEl, onSuccess, onFailure) {
    let entry = pendingUpdates.get(itemId);

    if (entry) {
        // Fold this click into the pending batch
        entry.accumulatedDelta += delta;
        clearTimeout(entry.timer);
    } else {
        entry = { accumulatedDelta: delta, timer: null };
        pendingUpdates.set(itemId, entry);
    }

    entry.timer = setTimeout(async () => {
        const netDelta = entry.accumulatedDelta;
        pendingUpdates.delete(itemId); // clear before await so new clicks start a fresh batch

        // Clicks cancelled each other out (e.g. +1 then -1) — UI is already correct
        // from the optimistic updates, nothing to send to the server.
        if (netDelta === 0) return;

        // Cancel any older in-flight request for this item so responses can't race.
        inFlightControllers.get(itemId)?.abort();
        const controller = new AbortController();
        inFlightControllers.set(itemId, controller);

        try {
            const res = await fetch("/update_cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, item_id: itemId, qty: netDelta }),
                signal: controller.signal
            });
            console.log(res);
            
            if (!res.ok) throw new Error(`update_cart failed: ${res.status}`);
            const data = await res.json();
            console.log(data)
            
            if (data.success) {
                onSuccess(data);
            } else {
                onFailure(data.message || "Failed updating cart");
            }
        } catch (err) {
            console.log(err);
            
            if (err.name !== "AbortError") {
                console.error("cart update failed", err);
                onFailure("Network error");
            }
        } finally {
            if (inFlightControllers.get(itemId) === controller) {
                inFlightControllers.delete(itemId);
            }
        }
    }, 400); // debounce window — tune to taste (300-500ms feels good)
}
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
        // change(parseFloat(item.dataset.lat), parseFloat(item.dataset.lon));
    });

    document.querySelectorAll(".tag-btn").forEach(btn => {
        addListenerOnce(btn, "click", async () => {
            const addressType = btn.dataset.tag;
            const address = document.getElementById("currentAddress").textContent;
            const address_latt = document.getElementById("currentAddress").dataset.lat;
            const address_long = document.getElementById("currentAddress").dataset.long;
            const cordinates = { latt: address_latt, long: address_long };
            console.log(cordinates);
            
            document.getElementById("addressTagModal").classList.remove("show");
            try {
                const res = await fetch("/save_address", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ address: address, address_type: addressType, cordinates: cordinates })
                });
                const data=await res.json()
                console.log(data,res);
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
        // loading_container.classList.add("show");
        try {
            const livelctn = await getPosition();
            const address = await reverseGeocode(livelctn.coords.latitude, livelctn.coords.longitude);
            const userLocation = { latt: livelctn.coords.latitude, long: livelctn.coords.longitude };
            localStorage.setItem("userLocation", JSON.stringify(userLocation));
            currentAddress.textContent=address
            currentAddress.dataset.long=livelctn.coords.longitude
            currentAddress.dataset.lat=livelctn.coords.latitude
            // await change(livelctn.coords.latitude, livelctn.coords.longitude);
            // document.getElementById("addressTagModal").classList.add("show");
        } catch (err) {
            console.error("live location failed", err);
            alert("Location access denied");
        } finally {
            
            document.getElementById("addressTagModal").classList.add("show");
            // loading_container.classList.remove("show");
            overlay.classList.remove("show");
        }
    });

    const map_container = document.getElementById("map_container");
    map.on('click', async (e) => {
        const { lat, lng } = e.latlng;
        try {
            const address = await reverseGeocode(lat, lng);
            currentAddress.dataset.long = lng;
            currentAddress.dataset.lat = lat;
            currentAddress.textContent = address;
            // await change(lat, lng);
            // localStorage.setItem("currentAddress", address);
            localStorage.setItem("selectedAddress",address)
            const userLocation = { latt: lat, long: lng };
            localStorage.setItem("userLocation", JSON.stringify(userLocation));
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
function mergeMenuWithCart(data, datas, res_id) {
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
async function initHomePage() {
    console.log("in init home");
    
    // document.addEventListener("DOMContentLoaded", async () => {
        console.log("in dom content loaded");
        
        const path = window.location.pathname;
        // Path shape: /menu/:res_name/:address/:res_id/:userId
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
        // const heading = res_info.querySelector("h1");
        // const res_location = res_info.querySelector(".res-location");
        // const breadcrump = document.querySelector(".breadcrumbs");
        const loading = document.getElementById("loading");
        const menu_container = document.querySelector('.menu-section');
        const current_total_amount = document.getElementById("amount");
        const footer = document.getElementsByTagName("footer")[0];
        const gotoCartBtn = document.getElementById("GoCartBtn");
        const message = document.getElementById("message");
        const ReplaceContainer = document.getElementById("ReplaceContainer");
        const overlayContainer = document.getElementById("overlayContainer");

        // breadcrump.innerText = `Home / ${addresss_decoded} / ${decoded}`;
        // res_location.innerText = addresss_decoded;
        // heading.innerText = decoded;
        console.log("befor get_Cart");
        let selected_location=null
        if(localStorage.getItem("userLocation")){
            if(localStorage.getItem("selectedAddress")){
                let userLoc=JSON.parse(localStorage.getItem("userLocation"))
                console.log(userLoc);
                
                currentAddress.textContent=localStorage.getItem("selectedAddress")
                currentAddress.dataset.long=userLoc.long
                currentAddress.dataset.lat=userLoc.latt
            }
        }
        const rest = await fetch("/get_cart_items", {
            method: "POST",
            headers: { "Content-type": "application/json" },
            body: JSON.stringify({ "userid": userId })
        });
        if (rest.status === 401) {
            alert("Unauthorized user. Please log in");
            window.location.href = "/login/user";
            return; // bugfix: previously kept executing after redirecting
        }
        if (!rest.ok) {
            alert("Error loading cart");
            return;
        }
        const datas = await rest.json();
        console.log(datas);
        
        if (datas.results !== null && datas.results.total > 0) {
            footer.classList.add("show");
            current_total_amount.innerText = datas.results.total;
        }

        const res = await fetch("/list_items", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ "res_id": res_id, "type": "user" })
        });
        if (res.status === 401) {
            alert("Unauthorized user. Please log in");
            window.location.href = "/login/user";
            return; // bugfix: previously kept executing after redirecting
        }
        if (!res.ok) {
            alert("Error loading menu");
            return;
        }
        const data = await res.json();

        if (data.success) {
            const mergedd = mergeMenuWithCart(data, datas, res_id);
            loading.style.display = "none";

            // const items = Object.values(mergedd);

            const items = Object.values(mergedd);

            let html = "";

            for (let i = 0; i < items.length; i += 2) {
                const item1 = items[i];
                const item2 = items[i + 1];

                const createItem = (item) => {
                    const controls = item.qty === 0
                        ? `<button class="add-btn" id="${escapeHtml(item.id)}">ADD</button>`
                        : `<div class="quantity-control">
                        <button class="qty-btn reduce">-</button>
                        <span class="item_qty">${escapeHtml(item.qty)}</span>
                        <button class="qty-btn increase">+</button>
                </div>`;

                    return `
                <div class="menu-item"
                    id="${escapeHtml(item.id)}"
                    available="${escapeHtml(item.item_qty)}">

                    <div class="item-img-wrapper">
                        <img src="${escapeHtml(item.file_url)}" alt="Burger">
                        </div>
                        
                        <div class="item-details">
                        <div style="display:flex; justify-content:space-between;">
                        <h3>${escapeHtml(item.name)}</h3>
                        <p class="price">${escapeHtml(item.price)}</p>
                        </div>
                        ${controls}
                    </div>

                </div>
            `;
                };

                html += `
            <div class="menu-row">
                ${createItem(item1)}
                ${item2 ? createItem(item2) : ""}
            </div>
        `;
            }
            console.log(menu_items_container);
            
            menu_items_container.innerHTML= html; // bugfix: was `+=` against existing (empty) content, kept for clarity/perf
        }

        // bugfix: cart/order buttons previously read localStorage.getItem("userId"),
        // which this app never sets — it would send `/cart/null`. Use the userId
        // that's already parsed from the current URL instead.
        
        // const hidecartorderBtn = document.getElementById("hideCartOrderBtn");
        // hidecartorderBtn.addEventListener("click", () => {
        //     const cartorderContainer = document.getElementById("CartOrderContainer");
        //     if (cartorderContainer.classList.contains("hide")) {
        //         cartorderContainer.classList.replace("hide", "show");
        //     } else {
        //         cartorderContainer.classList.replace("show", "hide");
        //     }
        // });

        let pendingCartItem = null;

        menu_items_container.addEventListener("click", async (e) => {
            if (!e.target.classList.contains("add-btn")) return;

            const item = e.target.closest(".menu-item");
            const names = item.querySelector("h3").innerText;
            const price = item.querySelector(".price").innerText;
            const item_id = item.getAttribute("id");
            const available = parseInt(item.getAttribute("available"));
            const button = item.querySelector(".add-btn");

            // bugfix: nothing previously stopped you from adding an item that's out of stock
            if (!Number.isNaN(available) && available <= 0) {
                alert("This item is currently out of stock");
                return;
            }

            try {
                const res = await fetch("/add_to_cart", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
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
                if (!res.ok) throw new Error(`add_to_cart failed: ${res.status}`);
                // const data = await res.json();

                if (data.success) {
                    button.outerHTML = `
                        <div class="quantity-control">
                            <button class="qty-btn reduce">-</button>
                            <span class="item_qty">1</span>
                            <button class="qty-btn increase">+</button>
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
                    message.innerText = data.message || "please Try again";
                }
            } catch (err) {
                console.error("add_to_cart failed", err);
                alert("Something went wrong adding this item. Please try again.");
            }
        });
        addListenerOnce(cancelbtn, "click", () => {
        document.getElementById("addressTagModal").classList.remove("show");
    });
        const replaceYesBtn = document.getElementById("YES");
        replaceYesBtn.addEventListener("click", async () => {
            if (!pendingCartItem) return;
            try {
                const res = await fetch("/add_to_cart", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        resid: pendingCartItem.resid,
                        userid: pendingCartItem.userid,
                        item: pendingCartItem.item,
                        ress_name: pendingCartItem.ress_name,
                        qty: pendingCartItem.qty,
                        item_id: pendingCartItem.item_id,
                        price: pendingCartItem.price,
                        replace: true
                    })
                });
                if (res.status === 401) {
                    alert("Unauthorized user. Please log in");
                    window.location.href = "/login/user";
                    return;
                }
                if (!res.ok) throw new Error(`add_to_cart(replace) failed: ${res.status}`);
                const data = await res.json();

                if (data.success) {
                    footer.classList.add("show");
                    current_total_amount.innerText = data.Total;
                    ReplaceContainer.classList.remove("show");
                    overlayContainer.classList.remove("show");
                    message.innerText = "Error:";
                    const itemEl = document.getElementById(pendingCartItem.item_id);
                    const button = itemEl?.querySelector(".add-btn");
                    if (button) {
                        button.outerHTML = `
                            <div class="quantity-control">
                                <button class="qty-btn reduce">-</button>
                                <span class="item_qty">1</span>
                                <button class="qty-btn increase">+</button>
                            </div>
                        `;
                    }
                } else {
                    alert(data.message || "Failed to replace cart item");
                }
            } catch (err) {
                console.error("replace add_to_cart failed", err);
                alert("Something went wrong. Please try again.");
            } finally {
                pendingCartItem = null;
            }
        });

        const replaceNoBtn = document.getElementById("NO");
        replaceNoBtn.addEventListener("click", () => {
            ReplaceContainer.classList.remove("show");
            overlayContainer.classList.remove("show");
            message.innerText = "Error:";
            pendingCartItem = null;
        });

        menu_container.addEventListener('click', async (e) => {
            const itemRow = e.target.closest('.menu-item');
            if (!itemRow) return;

            const itemId = itemRow.id;
            const itemName = itemRow.querySelector('.item-details').textContent;
            // bugfix: default to "unlimited" (Infinity) instead of NaN when the
            // available-stock attribute is missing, so the stock check below
            // doesn't silently become a no-op comparison against NaN
            const availableRaw = itemRow.getAttribute("available");
            const item_qty = availableRaw !== null && availableRaw !== "" ? parseInt(availableRaw) : Infinity;

            if (e.target.classList.contains('increase')) {
                const qtyEl = e.target.parentElement.querySelector('.item_qty');
                const prevQty = Number(qtyEl.textContent);

                if (prevQty + 1 > item_qty) {
                    alert(`only ${item_qty} in stock`);
                    return;
                }

                // Optimistic UI update — instant feedback
                qtyEl.textContent = prevQty + 1;

                scheduleCartUpdate(itemId, userId, 1, qtyEl,
                    (data) => {
                        if (data.total > 0) {
                            footer.classList.add("show");
                            current_total_amount.innerText = data.total;
                        } else {
                            footer.classList.remove("show");
                        }
                    },
                    (msg) => {
                        qtyEl.textContent = prevQty; // rollback on failure
                        alert(msg);
                    }
                );
            } else if (e.target.classList.contains('reduce')) {
                const qtyEl = e.target.parentElement.querySelector('.item_qty');
                const prevQty = Number(qtyEl.textContent);

                // Optimistic UI update — instant feedback
                qtyEl.textContent = Math.max(0, prevQty - 1);

                scheduleCartUpdate(itemId, userId, -1, qtyEl,
                    (data) => {
                        if (data.total > 0) {
                            footer.classList.add("show");
                            current_total_amount.innerText = data.total;
                        } else {
                            footer.classList.remove("show");
                        }
                        // bugfix: removal is now driven only by the server response
                        // (data.removed), not inferred from the optimistic qtyEl
                        // text — previously both an optimistic AND a server-driven
                        // removal path existed and could fight each other.
                        if (data.removed) {
                            const qtyControl = e.target.closest('.quantity-control');
                            if (qtyControl) {
                                qtyControl.outerHTML = `<button class="add-btn" id="${itemId}">ADD</button>`;
                            }
                        }
                    },
                    (msg) => {
                        qtyEl.textContent = prevQty; // rollback on failure
                        alert(msg);
                    }
                );
            }
        });

        
        const searchContainer = document.getElementById("searchContainer");
        

        const searchInput = document.getElementById("searchInput");
        searchInput.addEventListener("input", () => {
            const searchTerm = searchInput.value.toLowerCase();
            const menuItems = document.querySelectorAll(".menu-item");

            menuItems.forEach(item => {
                const itemName = item.querySelector(".item-details h3").textContent.toLowerCase();
                const divider = item.nextElementSibling; // the <hr>
                const matches = itemName.includes(searchTerm);

                item.style.display = matches ? "flex" : "none";
                if (divider && divider.classList.contains("item-divider")) {
                    divider.style.display = matches ? "block" : "none";
                }
            });
        });

        gotoCartBtn.addEventListener("click", () => {
            window.location.href = `/cart/${userId}`;
        });
    // });
}
// document.addEventListener
// addListenerOnce(cartBtn, "click", () => { window.location.href = `/cart/${userId}`; });
// addListenerOnce(orderBtn, "click", () => { window.location.href = `/orders/${userId}`; });
initHomePage()
// console.log(e.detail.page);

document.addEventListener("spa:pageload", (e) => {
    console.log(e.detail.page);
    if (e.detail.page === "home") initHomePage()
});