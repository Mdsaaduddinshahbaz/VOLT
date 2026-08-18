function getPosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject("Geolocation is not supported by your browser");
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

async function initCartPage() {
    const cart_items_container = document.getElementById("cart_items");
    if (!cart_items_container) return; // not actually on the cart content

    const pathParts = window.location.pathname.split("/");
    const userId = window.APP_USER_ID || pathParts[pathParts.length - 1];
    const res_info = document.querySelector(".res-info");
    const heading = res_info.querySelector("h4");
    const placeorder = document.getElementById("placeorder")
    const orderBtn = document.getElementById("orderBtn")
    const totalPrice = document.getElementById("totalPrice")
    const toPay = document.getElementById("toPay")
    const addressChgBtn = document.getElementById("ChangeAdrs")
    const deliveryAdrs = document.getElementById("Deliveryaddress")
    const livelocationBtn = document.getElementById("liveLocationBtn")
    const loading_container = document.getElementById("loading_container")
    const typeaddrs = document.getElementById("type")
    const address_container = document.getElementById("addressOptions");
    const no_order_container = document.getElementById("No_orders_container")
    const cartContainer = document.querySelector('.cart-container');
    heading.innerText = "Order List";
    const curr_addr = localStorage.getItem("currentAddress")
    deliveryAdrs.textContent = curr_addr

    const CART_CACHE_KEY = `cachedCart_${userId}`;
    let restaurants = {}

    function renderCart(cart) {
        if (!cart || Object.keys(cart).length === 0) {
            cart_items_container.innerHTML = "";
            const cl = cartContainer.querySelector(".cart-left");
            const cr = cartContainer.querySelector(".cart-right");
            if (cl) cl.outerHTML = ""
            if (cr) cr.outerHTML = ""
            cartContainer.style.display = "block"
            no_order_container.classList.add("show")
            return 0;
        }

        no_order_container.classList.remove("show")

        let total = 0;
        const html = Object.entries(cart).map(([resName, details]) => {
            const itemsHtml = Object.entries(details.items).map(([item_id, detail]) => {
                total += (detail.price * detail.qty);
                return `
            <div class="cart-item" id=${item_id}>
                <span class="veg-icon"><i class="fa-regular fa-circle-stop"></i></span>
                <span class="item-name">${detail.name}</span>
                <div class="quantity-control">
                    <button class="qty-btn reduce">-</button>
                    <span class="item_qty">${detail.qty}</span>
                    <button class="qty-btn increase">+</button>
                </div>
                <span class="unit-price">${detail.price}</span>
                <span class="item-price">${detail.price * detail.qty}</span>
            </div>
        `;
            }).join("");
            return `<h2>${details.name}</h2>${itemsHtml}`;
        }).join("");

        cart_items_container.innerHTML = html;
        totalPrice.innerText = total
        toPay.innerText = total
        return total;
    }

    const cachedCart = sessionStorage.getItem(CART_CACHE_KEY);
    if (cachedCart) {
        try { restaurants = JSON.parse(cachedCart); renderCart(restaurants); }
        catch (e) { console.warn("bad cart cache, ignoring", e); }
    }

    const shopBtn = document.getElementById("shopBtn");
    if (shopBtn) shopBtn.addEventListener("click", () => { window.location.href = `/user/${userId}`; });

    const res = await fetch("/get_cart_items", {
        method: "POST",
        headers: { "Content-type": "application/json" },
        body: JSON.stringify({ userid: userId })
    })
    if (res.status == 401) {
        alert("unauthorized User,Please Log in")
        window.location.href = "/login/user";
        return;
    }
    const data = await res.json()

    if (data.success) {
        restaurants = data.results ? data.results.cart : {};
        sessionStorage.setItem(CART_CACHE_KEY, JSON.stringify(restaurants));
        renderCart(restaurants);
    } else if (!cachedCart) {
        renderCart({});
    }

    const address = await fetch("/fetch_address", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId })
    })
    const datas = await address.json()
    
    if (datas.success) {
        
        deliveryAdrs.textContent = datas.address[0].adrs_type + " - " + datas.address[0].address
        deliveryAdrs.dataset.long = datas.address[0].coordinates.long
        deliveryAdrs.dataset.lat = datas.address[0].coordinates.latt
        datas.address.forEach((addr) => {
            address_container.innerHTML += `
                        <div class="address-option" data-long=${addr.coordinates.long} data-latt=${addr.coordinates.latt}>
                        <span class="address-type">${addr.adrs_type}</span>
                        <span  name="payment" value="card">${addr.address}</span>
                    </div>
                    `
        });
    }
    const current_user = JSON.parse(localStorage.getItem("userLocation"));

    console.log(current_user.latt);
    deliveryAdrs.textContent = curr_addr
    deliveryAdrs.dataset.long = current_user.long
    deliveryAdrs.dataset.lat = current_user.latt
    function syncCartCacheQty(itemId, delta, unitprice, removed = false) {
        Object.values(restaurants).forEach((details) => {
            if (details.items[itemId]) {
                if (removed) delete details.items[itemId];
                else details.items[itemId].qty += delta;
            }
        });
        sessionStorage.setItem(CART_CACHE_KEY, JSON.stringify(restaurants));
    }

    cartContainer.addEventListener('click', async (e) => {
        if (!e.target.classList.contains('qty-btn')) return;

        const itemRow = e.target.closest('.cart-item');
        const itemId = itemRow.id;
        const item_qty = itemRow.querySelector('.item_qty');
        const item_price = itemRow.querySelector('.item-price');
        const unit_price = itemRow.querySelector('.unit-price');
        let currentQty = parseInt(item_qty.textContent);
        let currentPrice = parseInt(item_price.textContent);
        let unitprice = parseInt(unit_price.textContent);
        let totalprice = parseInt(totalPrice.textContent);
        let topay = parseInt(toPay.textContent);

        if (e.target.classList.contains('increase')) {
            const res = await fetch("/update_cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, item_id: itemId, qty: 1 })
            })
            const data = await res.json()
            if (data.success) {
                item_qty.innerText = currentQty + 1;
                item_price.innerText = currentPrice + unitprice;
                totalPrice.innerText = totalprice + unitprice;
                toPay.innerText = topay + unitprice;
                syncCartCacheQty(itemId, 1, unitprice);
            } else { alert("failed adding item") }
        } else if (e.target.classList.contains('reduce')) {
            const res = await fetch("/update_cart", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ user_id: userId, item_id: itemId, qty: -1 })
            })
            const data = await res.json()
            if (data.success) {
                if (currentQty > 1) {
                    item_qty.textContent = currentQty - 1;
                    item_price.innerText = currentPrice - unitprice;
                    totalPrice.innerText = totalprice - unitprice;
                    toPay.innerText = topay - unitprice;
                    syncCartCacheQty(itemId, -1, unitprice);
                } else {
                    totalPrice.innerText = totalprice - unitprice;
                    toPay.innerText = topay - unitprice;
                    const prevHeading = itemRow.previousElementSibling;
                    const nextSibling = itemRow.nextElementSibling;
                    itemRow.remove();
                    if (prevHeading && prevHeading.tagName === "H2" && (!nextSibling || nextSibling.tagName === "H2")) {
                        prevHeading.remove();
                    }
                    syncCartCacheQty(itemId, -1, unitprice, true);
                    if (document.querySelectorAll(".cart-item").length === 0) {
                        const cl = cartContainer.querySelector(".cart-left");
                        const cr = cartContainer.querySelector(".cart-right");
                        if (cl) cl.outerHTML = ""
                        if (cr) cr.outerHTML = ""
                        cartContainer.style.display = "block"
                        no_order_container.classList.add("show");
                    }
                }
            } else { alert("failed removing item") }
        }
    });

    placeorder.addEventListener("click", async () => {
        const remainingItems = document.querySelectorAll(".cart-item");
        if (remainingItems.length === 0) { alert("Your cart is empty"); return; }
        const longitude = deliveryAdrs.dataset.long;
        const latitude = deliveryAdrs.dataset.lat;

        // console.log(longitude, latitude);
        const res = await fetch("/store_orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: userId, items: restaurants ,coordinates:{"long":longitude,"latt":latitude}})
        })
        const data = await res.json()
        if (data.success) {
            alert("order placed")
            sessionStorage.removeItem(CART_CACHE_KEY);
            sessionStorage.removeItem(`cachedOrders_${userId}`);
            window.location.href = `/orders/${userId}`
        } else {
            alert("error while placing order")
            initCartPage();
        }
    })
    if (orderBtn) orderBtn.addEventListener("click", () => { window.location.href = `/orders/${userId}` })

    const box = document.getElementById("addressOptions");
    const overlay = document.getElementById("locationOverlay");
    addressChgBtn.addEventListener("click", async () => {
        box.classList.add("show");
        overlay.classList.add("show");
    })
    overlay.addEventListener("click", () => {
        box.classList.remove("show");
        overlay.classList.remove("show");
    });

    address_container.addEventListener("click", (e) => {
        const selected_option = e.target.closest(".address-option")
        const spans = selected_option.querySelectorAll("span");
        // console.log(selected_option.dataset.long)
        typeaddrs.innerText = spans[0].textContent + " -"
        deliveryAdrs.textContent = spans[1].textContent
        deliveryAdrs.dataset.long = selected_option.dataset.long
        deliveryAdrs.dataset.lat = selected_option.dataset.latt
        address_container.classList.remove("show")
        overlay.classList.remove("show");
    })

    livelocationBtn.addEventListener("click", async () => {
        box.classList.remove("show");
        loading_container.classList.add("show");
        const livelctn = await getPosition();
        const userLocation = { latt: livelctn.coords.latitude, long: livelctn.coords.longitude };
        localStorage.setItem("userLocation", JSON.stringify(userLocation));
        const address = await reverseGeocode(userLocation.latt, userLocation.long);
        deliveryAdrs.textContent = address
        loading_container.classList.remove("show");
        overlay.classList.remove("show");
    })
}

// Run on this page's first real load...
initCartPage();
// ...and re-run every time the SPA router swaps Cart back into view
document.addEventListener("spa:pageload", (e) => {
    if (e.detail.page === "cart") initCartPage();
});