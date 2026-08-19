// const filterDropdown = document.getElementById("filterDropdown");
// async function applyFiter() {
//     console.log(filterDropdown.value.toLowerCase());
//     const cards = document.querySelectorAll(".order-card");

//     cards.forEach(card => {
//         console.log("hello")
//         const statusText = card
//             .querySelector(".order-status")
//             .textContent
//             .trim()
//             .toLowerCase();
//         console.log(true)
//         if (filterDropdown.value.toLowerCase() === "all" || statusText === filterDropdown.value.toLowerCase()) {
//             console.log(true)

//             card.style.display = "block";
//         } else {
//             card.style.display = "none";
//         }
//     });
//     filterDropdown.addEventListener("change", () => {
//         const selected = filterDropdown.value.toLowerCase();
//         console.log(selected)
//         const cards = document.querySelectorAll(".order-card");

//         cards.forEach(card => {
//             const statusText = card
//                 .querySelector(".order-status")
//                 .textContent
//                 .trim()
//                 .toLowerCase();

//             if (selected === "all" || statusText === selected) {
//                 const buttons = card.querySelectorAll(".statusBtn");
//                 if (selected !== "placed") {
//                     console.log("alls")
//                     // get ALL buttons with class statusBtn inside this card
    
//                     buttons.forEach(btn => {
//                         btn.disabled = true;
//                         btn.style.opacity = "0.5";   // optional visual
//                         btn.style.cursor = "not-allowed";
//                         btn.style.visibility="hidden"
//                     });
                    
//                 }
//                 else{
//                     buttons.forEach(btn => {
//                         btn.disabled = false;
//                         btn.style.opacity = "1";   // optional visual
//                         btn.style.cursor = "pointer";
//                         btn.style.visibility="visible"
//                     });
//                 }
//                 card.style.display = "block";
//             } else {
//                 card.style.display = "none";
//             }
//         });
//     });
// }
const pathParts = window.location.pathname.split("/");

const resId = pathParts[pathParts.length - 1];
const type = pathParts[pathParts.length - 4];
const resname=pathParts[pathParts.length - 2]
console.log(resId,name,type);
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

        // const show = selected === "all" || statusText === selected;

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

// const pathParts = window.location.pathname.split("/");
// const resID = pathParts[pathParts.length - 1];
// console.log(resID)
// const resId=localStorage.getItem("res_id")
// const pathParts = window.location.pathname.split("/");

// const resId = pathParts[pathParts.length - 1];
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
let driverMarker = null;
let map=null
let warehouseMarker = null;
let driverRouteLine = null;

