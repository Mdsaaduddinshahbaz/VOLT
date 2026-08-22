from pymongo import MongoClient,UpdateOne,ReturnDocument
from pymongo.errors import DuplicateKeyError,OperationFailure
from dotenv import load_dotenv
from bson import ObjectId
from datetime import datetime
import time
# def hash_password(plain_password: str) -> str:
#     return bcrypt.hashpw(plain_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        if(plain_password==hashed_password):
            return True
        # return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))

    except (ValueError, TypeError):
        return False

import os
from redis_db import delete_cart, get_cart, free_driver, set_driver_offline
load_dotenv(override=True)
api=os.getenv("MONGO_URI",None)
client = MongoClient(api)
try:
    client.admin.command('ping')
    print("Connected successfullyto MongoDB Atlas!")
except Exception as e:
    print("Connection failed:", e)

db=client["restaurants"]
db.restaurants_name.create_index([("location", "2dsphere")])

# ##print(db.restaurants.index_information())
restaurants_name=db["restaurants_name"]
resturants_items=db["resturants_items"]
owners=db["owners"]
customers=db["customers"]
customer_carts=db["customer_carts"]
orders=db["Orders"]
seller_orders=db["seller_orders"]
users=db["users"]
drivers=db["drivers"]
categories=db["categories"]
MAX_RETRIES = 5
users.create_index("email", unique=True)
owners.create_index("email", unique=True)
seller_orders.create_index([("driver_id", 1), ("delivery_status", 1)])
seller_orders.create_index("parent_order_id")
def add_resturant_owner(username,password):
    owners.insert_one({"username":username,"password":password})
