import os
import json
import redis
from dotenv import load_dotenv
from celery_worker import celery
from flask_socketio import SocketIO

load_dotenv(override=True)

HOST = os.getenv("Redis_uri")
PORT = os.getenv("Redis_port")
USERNAME = os.getenv("Redis_USERNAME")
PASSWORD = os.getenv("Redis_PASSWORD")

if USERNAME and PASSWORD:
    REDIS_URL = f"redis://{USERNAME}:{PASSWORD}@{HOST}:{PORT}/0"
else:
    REDIS_URL = "redis://127.0.0.1:6379/0"

# REDIS_URL = f"redis://{USERNAME}:{PASSWORD}@{HOST}:{PORT}/0"

print("in redis", REDIS_URL)

socketio = SocketIO(message_queue=REDIS_URL)


# -------------------------
# Pooled connection
# -------------------------

pool = redis.ConnectionPool(
    host=HOST,
    port=PORT,
    username=USERNAME,
    password=PASSWORD,
    max_connections=30,
    decode_responses=True,
    db=0,
    socket_keepalive=True,
    health_check_interval=30,
)

r = redis.Redis(connection_pool=pool)

try:
    r.ping()
except Exception as e:
    print("Redis connection error:", e)


# =========================================================
# Lua scripts
#
# Data model per user:
#
# cart:{uid}:meta
#     -> hash {
#          uid,
#          total
#        }
#
# cart:{uid}:items
#     -> hash {
#          item_id: json({
#              name,
#              qty,
#              price,
#              available_qty
#          })
#        }
#
# =========================================================


_ADD_CART_LUA = """
local meta_key = KEYS[1]
local items_key = KEYS[2]

local uid = ARGV[1]
local item_id = ARGV[2]
local item_name = ARGV[3]
local qty_delta = tonumber(ARGV[4])
local price = tonumber(ARGV[5])
local available_qty = tonumber(ARGV[6])

-- Check existing item
local existing = redis.call('HGET', items_key, item_id)

local item

if existing then

    item = cjson.decode(existing)

    local new_qty = item.qty + qty_delta

    if new_qty > available_qty then
        return cjson.encode({
            success = false,
            message = "Only " .. available_qty .. " items available."
        })
    end

    item.qty = new_qty
    item.available_qty = available_qty

else

    if qty_delta > available_qty then
        return cjson.encode({
            success = false,
            message = "Only " .. available_qty .. " items available."
        })
    end

    item = {
        name = item_name,
        qty = qty_delta,
        price = price,
        available_qty = available_qty
    }

end

-- Initialize cart metadata if it doesn't exist
if redis.call('EXISTS', meta_key) == 0 then

    redis.call(
        'HSET',
        meta_key,
        'uid',
        uid,
        'total',
        0
    )

end

-- Save item
redis.call(
    'HSET',
    items_key,
    item_id,
    cjson.encode(item)
)

-- Update total
local total = redis.call(
    'HINCRBY',
    meta_key,
    'total',
    qty_delta * item.price
)

return cjson.encode({
    success = true,
    total = total,
    item = item
})
"""


_UPDATE_QTY_LUA = """
local meta_key = KEYS[1]
local items_key = KEYS[2]

local item_id = ARGV[1]
local change = tonumber(ARGV[2])

if change == 0 then
    return cjson.encode({
        success = false,
        message = "No change to apply"
    })
end

local existing = redis.call('HGET', items_key, item_id)

if not existing then
    return cjson.encode({
        success = false,
        message = "Item not found"
    })
end

local item = cjson.decode(existing)

local old_qty = item.qty
local price = item.price
local available = item.available_qty

-- Increasing quantity
if change > 0 and (old_qty + change) > available then

    return cjson.encode({
        success = false,
        message = "Only " .. available .. " items available."
    })

end

local new_qty = old_qty + change

local total
local removed = false

-- Remove item completely
if new_qty <= 0 then

    redis.call(
        'HDEL',
        items_key,
        item_id
    )

    total = redis.call(
        'HINCRBY',
        meta_key,
        'total',
        -(old_qty * price)
    )

    removed = true

else

    item.qty = new_qty

    redis.call(
        'HSET',
        items_key,
        item_id,
        cjson.encode(item)
    )

    total = redis.call(
        'HINCRBY',
        meta_key,
        'total',
        change * price
    )

end

-- If cart becomes empty, remove the cart completely
if redis.call('HLEN', items_key) == 0 then

    redis.call('DEL', meta_key)
    redis.call('DEL', items_key)

    total = 0

end

return cjson.encode({
    success = true,
    total = total,
    removed = removed
})
"""


