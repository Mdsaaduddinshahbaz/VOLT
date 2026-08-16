# from redis_db import search_driver

# result = search_driver.delay({"lat":  
# 17.388879, "lng": 78.428223},"saad",{"long":78.470354,"latt":17.452852},"6a6f3511d9808c816b5d9930")

# print("Task ID:", result.id)

# #"celery -A redis_db.celery worker --loglevel=info --pool=solo"

# from database import accept_delivery_order

# accept_delivery_order("6a6f3511d9808c816b5d9930","6a7b39442f2f1da998fb0928",{"amount":10})
from redis_db import r
r.delete(*r.keys("order_request:*"))
# r.delete(*r.keys("order:*"))
cursor = 0

while True:
    cursor, keys = r.scan(cursor, match="order:*", count=1000)

    if keys:
        r.delete(*keys)

    if cursor == 0:
        break
print("deleted")
from orderIds import orderIds
import jwt,json
from driver_tokens import tokens
for i in range(len(tokens)):
    payload=jwt.decode(
        tokens[i],
        "bdanbfuwetwnnfju327832y8932uhjfhdj",
        algorithms="HS256"
    )
    driver_id= payload["driver_id"]
    order_id=orderIds[i]
    request_data = {
        "order_id": order_id,
        "driver_id": driver_id,
        "warehouse_km": 1.0,
        "customer_km": 2.0,
        "base_pay": 20,
        "pickup_rate": 3,
        "delivery_rate": 8,
        "amount": 39.0,
        "customer_name": "load_test",
        "warehouse_lng": 78.4,
        "warehouse_lat": 17.4,
        "customer_lng": 78.41,
        "customer_lat": 17.41,
        "status": "pending"
    }

    r.set(
        f"order_request:{order_id}:{driver_id}",
        json.dumps(request_data),
        ex=7200
    )
print(f"Seeded {len(tokens)} order requests")