def add_resturants(name,address,phone,owner_id,long,latt,file_id="1nR05-X2jjSDUdZNbVmpYBr-bsqv5UhVz"):
    # res=restaurants_name.insert_one({"name":name,"address":address,"phone_no":phone,"ownerId":owner_id,"location":{"type":"Point","coordinates":[long,latt]}})
    with client.start_session() as session:
        with session.start_transaction():

            result=restaurants_name.insert_one({"name":name,"address":address,"phone_no":phone,"ownerId":owner_id,"location":{"type":"Point","coordinates":[long,latt]},"file_url": f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"},session=session)
            # parent_id = result.inserted_id 
            
            # 3. Add that parent_id to every seller doc before inserting
            owners.update_one(
                {"_id": ObjectId(owner_id)},
                {
                    "$set": {
                        "is_setup":True,
                        "restaurant_name": name,
                        "resturant_id":str(result.inserted_id)
                    }
                    # OR use $push if one owner can have multiple restaurants
                },
                session=session
            )
    return str(result.inserted_id )
def add_resturant_items(resturant_id,item_name,item_qty,price,sub_id,desc,unit,lowat,available,sold=0,file_id="1nR05-X2jjSDUdZNbVmpYBr-bsqv5UhVz"):
    ret=resturants_items.insert_one({"resturant_id":resturant_id,"item_name":item_name,"item_qty":item_qty,"price":price,"sub_id":sub_id,"desc":desc,"unit":unit,"lowat":lowat,"available":available,"sold":sold,"file_url": f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"})
    return ({"id":str(ret.inserted_id),"url":f"https://drive.google.com/thumbnail?id={file_id}&sz=w1000"})
def list_resturant_items(resturant_id,types):
    if(types=="seller"):
        res=resturants_items.find({"resturant_id":resturant_id})
        cat=categories.find_one({"restaurant_id":resturant_id}, {"_id": 0})
        # for c in cat:
            ##print("c=",c)
        # ##print("cat",cat)
        item_name={}
        for r in res:
            item_name[ str(r["_id"])]={
                    "price": r["price"],
                    "name": r["item_name"],   # convert ObjectId to string
                    "item_qty":r["item_qty"],
                    "sold":r["sold"],
                    "sub_id":r["sub_id"],
                    "desc":r["desc"],
                    "unit":r["unit"],
                    "lowat":r["lowat"],
                    "available":r["available"],
                    "file_url":r["file_url"]
                }
        return ({"item_name":item_name,"categories":cat})
    else:
        # res=resturants_items.find({"resturant_id":resturant_id})
        res=resturants_items.find({})
        item_name={}
        for r in res:
            if((int(r["item_qty"])-int(r["sold"]))>0):
                item_name[ r["item_name"]]={
                        "price": r["price"],
                        "id": str(r["_id"]),
                        "item_qty":(int(r["item_qty"])-int(r["sold"])),
                        "file_url":r["file_url"]
                    }
        return ({"item_name":item_name})
def update_resturant_item(item_id,name,price,unit,lowAt,desc,subId,stock,available,res_id=None):
    result=resturants_items.find_one_and_update({
        "_id": ObjectId(item_id),
        "resturant_id": res_id
    },
    {"$set":
            {"item_name":name,
                "price":int(price),
                "unit":unit,
                "lowat":lowAt,
                "desc":desc,
                "sub_id":subId,
                "item_qty":stock,
                "available":available}
    }
    )
    if(result):
        return({"success":True})
    # Only on failure
    item = resturants_items.find_one({"_id": ObjectId(item_id)})

    if item is None:
        return {"success": False, "message": "Item not found"}

    return {"success": False, "message": "Unauthorized"}
# def list_resturants(long,latt):
#     restaurants = restaurants_name.find({
#         "location": {
#             "$near": {
#                 "$geometry": {
#                     "type": "Point",
#                     "coordinates": [long,latt]
#                 },
#                 "$maxDistance": 1000
#             }
#         }
#     })
#     res_names={}
#     for r in restaurants:
#         ##print(r["name"])
#         res_names[r["name"]]=str(r["_id"])
#         # res_names.append(r["name"])
#     return res_names
def list_resturants(long,latt,dist:int=5):
    restaurants = restaurants_name.find({
        "location": {
            "$near": {
                "$geometry": {
                    "type": "Point",
                    "coordinates": [long,latt]
                },
                "$maxDistance": dist*1000
            }
        }
    })
    res_names={}
    # for r in restaurants:
    #     ##print(r["name"])
    #     res_names[r["name"]]={"res_id":str(r["_id"]),"address":r["address"],"file_url":r["file_url"]}
    for r in restaurants:
        ##print(r["name"])
        res_names[str(r["_id"])]={"res_name":r["name"],"address":r["address"],"file_url":r["file_url"]}
        # res_names.append(r["name"])
    return res_names
def add_new_customer(username,password):
    customers.insert_one({"username":username,"password":password})
def add_customer_items(item_name,resturant_id,item_id):
    customer_carts.insert_one({"item_name":item_name,"resturant_id":resturant_id,"item_id":item_id})
def remove_itemss(item_id,res_id=None):
    result=resturants_items.find_one_and_delete({
        "_id": ObjectId(item_id),
        "resturant_id": res_id
    })
    if(result):
        return({"success":True})
    # Only on failure
    item = resturants_items.find_one({"_id": ObjectId(item_id)})

    if item is None:
        return {"success": False, "message": "Item not found"}

    return {"success": False, "message": "Unauthorized"}
# def store_orders(userid,items):
#     # orders.insert_one({"user_id":userid,"items":items,"time":datetime.utcnow()})
#     # for order in items:
#     #     ##print("order=",order)
#     ##print(items)
from datetime import datetime
import uuid
def normalize_cart(items):
    ##print("items in normalize",items)
    normalized = {}

    for res_id, data in items.items():
        res_name = data.get("name", "unknown")

        # If items is already dict → OK
        if isinstance(data["items"], dict):
            normalized[res_id] = data

        # If items is list → convert to dict
        elif isinstance(data["items"], list):
            item_dict = {}
            for item in data["items"]:
                item_name = item.get("name", "item")
                item_dict[item_name] = item

            normalized[res_id] = {
                "name": res_name,
                "items": item_dict
            }

    return normalized
def generate_token():
    while True:
        token = str(uuid.uuid4())[:6].upper()
        
        if not orders.find_one({"token_no": token}):
            return token
def stores_orders(userid, coordinates):
    # #print("in store_orders db")
    # token = generate_token()
    ##print("in store orders db")
    start=time.perf_counter()
    token="123"
    items = get_cart(userid)
    print("items1",items)
    if not items or not items.get("cart"):
        return 404

    current_time = datetime.utcnow()
    seller_docs = []
    inventory_updates = []
    restaurant_ids = []

    for restaurant_id, restaurant in items["cart"].items():
        ##print(restaurant_id,restaurant)
        item_ids = [ObjectId(iid) for iid in restaurant["items"].keys()]
        ##print("after item ids",item_ids)
        fresh_docs = resturants_items.find(
            {"_id": {"$in": item_ids}},
            {"_id": 1, "price": 1, "available": 1}
        )
        ##print("fresh_docs",fresh_docs,"\n")
        # {##print(d):d for d in fresh_docs}
        price_map={}
        # for d in fresh_docs:
        #     ##print({d["_id"]:d})
        ##print("after fresh docs")
        price_map = {str(d["_id"]): d for d in fresh_docs}
        ##print("after price_map",price_map)
        verified_items = {}

        for item_id, item in restaurant["items"].items():
            fresh = price_map.get(item_id)
            ##print("after fresh")
            if not fresh:
                ##print("in if not fresh")
                return {"success": False, "message": "Item no longer available"}
            ##print("after if not fresh")
            if fresh["available"] < item["qty"]:
                ##print("in <")
                return {
                    "success": False,
                    "message": f"{item.get('item','Item')} is out of stock"
                }

            if fresh["price"] != item["price"]:
                print(f"PRICE MISMATCH user={userid} item={item_id} "
                      f"cart={item['price']} actual={fresh['price']}")
                return {
                    "success": False,
                    "message": f"Price changed for {item.get('item','an item')}, please review your cart"
                }
            ##print("after validation")
            verified_item = dict(item)
            verified_item["price"] = fresh["price"]
            verified_items[item_id] = verified_item
            ##print("before inventory updates ")
            inventory_updates.append(
                UpdateOne(
                    {"_id": ObjectId(item_id), "available": {"$gte": item["qty"]}},
                    {"$inc": {"available": -item["qty"], "sold": item["qty"]}}
                )
            )
            ##print("after inventory updates",item_id,type(item_id))
        restaurant_ids.append(restaurant_id)
        # seller_docs.append({
        #     "user_id": userid,
        #     "token_no": token,
        #     "restaurant_id": restaurant_id,
        #     "restaurant_name": restaurant["name"],
        #     "items": verified_items,
        #     "status": "placed",
        #     "time": current_time,
        #     "user_adres": coordinates
        # })
        seller_doc={
            "user_id": userid,
            "token_no": token,
            "restaurant_id": restaurant_id,
            "restaurant_name": restaurant["name"],
            "items": verified_items,
            "status": "placed",
            "time": current_time,
            "user_adres": coordinates
        }

    seller_order_ids = []

    for attempt in range(MAX_RETRIES):
        try:
            with client.start_session() as session:
                with session.start_transaction():
                    result = orders.insert_one(
                        {
                            "user_id": userid,
                            "token_no": token,
                            "status": "placed",
                            "items": items,
                            "time": current_time,
                            "coordinates": coordinates
                        },
                        session=session
                    )
                    parent = str(result.inserted_id)

                    # for doc in seller_docs:
                    #     doc["parent_order_id"] = parent

                    # if seller_docs:
                    #     insert_result = seller_orders.insert_many(seller_docs, session=session)
                    #     seller_order_ids = [str(_id) for _id in insert_result.inserted_ids]
                    seller_doc["parent_order_id"] =parent
                    res=seller_orders.insert_one(seller_doc,session=session)
                    seller_order_ids=[str(res.inserted_id)]
                    # if inventory_updates:
                    #     inventory_result = resturants_items.bulk_write(inventory_updates, session=session)
                    #     # if inventory_result.modified_count != len(inventory_updates):
                    #     #     raise Exception("Inventory unavailable")

            delete_cart(userid)
            #print("completed at ",start-time.perf_counter())
            return restaurant_ids, seller_order_ids,parent

        except OperationFailure as e:
            if "TransientTransactionError" in e.details.get("errorLabels", []):
                time.sleep(0.05)
                continue
            raise

    return False
def store_orders(userid, coordinates):
    print("in store_orders db")
    # token = generate_token()
    ##print("in store orders db")

    start = time.perf_counter()
    token = "123"

    items = get_cart(userid)

    print("items", items)

    if not items or not items.get("items"):
        return 404

    current_time = datetime.utcnow()

    seller_docs = []
    inventory_updates = []
    restaurant_ids = []

    # ---------------------------------------------------------
    # Get cart items
    # ---------------------------------------------------------

    cart_items = items["items"]

    item_ids = [
        ObjectId(iid)
        for iid in cart_items.keys()
    ]

    # ---------------------------------------------------------
    # Get fresh inventory data
    # ---------------------------------------------------------

    fresh_docs = resturants_items.find(
        {
            "_id": {
                "$in": item_ids
            }
        },
        {
            "_id": 1,
            "price": 1,
            "available": 1
        }
    )

    price_map = {
        str(d["_id"]): d
        for d in fresh_docs
    }

    verified_items = {}

    # ---------------------------------------------------------
    # Validate cart items
    # ---------------------------------------------------------

    for item_id, item in cart_items.items():

        fresh = price_map.get(item_id)

        if not fresh:

            return {
                "success": False,
                "message": "Item no longer available"
            }

        if fresh["available"] < item["qty"]:

            return {
                "success": False,
                "message": f"{item.get('name', 'Item')} is out of stock"
            }

        if fresh["price"] != item["price"]:

            print(
                f"PRICE MISMATCH "
                f"user={userid} "
                f"item={item_id} "
                f"cart={item['price']} "
                f"actual={fresh['price']}"
            )

            return {
                "success": False,
                "message": (
                    f"Price changed for "
                    f"{item.get('name', 'an item')}, "
                    f"please review your cart"
                )
            }

        verified_item = dict(item)

        verified_item["price"] = fresh["price"]

        verified_items[item_id] = verified_item

        # -----------------------------------------------------
        # Inventory update
        # -----------------------------------------------------

        inventory_updates.append(
            UpdateOne(
                {
                    "_id": ObjectId(item_id),
                    "available": {
                        "$gte": item["qty"]
                    }
                },
                {
                    "$inc": {
                        "available": -item["qty"],
                        "sold": item["qty"]
                    }
                }
            )
        )

    # ---------------------------------------------------------
    # Build order items
    # ---------------------------------------------------------

    order_items = {
        "uid": userid,
        "total": items["total"],
        "items": verified_items
    }

    seller_order_ids = []

    # ---------------------------------------------------------
    # Create order transaction
    # ---------------------------------------------------------

    for attempt in range(MAX_RETRIES):

        try:

            with client.start_session() as session:

                with session.start_transaction():

                    result = orders.insert_one(
                        {
                            "user_id": userid,
                            "token_no": token,
                            "status": "placed",
                            "items": order_items,
                            "time": current_time,
                            "coordinates": coordinates
                        },
                        session=session
                    )

                    parent = str(
                        result.inserted_id
                    )

                    # -------------------------------------------------
                    # Seller order
                    #
                    # Keeping your existing variable names.
                    # Since there is no restaurant in the cart anymore,
                    # restaurant-specific fields are not taken from cart.
                    # -------------------------------------------------

                    seller_doc = {
                        "user_id": userid,
                        "token_no": token,
                        "items": verified_items,
                        "status": "placed",
                        "time": current_time,
                        "user_adres": coordinates,
                        "parent_order_id": parent
                    }

                    res = seller_orders.insert_one(
                        seller_doc,
                        session=session
                    )

                    seller_order_ids = [
                        str(res.inserted_id)
                    ]

                    # -------------------------------------------------
                    # Update inventory atomically
                    # -------------------------------------------------

                    if inventory_updates:

                        inventory_result = (
                            resturants_items.bulk_write(
                                inventory_updates,
                                session=session
                            )
                        )

                        if (
                            inventory_result.modified_count
                            != len(inventory_updates)
                        ):

                            raise OperationFailure(
                                "Inventory changed while checkout "
                                "was processing."
                            )

            # ---------------------------------------------------------
            # Delete cart only after successful transaction
            # ---------------------------------------------------------

            delete_cart(userid)

            # print(
            #     "completed at ",
            #     time.perf_counter() - start
            # )

            return (
                seller_order_ids,
                parent
            )

        except OperationFailure as e:

            if (
                "TransientTransactionError"
                in e.details.get(
                    "errorLabels",
                    []
                )
            ):

                time.sleep(0.05)

                continue

            raise

    return False
def get_orders(userid):
    final_orders=[]
    orderss=orders.find({"user_id":userid})
    for order in orderss:
        data={
            "order_id":str(order["_id"]),
            "token_no":order["token_no"],
            "resturants":order["items"],
            "status":order["status"],
            "date":order["time"]
        }

        final_orders.append(data)
    return final_orders
def store_seller_orders(res_id,items,userid):
    seller_orders.insert_one({"res_id":res_id,"items":items,"user_id":userid,"time":datetime.utcnow()})
def get_seller_ordes(res_id):
    ##print(res_id)
    # orders=seller_orders.find({"restaurant_id":res_id})
    orders=seller_orders.find({})
    final_orders=[]
    ##print("seller_orders=",orders)
    for order in orders:
        data={
            "order_id":str(order["_id"]),
            "user_order_id":str(order["parent_order_id"]),
            "token_no":order["token_no"],
            "user_id":order['user_id'],
            "items":order["items"],
            "status":order["status"],
            "time":order["time"]
        }
        final_orders.append(data)
    return final_orders
def create_new_user(email,username, password,role):
    try:
        ##print("in create user")
        if(role=="seller"):
            # owner=owners.find_one({"email":email})
            # if owner is None:
            result =owners.insert_one({
                    "email": email,
                    "username":username,
                    "password": (password),
                    "role":role,
                    "is_setup":False,
                    "is_verified":False
                })
            return ({"success":True,"id":str(result.inserted_id)})
            # else:
            #     ##print(owner)
            #     return ({"success":False})
        else:
            # user = users.find_one({"email": email})
            # if user is None:
            result =users.insert_one({
                    "email": email,
                    "username":username,
                    "password": (password),
                    "role":role,
                    "is_verified":False
                })
            return ({"success":True,"id":str(result.inserted_id)})
            # else:
            #     return ({"success":False})
    except DuplicateKeyError:
        return {
            "success": False,
            "message": "Email already exists"
        }
    # return({"success":False})
def check_existing_user(email,password):
    ##print("in existing user")
    user=users.find_one({"email":email})
    ##print(user)
    if(user): 
        ##print("in existing user if block",password)
        if verify_password(password, user["password"]):
            if(user["role"]=="seller"):
                return ({"success":True,"userid":str(user["_id"]),"username":user["username"],"is_verified":user["is_verified"],"is_setup":user["is_setup"]})
            else:
                ##print("in existing user if if block")
                return ({"success":True,"userid":str(user["_id"]),"username":user["username"],"is_verified":user["is_verified"]})
        else:
            return {"success":False}
    else: return {"success":404}
def check_existing_owner(email,password):
    ##print("in existing user")
    owner=owners.find_one({"email":email})
    if(owner): 
        ##print("in existing user if block",password)
        if verify_password(password, owner["password"]):
            if(owner["is_verified"]):
                ##print("in existing user if if block")
                if(owner["is_setup"]):
                    return ({"success":True,"res_id":owner["resturant_id"],"username":owner["username"],"resturant_name":owner["restaurant_name"],"is_verified":owner["is_verified"],"is_setup":owner["is_setup"]})
                else:
                    return ({"success":True,"id":str(owner["_id"]),"is_verified":owner["is_verified"],"is_setup":owner["is_setup"]})
                # return ({"success":True,"res_id":owner["resturant_id"],"resturant_name":owner["restaurant_name"],"is_verified":owner["is_verified"],"is_setup":owner["is_setup"]})
            else:
                return ({"success":True,"user_id":str(owner["_id"]),"username":owner["username"],"is_verified":owner["is_verified"],"is_setup":owner["is_setup"]})
        else:
            return {"success":False}
    else: return {"success":404}
# def update_order_status_seller(order_id,status,userid):
#     with client.start_session() as session:
#         with session.start_transaction():
#             seller_orders.find_one_and_update({"_id":ObjectId(order_id)},{"$set":{"status":status}},session=session)
#             orders.find_one_and_update({"user_id":userid},{"$set":{"status":status}},session=session)
def update_order_status_seller(order_id, status, userid, res_id):
    with client.start_session() as session:
        with session.start_transaction():
            updated_seller_doc = seller_orders.find_one_and_update(
                {"_id": ObjectId(order_id)},
                {"$set": {"status": status}},
                session=session,
                return_document=ReturnDocument.AFTER
            )
            if not updated_seller_doc:
                return {"success": False, "message": "Order not found or unauthorized"}

            parent_id = updated_seller_doc.get("parent_order_id")
            if not parent_id:
                return {"success": False, "message": "Parent order not found"}

            parent_result = orders.find_one_and_update(
                {"_id": ObjectId(parent_id), "user_id": updated_seller_doc["user_id"]},
                {"$set": {"status": status}},
                session=session
            )
            if not parent_result:
                return {"success": False, "message": "Parent order not found"}

            return {"success": True}
def get_restaurant_location(res_id):
    restaurant = restaurants_name.find_one({"_id": ObjectId(res_id)}, {"location": 1})
    if not restaurant or "location" not in restaurant:
        return None
    long, latt = restaurant["location"]["coordinates"]
    return {"lat": latt, "lng": long}

def update_order_status_user(order_id,status,userid):
    print("in update order")
    order_id=str(order_id).strip()
    try:
        with client.start_session() as session:
            print("session started")
            with session.start_transaction():
                print("transaction started")
                print("amigo?",str(order_id).strip())
                updated_order=orders.find_one_and_update({"_id":ObjectId(order_id),"user_id": userid},{"$set":{"status":status}},session=session,return_document=ReturnDocument.AFTER)
                print("updated_order",updated_order)
                if not updated_order:
                    print("in not updated_ordere")
                    return {
                        "success": False,
                        "message": "Order not found or unauthorized"
                    }
                seller_orders.update_many({"parent_order_id":str(updated_order["_id"])},{"$set":{"status":status}},session=session)
                return ({"success":True})
    except Exception as e:
        print("in update_status",str(e))
def resturant_stats(res_id):
    seller_order_stats=seller_orders.find({"restaurant_id":res_id})
    Total_orders=0
    pending=0
    completed=0
    canceled=0
    for order in seller_order_stats:
        if(order["status"]=="placed"):
            Total_orders+=1
            pending+=1
        elif(order["status"]=="completed"):
            completed+=1
            Total_orders+=1
        else:
            Total_orders+=1
            canceled+=1
    stats={
        "Total_orders":Total_orders,
        "completed":completed,
        "canceled":canceled,
        "pending":pending
    }
    return stats
from pymongo import ReturnDocument

from pymongo import ReturnDocument

def add_subcategory(res_id, category_id, subcat_name):
    try:
        # Increment counter and get previous value
        doc = categories.find_one_and_update(
            {"restaurant_id": res_id},
            {"$inc": {"next_subcat_id": 1}},
            return_document=ReturnDocument.BEFORE
        )

        if doc is None:
            return {
                "success": False,
                "error": "Restaurant not found"
            }

        subcategory = {
            "_id": doc.get("next_subcat_id", 0) + 1,
            "name": subcat_name
        }

        result = categories.update_one(
            {
                "restaurant_id": res_id,
                "categories._id": int(category_id)
            },
            {
                "$push": {
                    "categories.$.subcategories": subcategory
                }
            }
        )

        if result.modified_count == 0:
            return {
                "success": False,
                "error": "Category not found"
            }

        return {
            "success": True,
            "subcategory": subcategory
        }

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }
def verify_order(res_id, order_id):
    order = seller_orders.find_one({
        "_id": ObjectId(order_id)
    })

    if order is None:
        return None

    return order["parent_order_id"]
# def get_resturantItem_price(res_id,item_id):
#     ##print("in get item price")
#     try:
#         res=resturants_items.find_one({
#             "_id":ObjectId(item_id),
#             "resturant_id":res_id
#         })
#         ##print(res.items())
#         return ({"success":True,"price":res["price"],"available_qty":res["item_qty"]})
#     except:
#         return  ({"success":False})
def get_resturantItem_price(res_id, item_id):
    ##print("in get item price")
    try:
        res = resturants_items.find_one({
            "_id": ObjectId(item_id),
            "resturant_id": res_id
        })

        ##print(res)

        if res is None:
            return {"success": False, "message": "Item not found"}

        return {
            "success": True,
            "price": res["price"],
            "available_qty": res["item_qty"]
        }

    except Exception as e:
        ##print("Error:", e)
        raise
def return_res_analytics(res_id):
    # seller_orders.find({"restaurant_id":res_id})
    resturants_itemsss=resturants_items.find({"resturant_id":res_id})
    ##print(resturants_itemsss)
    data=[]
    ##print(res_id)
    for items in resturants_itemsss:
        ##print("items=",items)
        itemss = {
        "item_name": items.get("item_name"),
        "initial_qty": items.get("item_qty", 0),
        "sold": items.get("sold", 0),
        "remaining": items.get("item_qty", 0)
    }
        ##print(itemss)
        data.append(itemss)
        ##print(data)
    ##print("data in res_analytics",data)
    return data
from pymongo import MongoClient
from datetime import datetime, timedelta
from collections import defaultdict

from datetime import datetime, timedelta
from collections import defaultdict


# def get_seller_analytics(seller_id: str) -> dict:
#     """
#     Returns full analytics payload for the seller dashboard.
#     Covers: KPIs, sales chart, top products, stock alerts, recent orders, activity feed.
#     """

#     # ── fetch data ──────────────────────────────────────────────────────────────
#     # resturant_items uses the (misspelled, but that's the real field) "resturant_id"
#     items_cursor = resturants_items.find({"resturant_id": seller_id})
#     # seller_orders uses the correctly-spelled "restaurant_id" — different from above!
#     orders_cursor = seller_orders.find({"restaurant_id": seller_id})

#     items_list = list(items_cursor)
#     orders_list = list(orders_cursor)

#     now = datetime.utcnow()
#     today = now.replace(hour=0, minute=0, second=0, microsecond=0)

#     # ── item index  (id → item doc) ─────────────────────────────────────────────
#     item_index = {str(item["_id"]): item for item in items_list}

#     # ── KPIs ────────────────────────────────────────────────────────────────────
#     total_revenue = 0
#     today_revenue = 0
#     today_orders = 0
#     month_orders = 0
#     month_revenue = 0
#     item_sold_counts = defaultdict(int)  # item_id → total units sold

#     for order in orders_list:
#         order_time = order.get("time", now)            # was "created_at" (field doesn't exist)
#         order_amount = order.get("total_amount", 0)     # ⚠️ TODO — confirm this field exists on order, see note below
#         status = order.get("status", "")

#         if status == "canceled":                        # was "cancelled" (your data uses one L)
#             continue

#         total_revenue += order_amount

#         if order_time >= today:
#             today_revenue += order_amount
#             today_orders += 1

#         if order_time >= today.replace(day=1):
#             month_revenue += order_amount
#             month_orders += 1

#         # ⚠️ TODO — "items" on your order doc is an Object, not an Array.
#         # The loop below assumes a list of {item_id, qty, price} dicts, which is
#         # almost certainly wrong for your schema. Expand the "items" field on one
#         # order doc in MongoDB and send me the shape (e.g. is it keyed by item_id,
#         # like {"<item_id>": {"qty": 2, "price": 60}}?) and I'll fix this loop and
#         # the order_items_summary logic below to match exactly.
#         order_items = order.get("items", {})
#         for line in order_items:
#             item_sold_counts[str(line.get("item_id"))] += line.get("qty", 0)

#     # ── inventory & stock alerts ─────────────────────────────────────────────────
#     low_stock_items = []
#     out_of_stock_items = []

#     inventory_data = []
#     for item in items_list:
#         item_id = str(item["_id"])
#         # item_qty is stored as a STRING ("32") in your schema — must cast to int
#         # or "initial_qty - sold" silently does the wrong thing.
#         initial_qty = int(item.get("item_qty", 0) or 0)
#         sold = item_sold_counts.get(item_id, 0)
#         remaining = max(initial_qty - sold, 0)
#         low_at = item.get("low_stock_threshold", 10)
#         price = item.get("price", 0)

#         inventory_data.append({
#             "item_id": item_id,
#             "item_name": item.get("item_name"),
#             # ⚠️ Your item docs (per the screenshot) don't appear to have
#             # "category" / "subcategory" / "unit" fields — these will come back
#             # as None unless they exist on some docs and just weren't visible
#             # in the screenshot. Dashboard's category badges will be blank until
#             # this is confirmed either way.
#             "category": item.get("category"),
#             "subcategory": item.get("subcategory"),
#             "unit": item.get("unit"),
#             "price": price,
#             "initial_qty": initial_qty,
#             "sold": sold,
#             "remaining": remaining,
#             "revenue": round(sold * price, 2),
#         })

#         if remaining == 0:
#             out_of_stock_items.append({
#                 "item_name": item.get("item_name"),
#                 "category": item.get("subcategory") or item.get("category"),
#                 "stock": 0,
#                 "status": "out",
#             })
#         elif remaining <= low_at:
#             low_stock_items.append({
#                 "item_name": item.get("item_name"),
#                 "category": item.get("subcategory") or item.get("category"),
#                 "stock": remaining,
#                 "status": "low",
#             })

#     stock_alerts = out_of_stock_items + low_stock_items  # out-of-stock first

#     # ── top products (by units sold) ─────────────────────────────────────────────
#     top_products = sorted(inventory_data, key=lambda x: x["sold"], reverse=True)[:5]

#     # ── sales chart (daily revenue, last 30 days) ────────────────────────────────
#     daily_revenue = defaultdict(float)
#     for order in orders_list:
#         if order.get("status") == "canceled":           # was "cancelled"
#             continue
#         order_time = order.get("time", now)              # was "created_at"
#         if order_time >= today - timedelta(days=30):
#             day_key = order_time.strftime("%b %d")
#             daily_revenue[day_key] += order.get("total_amount", 0)

#     # fill missing days with 0 so the chart has no gaps
#     chart_labels = []
#     chart_values = []
#     for i in range(30, -1, -1):
#         day = today - timedelta(days=i)
#         day_key = day.strftime("%b %d")
#         chart_labels.append(day_key)
#         chart_values.append(round(daily_revenue.get(day_key, 0), 2))

#     # ── recent orders (last 10) ──────────────────────────────────────────────────
#     recent_orders = sorted(orders_list, key=lambda x: x.get("time", now), reverse=True)[:10]
#     recent_orders_data = []
#     for order in recent_orders:
#         # ⚠️ depends on the same "items" shape question above
#         order_items_summary = ", ".join(
#             item_index.get(str(line.get("item_id")), {}).get("item_name", "Unknown")
#             for line in order.get("items", {})
#         ) if isinstance(order.get("items"), list) else ""  # placeholder until shape is confirmed

#         recent_orders_data.append({
#             "order_id": str(order["_id"]),
#             "customer_name": order.get("customer_name") or order.get("restaurant_name"),
#             "items_summary": order_items_summary,
#             "total_amount": order.get("total_amount", 0),
#             "status": order.get("status"),
#             "created_at": order.get("time", now).isoformat(),
#         })

#     # ── final payload ────────────────────────────────────────────────────────────
#     return {
#         "kpis": {
#             "total_revenue": round(total_revenue, 2),
#             "month_revenue": round(month_revenue, 2),
#             "month_orders": month_orders,
#             "today_revenue": round(today_revenue, 2),
#             "today_orders": today_orders,
#             "total_items": len(items_list),
#             "low_stock_count": len(low_stock_items),
#             "out_of_stock_count": len(out_of_stock_items),
#         },
#         "chart": {
#             "labels": chart_labels,
#             "values": chart_values,
#         },
#         "top_products": top_products,
#         "stock_alerts": stock_alerts,
#         "recent_orders": recent_orders_data,
#         "inventory": inventory_data,
#     }


from datetime import datetime, timedelta
from collections import defaultdict


def _order_amount(order: dict, item_index: dict) -> float:
    """
    seller_orders docs don't store a total_amount field — "items" is a dict
    keyed by item_id (see store_orders: data["items"].items()), e.g.
    {"<item_id>": {"qty": 2, ...}}. Price isn't guaranteed to be in the cart
    snapshot, so we look it up from the item's current price in resturants_items.
    NOTE: this uses *current* price, not the price at time of order — if you
    ever change a price after orders exist, historical revenue will drift.
    """
    order_items = order.get("items", {}) or {}
    total = 0
    for item_id, line in order_items.items():
        price = item_index.get(str(item_id), {}).get("price", 0)
        qty = line.get("qty", 0) if isinstance(line, dict) else 0
        total += int(price) * int(qty)
    return total


def get_seller_analytics(seller_id: str) -> dict:
    """
    Returns full analytics payload for the seller dashboard.
    Covers: KPIs, sales chart, top products, stock alerts, recent orders, activity feed.
    """

    # ── fetch data ──────────────────────────────────────────────────────────────
    # resturants_items uses the (misspelled, but that's the real field) "resturant_id"
    items_cursor = resturants_items.find({"resturant_id": seller_id})
    # seller_orders uses the correctly-spelled "restaurant_id" — different from above!
    orders_cursor = seller_orders.find({"restaurant_id": seller_id})

    items_list = list(items_cursor)
    orders_list = list(orders_cursor)

    now = datetime.utcnow()
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # ── item index  (id → item doc) ─────────────────────────────────────────────
    item_index = {str(item["_id"]): item for item in items_list}

    # ── KPIs ────────────────────────────────────────────────────────────────────
    total_revenue = 0
    today_revenue = 0
    today_orders = 0
    month_orders = 0
    month_revenue = 0
    active_orders = 0

    for order in orders_list:
        order_time = order.get("time", now)
        status = order.get("status", "")

        # NOTE: your real order statuses are "placed" / "completed" / "canceled"
        # (see resturant_stats) — not "new"/"processing"/"delivered"/"cancelled"
        # like the dashboard HTML expects. Map these when rendering.
        if status == "canceled":
            continue
        if status in ("placed", "processing"):
            active_orders += 1

        order_amount = _order_amount(order, item_index)
        total_revenue += order_amount

        if order_time >= today:
            today_revenue += order_amount
            today_orders += 1

        if order_time >= today.replace(day=1):
            month_revenue += order_amount
            month_orders += 1

    # ── inventory & stock alerts ─────────────────────────────────────────────────
    low_stock_items = []
    out_of_stock_items = []

    inventory_data = []
    for item in items_list:
        item_id = str(item["_id"])
        # item_qty can come in as a string depending on how it was inserted —
        # cast defensively so arithmetic doesn't silently misbehave.
        initial_qty = int(item.get("item_qty", 0) or 0)
        # "sold" is maintained directly on the item doc via $inc in store_orders —
        # that's the source of truth in your codebase (see return_res_analytics),
        # so use it as-is rather than recomputing from order history.
        sold = int(item.get("sold", 0) or 0)
        remaining = max(initial_qty - sold, 0)
        low_at = item.get("lowat", 10)          # was "low_stock_threshold" — field is "lowat"
        price = item.get("price", 0)

        inventory_data.append({
            "item_id": item_id,
            "item_name": item.get("item_name"),
            # There's no category/subcategory string on the item doc — only
            # "sub_id", a numeric reference into the categories collection.
            # If you want a human-readable category name on the dashboard,
            # you'll need to join against `categories` for this restaurant.
            "sub_id": item.get("sub_id"),
            "unit": item.get("unit"),
            "price": price,
            "initial_qty": initial_qty,
            "sold": sold,
            "remaining": remaining,
            "revenue": round(int(sold) * int(price), 2),
        })

        if remaining == 0:
            out_of_stock_items.append({
                "item_name": item.get("item_name"),
                "sub_id": item.get("sub_id"),
                "stock": 0,
                "status": "out",
            })
        elif remaining <= low_at:
            low_stock_items.append({
                "item_name": item.get("item_name"),
                "sub_id": item.get("sub_id"),
                "stock": remaining,
                "status": "low",
            })

    stock_alerts = out_of_stock_items + low_stock_items  # out-of-stock first

    # ── top products (by units sold) ─────────────────────────────────────────────
    top_products = sorted(inventory_data, key=lambda x: x["sold"], reverse=True)[:5]

    # ── sales chart (daily revenue, last 30 days) ────────────────────────────────
    daily_revenue = defaultdict(float)
    for order in orders_list:
        if order.get("status") == "canceled":
            continue
        order_time = order.get("time", now)
        if order_time >= today - timedelta(days=30):
            day_key = order_time.strftime("%b %d")
            daily_revenue[day_key] += _order_amount(order, item_index)

    # fill missing days with 0 so the chart has no gaps
    chart_labels = []
    chart_values = []
    for i in range(30, -1, -1):
        day = today - timedelta(days=i)
        day_key = day.strftime("%b %d")
        chart_labels.append(day_key)
        chart_values.append(round(daily_revenue.get(day_key, 0), 2))

    # ── recent orders (last 10) ──────────────────────────────────────────────────
    recent_orders = sorted(orders_list, key=lambda x: x.get("time", now), reverse=True)[:10]
    recent_orders_data = []
    for order in recent_orders:
        order_items = order.get("items", {}) or {}
        order_items_summary = ", ".join(
            item_index.get(str(item_id), {}).get("item_name", "Unknown")
            for item_id in list(order_items.keys())[:3]   # show max 3 item names
        )

        recent_orders_data.append({
            "order_id": str(order["_id"]),
            # seller_orders only stores user_id, not a display name — join
            # against `users` if you want an actual customer name here.
            "customer_id": order.get("user_id"),
            "items_summary": order_items_summary,
            "total_amount": round(_order_amount(order, item_index), 2),
            "status": order.get("status"),
            "tokenNo": order.get("token_no"),
            "created_at": order.get("time", now).isoformat(),
        })

    # ── final payload ────────────────────────────────────────────────────────────
    return {
        "kpis": {
            "total_revenue": round(total_revenue, 2),
            "month_revenue": round(month_revenue, 2),
            "month_orders": month_orders,
            "today_revenue": round(today_revenue, 2),
            "today_orders": today_orders,
            "total_items": len(items_list),
            "low_stock_count": len(low_stock_items),
            "out_of_stock_count": len(out_of_stock_items),
        },
        "chart": {
            "labels": chart_labels,
            "values": chart_values,
        },
        "top_products": top_products,
        "stock_alerts": stock_alerts,
        "recent_orders": recent_orders_data,
        "inventory": inventory_data,
        "active_orders": active_orders,
    }
def save_address(address,type,uid,cordinates):
    user=users.find_one(ObjectId(uid))
    if user :
        result = users.update_one(
        {"_id": ObjectId(uid)},
        {
            "$push": {
                "addresses": {
                    "address": address,
                    "adrs_type": type,
                    "coordinates": cordinates
                }
            }
        }
    )
        return ({"success":True})
    else:
        return ({"success":False})
    
def fetch_address(uid):
    user=users.find_one(ObjectId(uid))

    if(user):
        # ##print("addd",user["addresses"])
        if "addresses" in user:
            return {"success":True,"address":user["addresses"],"status":200}
        else:
            return {"success":True,"address":"not_found","status":404}
    else:
        return {"success":False}

def set_verified(email,role):
    if(role=="user"):
        users.find_one_and_update({"email":email},{"$set":{"is_verified":True}})
    else:
        owners.find_one_and_update({"email":email},{"$set":{"is_verified":True}})

from pymongo import ReturnDocument

def save_category(res_id, category, subcats):
    try:
        # Reserve IDs atomically
        doc = categories.find_one_and_update(
            {"restaurant_id": res_id},
            {
                "$inc": {
                    "next_category_id": 1,
                    "next_subcat_id": len(subcats)
                }
            },
            upsert=True,
            return_document=ReturnDocument.BEFORE
        )

        # First document case
        if doc is None:
            cat_id = 1
            first_sub_id = 1
        else:
            cat_id = doc.get("next_category_id", 1)
            first_sub_id = doc.get("next_subcat_id", 0)+1

        category_data = {
            "_id": cat_id,
            "name": category,
            "subcategories": [
                {
                    "_id": first_sub_id + i,
                    "name": subcat
                }
                for i, subcat in enumerate(subcats)
            ]
        }

        categories.update_one(
            {"restaurant_id": res_id},
            {
                "$push": {
                    "categories": category_data
                },
                "$setOnInsert": {
                "restaurant_id": res_id
                }
            }
        )

        return {"success": True,"category_data": category_data}

    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

# def driver_details():
#     drivers
def create_new_driver(email,username, password,role="driver"):
    try:
        ##print("in create user")
            # owner=owners.find_one({"email":email})
            # if owner is None:
        result =drivers.insert_one({
                "email": email,
                "username":username,
                "password": password,
                "role":role,
                "rating":0,
                "acceptance_rate":0,
                "cancellations":0,
                "Total_Online_time":0,
                "Base_Pay":0,
                "Distance_pay":0,
                "is_verified":False
            })
        return ({"success":True,"id":str(result.inserted_id)})
    except Exception as e:
        print("error",str(e))
def check_existing_driver(email,password):
    ##print("in existing driver")
    driver=drivers.find_one({"email":email})
    ##print(driver)
    if(driver): 
        ##print("in existing user if block",password)
        if verify_password(password, driver["password"]):
            ##print("in existing user if if block")
            return ({"success":True,"userid":str(driver["_id"]),"username":driver["username"],"is_verified":driver["is_verified"]})
        else:
            return {"success":False}
    else: return {"success":404}

from datetime import datetime, timedelta
import random

driver_orders = db["driver_orders"]
driver_sessions = db["driver_sessions"]
driver_earnings = db["driver_earnings"]
driver_documents = db["driver_documents"]

drivers.create_index("email", unique=True)   # you have this on users/owners but not drivers yet

def create_new_driver(email, username, password, role="driver"):
    try:
        result = drivers.insert_one({
            "email": email,
            "username": username,
            "password": (password),
            "role": role,
            "rating": 0,
            "acceptance_rate": 0,
            "cancellations": 0,
            "orders_completed": 0,
            "declines": 0,
            "Total_Online_time": 0,      # seconds
            "total_earnings": 0,
            "is_online": False,
            "online_since": None,
            "vehicle": {"type": None, "plate": None},
            "is_verified": False
        })
        return {"success": True, "id": str(result.inserted_id), "username":username}
    except DuplicateKeyError:
        return {"success": False, "message": "Email already exists"}
    except Exception as e:
        ##print("error", str(e))
        return {"success": False, "message": str(e)}


def check_existing_driver(email, password):
    driver = drivers.find_one({"email": email})
    if driver:
        if driver["password"] == password:
            return {
                "success": True,
                "userid": str(driver["_id"]),
                "username": driver["username"],
                "is_verified": driver["is_verified"]
            }
        else:
            return {"success": False}
    else:
        return {"success": 404}

def set_driver_online_status(driver_id, is_online: bool):
    driver = drivers.find_one({"_id": ObjectId(driver_id)})
    if not driver:
        return {"success": False, "message": "Driver not found"}

    if is_online:
        drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {"$set": {"is_online": True, "online_since": datetime.utcnow()}}
        )
        driver_sessions.insert_one({
            "driver_id": driver_id,
            "start": datetime.utcnow(),
            "end": None
        })
    else:
        online_since = driver.get("online_since")
        elapsed = int((datetime.utcnow() - online_since).total_seconds()) if online_since else 0

        drivers.update_one(
            {"_id": ObjectId(driver_id)},
            {
                "$set": {"is_online": False, "online_since": None},
                "$inc": {"Total_Online_time": elapsed}
            }
        )
        driver_sessions.update_one(
            {"driver_id": driver_id, "end": None},
            {"$set": {"end": datetime.utcnow(), "duration_seconds": elapsed}}
        )

    return {"success": True, "is_online": is_online}


def get_online_time_today(driver_id):
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    sessions = driver_sessions.find({"driver_id": driver_id, "start": {"$gte": today_start}})
    total_seconds = 0
    for s in sessions:
        end = s.get("end") or datetime.utcnow()
        total_seconds += int((end - s["start"]).total_seconds())
    hrs, mins = total_seconds // 3600, (total_seconds % 3600) // 60
    return {"seconds": total_seconds, "display": f"{hrs}h {mins}m"}


def get_driver_home_stats(driver_id):
    driver = drivers.find_one({"_id": ObjectId(driver_id)})
    if not driver:
        return {"success": False}

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_orders = seller_orders.count_documents({
    "driver_id": driver_id, "delivery_status": "delivered", "delivered_at": {"$gte": today_start}
})

    earning_cursor = driver_earnings.aggregate([
        {"$match": {"driver_id": driver_id, "created_at": {"$gte": today_start}}},
        {"$group": {"_id": None, "total": {"$sum": "$total"}}}
    ])
    earning_result = list(earning_cursor)
    today_earning = earning_result[0]["total"] if earning_result else 0

    return {
        "success": True,
        "earnings_today": today_earning,
        "orders_today": today_orders,
        "online_time": get_online_time_today(driver_id)["display"],
        "rating": driver.get("rating", 0),
        "acceptance_rate": driver.get("acceptance_rate", 0),
        "cancellations": driver.get("cancellations", 0)
    }
def generate_delivery_otp():
    return str(random.randint(1000, 9999))


def create_delivery_order(seller_order_id):
    seller_order = seller_orders.find_one({"_id": ObjectId(seller_order_id)})
    if not seller_order:
        return {"success": False, "message": "Seller order not found"}

    restaurant = restaurants_name.find_one({"_id": ObjectId(seller_order["restaurant_id"])})
    customer = users.find_one({"_id": ObjectId(seller_order["user_id"])})

    result = driver_orders.insert_one({
        "seller_order_id": str(seller_order["_id"]),
        "restaurant_id": seller_order["restaurant_id"],
        "restaurant_name": seller_order.get("restaurant_name"),
        "restaurant_address": restaurant.get("address") if restaurant else None,
        "customer_id": seller_order["user_id"],
        "customer_name": customer.get("username") if customer else "Customer",
        "drop_address": (customer.get("addresses") or [{}])[-1] if customer else {},
        "items": seller_order["items"],
        "driver_id": None,
        "status": "pending",     # pending -> accepted -> delivered
        "step": 0,                # 0=to pickup,1=at pickup,2=to drop,3=at drop
        "amount": 40,              # TODO: replace with a real delivery-fee calc (distance-based)
        "delivery_otp": generate_delivery_otp(),
        "declined_by": [],
        "created_at": datetime.utcnow(),
        "accepted_at": None,
        "delivered_at": None
    })
    return {"success": True, "id": str(result.inserted_id)}


def get_available_order_for_driver(driver_id):
    order = driver_orders.find_one(
        {"status": "pending", "declined_by": {"$ne": driver_id}},
        sort=[("created_at", 1)]
    )
    if not order:
        return None
    return {
        "order_id": str(order["_id"]),
        "store": order["restaurant_name"],
        "customer": order["customer_name"],
        "amount": order["amount"],
        "drop_address": order.get("drop_address")
    }


def accept_delivery_order(order_id, driver_id, redis_data):
    with client.start_session() as session:
        with session.start_transaction():
            amount = redis_data["amount"]
            result = seller_orders.find_one_and_update(
                {
                    "parent_order_id": str(order_id),
                    "status": "placed"
                },
                {
                    "$set": {
                        "delivery_status": "accepted",
                        "driver_id": driver_id,
                        "amount": amount,
                        "customer_name": redis_data.get("customer_name"),
                        "warehouse_lat": redis_data.get("warehouse_lat"),
                        "warehouse_lng": redis_data.get("warehouse_lng"),
                        "customer_lat": redis_data.get("customer_lat"),
                        "customer_lng": redis_data.get("customer_lng"),
                        "customer_km": redis_data.get("customer_km"),
                        "warehouse_km": redis_data.get("warehouse_km"),
                        "delivery_otp": generate_delivery_otp(),
                        "step": 0,
                        "accepted_at": datetime.utcnow()
                    }
                },
                return_document=ReturnDocument.AFTER,
                session=session
            )
            if not result:
                return {
                    "success": False,
                    "message": "Order already taken"
                }
            drivers.update_one(
                {"_id": ObjectId(driver_id)},
                {"$inc": {"orders_accepted": 1}},
                session=session
            )

    items_seller = {}
    for _id, values in result["items"].items():
        items_seller[values["name"]] = values["qty"]

    return {
        "success": True,
        "order": {
            "order_id": str(order_id),
            "token_no": result["token_no"],
            "amount": amount,
            "items": items_seller
        }
    }

def get_active_driver_order(driver_id):
    order = seller_orders.find_one({
        "driver_id": driver_id,
        "delivery_status": {"$nin": ["delivered", "cancelled"]}
    })

    if not order:
        return None

    return {
        "order_id": order.get("parent_order_id"),
        "token_no": order.get("token_no"),
        "amount": order.get("amount"),
        "store": order.get("restaurant_name"),
        "customer": order.get("customer_name"),
        "step": order.get("step", 0),
        "warehouse_lat": order.get("warehouse_lat"),
        "warehouse_lng": order.get("warehouse_lng"),
        "customer_lat": order.get("customer_lat"),
        "customer_lng": order.get("customer_lng"),
        "customer_km": order.get("customer_km"),
        "warehouse_km": order.get("warehouse_km"),
    }


def decline_delivery_order(order_id, driver_id):
    seller_orders.update_one({"_id": ObjectId(order_id)}, {"$addToSet": {"declined_by": driver_id}})
    drivers.update_one({"_id": ObjectId(driver_id)}, {"$inc": {"declines": 1}})
    return {"success": True}


def advance_delivery_step(order_id, driver_id):
    order = seller_orders.find_one({"parent_order_id": str(order_id), "driver_id": driver_id})
    if not order:
        return {"success": False, "message": "Order not found or unauthorized"}
    if order.get("step", 0) >= 3:
        return {"success": False, "message": "Already at final step — confirm delivery instead"}

    next_step = order["step"] + 1
    seller_orders.update_one({"_id": order["_id"]}, {"$set": {"step": next_step}})
    return {"success": True, "step": next_step}

def confirm_delivery(order_id, driver_id):
    order = seller_orders.find_one({"parent_order_id": str(order_id), "driver_id": driver_id})
    if not order:
        return {"success": False, "message": "Order not found or unauthorized"}

    if order.get("delivery_status") == "delivered":
        return {"success": False, "message": "Order already delivered"}

    base_pay = round(order["amount"] * 0.7, 2)
    distance_pay = round(order["amount"] * 0.3, 2)

    for attempt in range(MAX_RETRIES):
        try:
            with client.start_session() as session:
                with session.start_transaction():
                    seller_orders.update_one(
                        {"_id": order["_id"], "driver_id": driver_id, "delivery_status": {"$ne": "delivered"}},
                        {"$set": {
                            "delivery_status": "delivered",
                            "delivered_at": datetime.utcnow(),
                            "status": "completed"
                        }},
                        session=session
                    )
                    orders.update_one(
                        {"_id": ObjectId(order["parent_order_id"])},
                        {"$set": {"status": "completed"}},
                        session=session
                    )
                    driver_earnings.insert_one({
                        "driver_id": driver_id, "order_id": order_id,
                        "base_pay": base_pay, "distance_pay": distance_pay,
                        "bonus": 0, "tip": 0,
                        "total": base_pay + distance_pay,
                        "created_at": datetime.utcnow()
                    }, session=session)
                    drivers.update_one(
                        {"_id": ObjectId(driver_id)},
                        {"$inc": {"total_earnings": base_pay + distance_pay, "orders_completed": 1}},
                        session=session
                    )
            free_driver(driver_id)
            return {"success": True, "amount": base_pay + distance_pay}
        except OperationFailure as e:
            if "TransientTransactionError" in e.details.get("errorLabels", []):
                time.sleep(0.05)
                continue
            raise
    return {"success": False, "message": "Could not complete delivery, try again"}

def get_driver_order_history(driver_id, range_="today"):
    range_="week"
    query = {"driver_id": driver_id, "delivery_status": {"$in": ["delivered", "cancelled"]}}
    now = datetime.utcnow()
    if range_ == "today":
        query["accepted_at"] = {"$gte": now.replace(hour=0, minute=0, second=0, microsecond=0)}
    elif range_ == "week":
        query["accepted_at"] = {"$gte": now - timedelta(days=7)}

    cursor = seller_orders.find(query).sort("accepted_at", -1)
    history = []
    for o in cursor:
        ts = o.get("delivered_at") or o.get("accepted_at")
        history.append({
            "id": str(o["_id"]),
            "path": f"{o['restaurant_name']} → {o.get('customer_name', 'Customer')}",
            "time": ts.strftime("%d %b, %I:%M %p") if ts else "",
            "amt": o.get("amount"),
            "status": o.get("delivery_status")
        })
    return history
def get_driver_earnings_summary(driver_id, range_="today"):
    now = datetime.utcnow()
    range_="week"
    if range_ == "today":
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif range_ == "week":
        start = now - timedelta(days=7)
    else:
        start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    pipeline = [
        {"$match": {"driver_id": driver_id, "created_at": {"$gte": start}}},
        {"$group": {
            "_id": None,
            "base_pay": {"$sum": "$base_pay"}, "distance_pay": {"$sum": "$distance_pay"},
            "bonus": {"$sum": "$bonus"}, "tip": {"$sum": "$tip"}, "total": {"$sum": "$total"}
        }}
    ]
    result = list(driver_earnings.aggregate(pipeline))
    if not result:
        return {"base_pay": 0, "distance_pay": 0, "bonus": 0, "tip": 0, "total": 0}
    result[0].pop("_id")
    return result[0]


def get_weekly_earnings_chart(driver_id):
    start = datetime.utcnow() - timedelta(days=7)
    pipeline = [
        {"$match": {"driver_id": driver_id, "created_at": {"$gte": start}}},
        {"$group": {
            "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": "$created_at"}},
            "total": {"$sum": "$total"}
        }},
        {"$sort": {"_id": 1}}
    ]
    return [{"date": r["_id"], "total": r["total"]} for r in driver_earnings.aggregate(pipeline)]

def upload_driver_document(driver_id, doc_type, file_url):
    driver_documents.update_one(
        {"driver_id": driver_id, "type": doc_type},
        {"$set": {"file_url": file_url, "status": "pending", "uploaded_at": datetime.utcnow()}},
        upsert=True
    )
    return {"success": True}


def get_driver_documents(driver_id):
    docs = driver_documents.find({"driver_id": driver_id})
    return [{"type": d["type"], "status": d["status"], "file_url": d["file_url"]} for d in docs]


def update_driver_vehicle(driver_id, vehicle_type, plate_number):
    result = drivers.find_one_and_update(
        {"_id": ObjectId(driver_id)},
        {"$set": {"vehicle.type": vehicle_type, "vehicle.plate": plate_number}},
        return_document=ReturnDocument.AFTER
    )
    if not result:
        return {"success": False, "message": "Driver not found"}
    return {"success": True}