add_cart_script = r.register_script(_ADD_CART_LUA)
update_qty_script = r.register_script(_UPDATE_QTY_LUA)


# =========================================================
# Public API
# =========================================================


def add_cart(
    resid,
    uid,
    item_name,
    res_name,
    item_id,
    qty,
    price,
    available_qty,
    replace=False
):

    # Keep these variables because they are already used
    # throughout your application.
    resid = str(resid)
    uid = str(uid)
    item_id = str(item_id)

    try:
        qty = int(qty)
        price = int(price)
        available_qty = int(available_qty)

    except (TypeError, ValueError):

        return {
            "success": False,
            "message": "Invalid input"
        }

    if qty <= 0:

        return {
            "success": False,
            "message": "Quantity must be positive"
        }

    if available_qty < 0:

        return {
            "success": False,
            "message": "Invalid available quantity"
        }

    if price < 0:

        return {
            "success": False,
            "message": "Invalid price"
        }

    meta_key = f"cart:{uid}:meta"
    items_key = f"cart:{uid}:items"
    print(qty,available_qty)
    result = add_cart_script(
        keys=[
            meta_key,
            items_key
        ],
        args=[
            uid,
            item_id,
            item_name,
            qty,
            price,
            available_qty
        ]
    )

    result = json.loads(result)

    if not result.get("success"):
        return result

    # Build complete updated cart
    total = int(r.hget(meta_key, "total"))

    all_items = {}

    for key, value in r.hgetall(items_key).items():

        all_items[key] = json.loads(value)

    updated_cart = {
        "uid": uid,
        "total": total,
        "items": all_items
    }

    return {
        "success": True,
        "updated_cart": updated_cart,
        "total": total
    }


def update_cart_qty(uid, item_id, change):

    try:
        change = int(change)

    except (TypeError, ValueError):

        return {
            "success": False,
            "message": "Invalid change value"
        }

    # if change not in (-1, 1):

    #     return {
    #         "success": False,
    #         "message": "change must be +1 or -1"
    #     }

    uid = str(uid)
    item_id = str(item_id)

    meta_key = f"cart:{uid}:meta"
    items_key = f"cart:{uid}:items"

    result = update_qty_script(
        keys=[
            meta_key,
            items_key
        ],
        args=[
            item_id,
            change
        ]
    )

    result = json.loads(result)

    if not result.get("success"):
        return result

    # Cart became empty
    if result.get("removed") and not r.exists(items_key):

        return {
            "success": True,
            "updated_cart": {
                "uid": uid,
                "total": 0,
                "items": {}
            },
            "total": 0
        }

    total = int(
        r.hget(meta_key, "total") or 0
    )

    raw_items = r.hgetall(items_key)

    all_items = {
        key: json.loads(value)
        for key, value in raw_items.items()
    }

    updated_cart = {
        "uid": uid,
        "total": total,
        "items": all_items
    }

    return {
        "success": True,
        "updated_cart": updated_cart,
        "total": total
    }


# =========================================================
# Distance
# =========================================================

from math import radians, sin, cos, sqrt, atan2


def distance_km(lat1, lon1, lat2, lon2):

    R = 6371

    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)

    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(dlon / 2) ** 2
    )

    c = 2 * atan2(
        sqrt(a),
        sqrt(1 - a)
    )

    return R * c


# =========================================================
# Driver location
# =========================================================

import time


