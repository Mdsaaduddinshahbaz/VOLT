let pendingUpdatess = new Map();       // itemId -> { timer, accumulatedDelta }
let inFlightControllerss = new Map();
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

function scheduleCartUpdate(itemId, userId, delta, qtyEl, onSuccess, onFailure) {
    let entry = pendingUpdatess.get(itemId);

    if (entry) {
        // Fold this click into the pending batch
        entry.accumulatedDelta += delta;
        clearTimeout(entry.timer);
    } else {
        entry = { accumulatedDelta: delta, timer: null };
        pendingUpdatess.set(itemId, entry);
    }

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
            if (inFlightControllerss.get(itemId) === controller) {
                inFlightControllerss.delete(itemId);
            }
        }
    }, 400); // debounce window — tune to taste (300-500ms feels good)
}
async function initCartPage() {

    const cart_items_container =
        document.getElementById("cart_items");

    if (!cart_items_container) return;

    const pathParts =
        window.location.pathname.split("/");

    const userId =
        window.APP_USER_ID ||
        pathParts[pathParts.length - 1];

    const res_info =
        document.querySelector(".res-info");

    const heading =
        res_info.querySelector("h4");

    const placeorder =
        document.getElementById("placeorder");

    const orderBtn =
        document.getElementById("orderBtn");

    const totalPrice =
        document.getElementById("totalPrice");

    const toPay =
        document.getElementById("toPay");

    const addressChgBtn =
        document.getElementById("ChangeAdrs");

    const deliveryAdrs =
        document.getElementById("Deliveryaddress");

    const livelocationBtn =
        document.getElementById("liveLocationBtn");

    const loading_container =
        document.getElementById("loading_container");

    const typeaddrs =
        document.getElementById("type");

    const address_container =
        document.getElementById("addressOptions");

    const no_order_container =
        document.getElementById("No_orders_container");

    const cartContainer =
        document.querySelector(".cart-container");

    heading.innerText = "Order List";


    const curr_addr =
        localStorage.getItem("currentAddress");

    deliveryAdrs.textContent =
        curr_addr || "";


    const CART_CACHE_KEY =
        `cachedCart_${userId}`;


    let restaurants = {};


    function renderCart(cart) {

        if (!cart || Object.keys(cart).length === 0) {

            cart_items_container.innerHTML = "";

            const cl =
                cartContainer.querySelector(".cart-left");

            const cr =
                cartContainer.querySelector(".cart-right");

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


        const html =
            Object.entries(cart).map(
                ([item_id, detail]) => {

                    total +=
                        detail.price * detail.qty;


                    return `
                        <div class="cart-item" id="${item_id}">

                            <span class="veg-icon">
                                <i class="fa-regular fa-circle-stop"></i>
                            </span>

                            <span class="item-name">
                                ${detail.name}
                            </span>

                            <div class="quantity-control">

                                <button class="qty-btn reduce">
                                    -
                                </button>

                                <span class="item_qty">
                                    ${detail.qty}
                                </span>

                                <button class="qty-btn increase">
                                    +
                                </button>

                            </div>

                            <span class="unit-price">
                                ${detail.price}
                            </span>

                            <span class="item-price">
                                ${detail.price * detail.qty}
                            </span>

                        </div>
                    `;
                }
            ).join("");


        cart_items_container.innerHTML =
            html;


        totalPrice.innerText =
            total;

        toPay.innerText =
            total;


        return total;
    }


    const cachedCart =
        sessionStorage.getItem(CART_CACHE_KEY);


    if (cachedCart) {

        try {

            restaurants =
                JSON.parse(cachedCart);

            renderCart(restaurants);

        } catch (e) {

            console.warn(
                "bad cart cache, ignoring",
                e
            );

        }
    }


    const shopBtn =
        document.getElementById("shopBtn");


    if (shopBtn) {

        shopBtn.addEventListener(
            "click",
            () => {
                window.location.href =
                    `/user/${userId}`;
            }
        );

    }


    const res =
        await fetch("/get_cart_items", {
            method: "POST",
            headers: {
                "Content-type": "application/json"
            },
            body: JSON.stringify({
                userid: userId
            })
        });


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


    if (data.success) {

        /*
            NEW CART STRUCTURE:

            data.results = {
                items: {
                    item_id: {
                        name,
                        price,
                        qty,
                        available_qty
                    }
                },
                total,
                uid
            }
        */

        restaurants =
            data.results?.items || {};


        sessionStorage.setItem(
            CART_CACHE_KEY,
            JSON.stringify(restaurants)
        );


        renderCart(restaurants);

    } else if (!cachedCart) {

        renderCart({});

    }


    const address =
        await fetch("/fetch_address", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                user_id: userId
            })
        });


    const datas =
        await address.json();


    if (datas.success && datas.address?.length) {

        deliveryAdrs.textContent =
            datas.address[0].adrs_type +
            " - " +
            datas.address[0].address;


        deliveryAdrs.dataset.long =
            datas.address[0].coordinates.long;


        deliveryAdrs.dataset.lat =
            datas.address[0].coordinates.latt;


        datas.address.forEach((addr) => {

            address_container.innerHTML += `
                <div
                    class="address-option"
                    data-long="${addr.coordinates.long}"
                    data-latt="${addr.coordinates.latt}"
                >

                    <span class="address-type">
                        ${addr.adrs_type}
                    </span>

                    <span
                        name="payment"
                        value="card"
                    >
                        ${addr.address}
                    </span>

                </div>
            `;

        });

    }


    const current_user =
        JSON.parse(
            localStorage.getItem("userLocation")
        );


    if (current_user) {

        console.log(
            current_user.latt
        );


        deliveryAdrs.dataset.long =
            current_user.long;


        deliveryAdrs.dataset.lat =
            current_user.latt;

    }


    if (curr_addr) {
        deliveryAdrs.textContent =
            curr_addr;
    }


    function syncCartCacheQty(
        itemId,
        delta,
        unitprice,
        removed = false
    ) {

        if (restaurants[itemId]) {

            if (removed) {

                delete restaurants[itemId];

            } else {

                restaurants[itemId].qty += delta;

            }

        }


        sessionStorage.setItem(
            CART_CACHE_KEY,
            JSON.stringify(restaurants)
        );

    }


    cartContainer.addEventListener(
        "click",
        async (e) => {

            if (
                !e.target.classList.contains(
                    "qty-btn"
                )
            ) {
                return;
            }


            const itemRow =
                e.target.closest(".cart-item");


            if (!itemRow) {
                return;
            }


            const itemId =
                itemRow.id;


            const item_qty =
                itemRow.querySelector(
                    ".item_qty"
                );


            const item_price =
                itemRow.querySelector(
                    ".item-price"
                );


            const unit_price =
                itemRow.querySelector(
                    ".unit-price"
                );


            let currentQty =
                parseInt(
                    item_qty.textContent
                );


            let currentPrice =
                parseInt(
                    item_price.textContent
                );


            let unitprice =
                parseInt(
                    unit_price.textContent
                );


            let totalprice =
                parseInt(
                    totalPrice.textContent
                );


            let topay =
                parseInt(
                    toPay.textContent
                );


            if (
                e.target.classList.contains(
                    "increase"
                )
            ) {
                const qtyEl = e.target.parentElement.querySelector('.item_qty');
                const prevQty = Number(qtyEl.textContent);
                console.log(qtyEl, prevQty);
                if (prevQty + 1 > item_qty) {
                    alert(`only ${item_qty} in stock`);
                    return;
                }
                qtyEl.textContent = prevQty + 1;
                scheduleCartUpdate(itemId, userId, +1, qtyEl,
                    (data) => {
                        if (data.total > 0) {
                            item_qty.innerText =
                                currentQty + 1;


                            item_price.innerText =
                                currentPrice + unitprice;


                            totalPrice.innerText =
                                totalprice + unitprice;


                            toPay.innerText =
                                topay + unitprice;


                            syncCartCacheQty(
                                itemId,
                                1,
                                unitprice
                            );
                            // footer.classList.add("show");
                            // current_total_amount.innerText = data.total;
                        } else {
                            // footer.classList.remove("show");
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
                // const res =
                //     await fetch(
                //         "/update_cart",
                //         {
                //             method: "POST",

                //             headers: {
                //                 "Content-Type":
                //                     "application/json"
                //             },

                //             body: JSON.stringify({
                //                 user_id: userId,
                //                 item_id: itemId,
                //                 qty: 1
                //             })
                //         }
                //     );


                // const data =
                //     await res.json();


                // if (data.success) {

                //     item_qty.innerText =
                //         currentQty + 1;


                //     item_price.innerText =
                //         currentPrice + unitprice;


                //     totalPrice.innerText =
                //         totalprice + unitprice;


                //     toPay.innerText =
                //         topay + unitprice;


                //     syncCartCacheQty(
                //         itemId,
                //         1,
                //         unitprice
                //     );

                // } else {

                //     alert(
                //         "failed adding item"
                //     );

                // }

            }


            else if (
                e.target.classList.contains(
                    "reduce"
                )
            ) {

                const res =
                    await fetch(
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
                                qty: -1
                            })
                        }
                    );


                const data =
                    await res.json();


                if (data.success) {

                    if (currentQty > 1) {

                        item_qty.textContent =
                            currentQty - 1;


                        item_price.innerText =
                            currentPrice -
                            unitprice;


                        totalPrice.innerText =
                            totalprice -
                            unitprice;


                        toPay.innerText =
                            topay -
                            unitprice;


                        syncCartCacheQty(
                            itemId,
                            -1,
                            unitprice
                        );

                    }


                    else {

                        totalPrice.innerText =
                            totalprice -
                            unitprice;


                        toPay.innerText =
                            topay -
                            unitprice;


                        const prevHeading =
                            itemRow.previousElementSibling;


                        const nextSibling =
                            itemRow.nextElementSibling;


                        itemRow.remove();


                        if (
                            prevHeading &&
                            prevHeading.tagName === "H2" &&
                            (
                                !nextSibling ||
                                nextSibling.tagName === "H2"
                            )
                        ) {

                            prevHeading.remove();

                        }


                        syncCartCacheQty(
                            itemId,
                            -1,
                            unitprice,
                            true
                        );


                        if (
                            document.querySelectorAll(
                                ".cart-item"
                            ).length === 0
                        ) {

                            const cl =
                                cartContainer.querySelector(
                                    ".cart-left"
                                );


                            const cr =
                                cartContainer.querySelector(
                                    ".cart-right"
                                );


                            if (cl)
                                cl.outerHTML = "";


                            if (cr)
                                cr.outerHTML = "";


                            cartContainer.style.display =
                                "block";


                            no_order_container.classList.add(
                                "show"
                            );

                        }

                    }

                } else {

                    alert(
                        "failed removing item"
                    );

                }

            }

        }
    );


    placeorder.addEventListener(
        "click",
        async () => {

            const remainingItems =
                document.querySelectorAll(
                    ".cart-item"
                );


            if (
                remainingItems.length === 0
            ) {

                alert(
                    "Your cart is empty"
                );

                return;
            }


            const longitude =
                deliveryAdrs.dataset.long;


            const latitude =
                deliveryAdrs.dataset.lat;


            const res =
                await fetch(
                    "/store_orders",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            user_id: userId,
                            items: restaurants,
                            coordinates: {
                                "long": longitude,
                                "latt": latitude
                            }
                        })
                    }
                );


            const data =
                await res.json();

            console.log(data, restaurants);

            if (data.success) {

                alert(
                    "order placed"
                );


                sessionStorage.removeItem(
                    CART_CACHE_KEY
                );


                sessionStorage.removeItem(
                    `cachedOrders_${userId}`
                );


                window.location.href =
                    `/orders/${userId}`;

            } else {

                alert(
                    "error while placing order"
                );

                initCartPage();

            }

        }
    );


    if (orderBtn) {

        orderBtn.addEventListener(
            "click",
            () => {
                window.location.href =
                    `/orders/${userId}`;
            }
        );

    }


    const box =
        document.getElementById(
            "addressOptions"
        );


    const overlay =
        document.getElementById(
            "locationOverlay"
        );
    overlay.addEventListener("click", () => {
        box.classList.remove("show");
        overlay.classList.remove("show");
    });

    addressChgBtn.addEventListener(
        "click",
        async () => {

            box.classList.add("show");

            overlay.classList.add("show");

        }
    );


    address_container.addEventListener(
        "click",
        (e) => {

            const selected_option =
                e.target.closest(
                    ".address-option"
                );


            if (!selected_option) {
                return;
            }


            const spans =
                selected_option.querySelectorAll(
                    "span"
                );


            typeaddrs.innerText =
                spans[0].textContent +
                " -";


            deliveryAdrs.textContent =
                spans[1].textContent;


            deliveryAdrs.dataset.long =
                selected_option.dataset.long;


            deliveryAdrs.dataset.lat =
                selected_option.dataset.latt;


            address_container.classList.remove(
                "show"
            );


            overlay.classList.remove(
                "show"
            );

        }
    );


    livelocationBtn.addEventListener(
        "click",
        async () => {

            try {

                box.classList.remove(
                    "show"
                );


                loading_container.classList.add(
                    "show"
                );


                const livelctn =
                    await getPosition();


                const userLocation = {
                    latt:
                        livelctn.coords.latitude,

                    long:
                        livelctn.coords.longitude
                };


                localStorage.setItem(
                    "userLocation",
                    JSON.stringify(
                        userLocation
                    )
                );


                const address =
                    await reverseGeocode(
                        userLocation.latt,
                        userLocation.long
                    );


                deliveryAdrs.textContent =
                    address;


                deliveryAdrs.dataset.long =
                    userLocation.long;


                deliveryAdrs.dataset.lat =
                    userLocation.latt;


                loading_container.classList.remove(
                    "show"
                );


                overlay.classList.remove(
                    "show"
                );

            } catch (error) {

                console.error(
                    "Location error:",
                    error
                );

                alert(
                    "Unable to get your location"
                );


                loading_container.classList.remove(
                    "show"
                );

            }

        }
    );

}


// Run on this page's first real load...
initCartPage();


// ...and re-run every time the SPA router swaps Cart back into view
document.addEventListener(
    "spa:pageload",
    (e) => {

        if (
            e.detail.page === "cart"
        ) {

            initCartPage();

        }

    }
);

// document.querySelector(".searchBarContainer").style.display="none"