let currentDriverPosition = null;
let animationFrame = null;
socket.on("driver_assigned", (data) => {
    console.log("Driver assigned:", data.order_id);

    const cards = document.querySelectorAll(".order-card");

    cards.forEach(card => {
        // const orderId = card
        //     .querySelector(".order-id")
        //     .textContent
        //     .replace("#", "")
        //     .trim();
        const orderId = card
            .querySelector(".order-id")
            .getAttribute("id")
        if (orderId === String(data.order_id)) {
            // Move this card to the very top
            ordersList.prepend(card);

            // Optional: make it visually noticeable
            card.style.transition = "background-color 0.3s";
            card.style.backgroundColor = "#fff8e1";
            card.querySelector(".order-header .order-status").textContent="Driver is Arriving..."
            card.querySelector(".order-header .order-status").style.backgroundColor="#25a140"
            card.querySelector(".order-header .order-status").style.color="blanchedalmond"
            card.querySelector("#controlBtn .cancelBtn").style.display = "none";
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
            controlBtn.appendChild(trackBtn);
            trackBtn.addEventListener("click", () => {
                // const orderid = card
                //     .querySelector(".order-id")
                //     .textContent
                //     .replace("#", "")
                //     .trim();
                const orderid = card
                    .querySelector(".order-id").getAttribute("id")
                console.log("emitting")
                socket.emit("track_order", {order_id: orderid});
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
socket.on("update_driver_location",(data)=>{
    console.log("recieved new location",data);
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
    .querySelector(".order-status").textContent="cancelled"
        console.log(status);
        
        console.log(cardToken,data.token_no);
        
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
    if(res.status ==401){
        alert("unauthorized,Please Log in")
        window.location.href="/login/seller";
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

        htmlParts.push(`
            <div class="order-card" user_id=${order.user_id}>
                <div class="order-header">
                    <span class="order-id" id=${order.user_order_id}>#${order.order_id}</span>
                    <span class="order-status status-${order.status}">${order.status}</span>
                </div>
                <div class="token-no">Token No: ${order.token_no}</div>
                <div class="order-date">${order.time}</div>
                ${restaurantsHTML}
                <div class="total">Total: ₹${total}</div>
                <div id=controlBtn>
                <button class="completeBtn statusBtn" style="...">Completed</button>
                <button class="cancelBtn statusBtn" style="...">Cancel Order</button>
                </div>
            </div>
        `);

        if (order.status === "placed") total_orders++;
    });

    ordersList.innerHTML = htmlParts.join(""); // single write
    document.getElementById("active_orders").textContent = total_orders;
    applyFilter();
}
total_orders=0;
async function loadOrderss() {
    const res = await fetch(`/seller/orders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ "res_id": resId })
    });
    if(res.status ==401){
        alert("unauthorized,Please Log in")
        window.location.href="/login/seller";
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

        // Object.entries(order).forEach(([resName, details]) => {
        //     console.log(resName)
        //     console.log(details)
        // restaurantsHTML += `<div class="restaurant-name">${details.name}</div>`;

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
        // });

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
            total_orders+=1;
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
        const item_id=item.getAttribute("item_id")

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
                res_id:resId,
                status: "completed"   // 🔥 send this instead
            }
            // (response) => {
            //     console.log(response)
            //     if (response.success) {
            //         console.log("Order updated successfully");
            //     } else {
            //         alert(response.message)
            //         console.error(response.message);
            //     }
            // }
            );
            // 🔥 UPDATE UI HERE
            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "completed";   // or "completed"
            statusSpan.className = "order-status status-completed";

            // optional UX improvement
            // e.target.disabled = true;
            // e.target.innerText = "Done ✔";
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
                res_id:resId,
                status: "canceled"  // 🔥 send this instead
            });
            // 🔥 UPDATE UI HERE
            const statusSpan = card.querySelector(".order-status");
            statusSpan.textContent = "canceled";   // or "completed"
            statusSpan.className = "order-status status-canceled";

            // optional UX improvement
            // e.target.disabled = true;
            // e.target.innerText = "Done ✔";
            card.remove();
            console.log("Completed sent:", orderId, tokenNo);
        }
        else {
            alert("failed updating status")
        }
    }
});
document.getElementById("backBtn").addEventListener("click",()=>{
    document.getElementById("map-block").classList.remove("active")
})
const overlay=document.querySelector(".overlay")
document.getElementById("menuToggle").onclick = function () {
  const sidebar=document.querySelector(".sidebar")
  sidebar.classList.add("show")
  sidebar.style.display="block"
  overlay.classList.add("show")
};

document.getElementById("hideCategoryBtn").addEventListener("click", function () {
  const sidebar=document.querySelector(".sidebar")
  sidebar.style.display="none"
  overlay.classList.remove("show")
});
overlay.addEventListener("click",()=>{
  const sidebar=document.querySelector(".sidebar")
  overlay.classList.remove("show")
  sidebar.style.display="none"
  sidebar.classList.remove("show")
})
// const map = L.map("map").setView([17.385, 78.4867], 13);
// L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
//     attribution: "© OpenStreetMap contributors"
// }).addTo(map);

// const DashboardBtn=document.getElementById("DashboardBtn")
// DashboardBtn.addEventListener("click",()=>{
//   window.location.href=`/seller/${resname}/${resId}`
// })
// const InventoryBtn=document.getElementById("InventoryBtn")
// InventoryBtn.addEventListener("click",()=>{
//   window.location.href=`/seller/menu/${resname}/${resId}`
// })