def update_driver_location(driver_id, lat, lng):

    driver_id = str(driver_id)

    pipe = r.pipeline()

    pipe.geoadd(
        "available_drivers",
        (lng, lat, driver_id)
    )

    pipe.hset(
        f"driver:{driver_id}",
        mapping={
            "status": "available",
            "last_seen": time.time(),
            "last_lat": lat,
            "last_lng": lng,
        }
    )

    pipe.execute()

    return {
        "success": True
    }


def free_driver(driver_id):
    """
    Call after a delivery is completed (or cancelled)
    so the driver becomes searchable again, using
    their last known location.
    """

    driver_id = str(driver_id)

    details = r.hgetall(
        f"driver:{driver_id}"
    )

    lat = details.get("last_lat")
    lng = details.get("last_lng")

    if lat and lng:

        return update_driver_location(
            driver_id,
            float(lat),
            float(lng)
        )

    # No location on file yet
    r.hset(
        f"driver:{driver_id}",
        "status",
        "offline"
    )

    return {
        "success": True
    }


def set_driver_offline(driver_id):
    """
    Call when a driver explicitly toggles offline.
    Keeps their hash so last_lat/last_lng survive,
    but removes them from the searchable set.
    """

    driver_id = str(driver_id)

    pipe = r.pipeline()

    pipe.zrem(
        "available_drivers",
        driver_id
    )

    pipe.hset(
        f"driver:{driver_id}",
        "status",
        "offline"
    )

    pipe.execute()

    return {
        "success": True
    }


# =========================================================
# Accept order
# =========================================================


def accept_order_redis(order_id, driver_id):

    total = time.perf_counter()

    order_id = str(order_id)
    driver_id = str(driver_id)

    t = time.perf_counter()

    won = r.set(
        f"order:{order_id}:lock",
        driver_id,
        nx=True,
        ex=60
    )

    set_time = time.perf_counter() - t

    if not won:

        return False, None

    key = f"order_request:{order_id}:{driver_id}"

    t = time.perf_counter()

    raw = r.get(key)

    get_time = time.perf_counter() - t

    if not raw:

        # Request expired, or was never sent
        # to this driver.
        r.delete(
            f"order:{order_id}:lock"
        )

        return False, None

    request = json.loads(raw)

    t = time.perf_counter()

    mark_driver_busy(driver_id)

    busy_time = time.perf_counter() - t

    # print(
    #     f"REDIS "
    #     f"SET={set_time:.6f}s "
    #     f"GET={get_time:.6f}s "
    #     f"BUSY={busy_time:.6f}s"
    # )

    # print(
    #     "accept_redis",
    #     time.perf_counter() - total
    # )

    return True, request


def delete_lock(order_id):

    r.delete(
        f"order:{order_id}:lock"
    )


# delete_lock("6a6f3511d9808c816b5d9930")


def mark_driver_busy(driver_id):
    """
    Call this when a driver is matched/assigned a ride.
    """

    pipe = r.pipeline()

    pipe.zrem(
        "available_drivers",
        driver_id
    )

    pipe.hset(
        f"driver:{driver_id}",
        "status",
        "busy"
    )

    pipe.execute()

    return {
        "success": True
    }


def mark_driver_available(driver_id, lat, lng):
    """
    Call this when a driver finishes a ride
    and is free again.
    """

    return update_driver_location(
        driver_id,
        lat,
        lng
    )


# =========================================================
# Search driver
# =========================================================


@celery.task
def search_driver(
    res_loc,
    username,
    user_coordinates,
    number,
    order_id,
    count=10
):

    base_pay = 20

    longitude = res_loc["lng"]
    latitude = res_loc["lat"]

    drivers = r.geosearch(
        "available_drivers",
        longitude=longitude,
        latitude=latitude,
        radius=3,
        unit="km",
        withdist=True,
        sort="ASC",
        count=count
    )

    delivery_distance = distance_km(
        latitude,
        longitude,
        float(user_coordinates["latt"]),
        float(user_coordinates["long"])
    )

    if not drivers:

        return {
            "success": False,
            "message": "No drivers nearby"
        }

    for driver in drivers:

        driver_id = driver[0]

        warehouse_km = float(
            driver[1]
        )

        # Calculate on server
        amount = round(
            base_pay
            + (3 * warehouse_km)
            + (8 * delivery_distance)
        )

        # Server-side order request
        request_data = {

            "order_id": str(order_id),

            "driver_id": str(driver_id),

            "warehouse_km": warehouse_km,

            "customer_km": delivery_distance,

            "base_pay": base_pay,

            "pickup_rate": 3,

            "delivery_rate": 8,

            "amount": amount,

            "customer_name": username,
            "customer_number":number,

            "warehouse_lng": longitude,

            "warehouse_lat": latitude,

            "customer_lng": user_coordinates["long"],

            "customer_lat": user_coordinates["latt"],

            "status": "pending"
        }

        # Store server-side
        key = (
            f"order_request:"
            f"{order_id}:"
            f"{driver_id}"
        )

        r.set(
            key,
            json.dumps(request_data),
            ex=120
        )

        # Send to driver
        socketio.emit(
            "order_request",
            {
                "order_id": str(order_id),

                "driver_id": str(driver_id),

                "distance_km":
                    warehouse_km
                    + delivery_distance,

                "customer_km":
                    delivery_distance,

                "warehouse_km":
                    warehouse_km,

                "amt":
                    amount,

                "customer_name":
                    username,
                "customer_number":number,
                "warehouse_lng":
                    longitude,

                "warehouse_lat":
                    latitude,

                "customer_lng":
                    user_coordinates["long"],

                "customer_lat":
                    user_coordinates["latt"]
            },

            room=f"driver_{driver_id}"
        )

    return {
        "success": True,

        "drivers": [
            {
                "driver_id": driver[0],
                "distance_km": float(driver[1])
            }

            for driver in drivers
        ]
    }


# =========================================================
# Get cart
# =========================================================

import orjson


def get_cart(uid):

    uid = str(uid)

    meta_key = f"cart:{uid}:meta"
    items_key = f"cart:{uid}:items"

    pipe = r.pipeline()

    pipe.hgetall(meta_key)

    pipe.hgetall(items_key)

    meta, raw_items = pipe.execute()

    if not meta:

        return None

    if not raw_items:

        return None

    items = {
        item_id: orjson.loads(value)

        for item_id, value
        in raw_items.items()
    }

    return {
        "uid": uid,

        "total":
            int(meta.get("total", 0)),

        "items": items
    }


# =========================================================
# Delete cart
# =========================================================


def delete_cart(uid, session=None):

    uid = str(uid)

    pipe = r.pipeline()

    pipe.delete(
        f"cart:{uid}:meta"
    )

    pipe.delete(
        f"cart:{uid}:items"
    )

    pipe.execute()


# =========================================================
# Generic JSON helper
# =========================================================


def add_json(userid, key, data, expiry=None):

    try:

        value = json.dumps(data)

        if expiry:

            r.set(
                key,
                value,
                ex=expiry
            )

        else:

            r.set(
                key,
                value
            )

        return True

    except Exception as e:

        # print("Error:", e)

        return False


# =========================================================
# Distributed lock
# =========================================================

import uuid


_RELEASE_LOCK_LUA = """
if redis.call('GET', KEYS[1]) == ARGV[1] then
    return redis.call('DEL', KEYS[1])
else
    return 0
end
"""


release_lock_script = r.register_script(
    _RELEASE_LOCK_LUA
)


def acquire_lock(key, ttl_seconds=15):
    """
    Returns a token if lock acquired,
    None if already locked.
    """

    token = str(
        uuid.uuid4()
    )

    acquired = r.set(
        key,
        token,
        nx=True,
        ex=ttl_seconds
    )

    return token if acquired else None


def release_lock(key, token):
    """
    Only releases the lock if we're still the owner
    (didn't expire + get re-grabbed).
    """

    try:

        release_lock_script(
            keys=[key],
            args=[token]
        )

    except Exception as e:

        print(
            "release_lock error:",
            e
        )


# delete_cart("6a56037c0d65ee6492341c02")