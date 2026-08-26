import time
import eventlet
eventlet.monkey_patch()
from database import (
    create_new_driver, get_active_driver_order, save_category, get_seller_analytics, get_resturantItem_price,
    accept_delivery_order, add_subcategory, add_resturant_items, check_existing_owner,
    set_verified, fetch_address, add_resturants, list_resturant_items, list_resturants,
    add_customer_items, update_resturant_item, remove_itemss, store_orders, get_orders,
    store_seller_orders, get_seller_ordes, check_existing_user, create_new_user,
    update_order_status_seller, update_order_status_user, resturant_stats,
    return_res_analytics, save_address, verify_order, check_existing_driver,
    confirm_delivery, decline_delivery_order, advance_delivery_step,
    get_driver_home_stats, get_driver_order_history, get_driver_earnings_summary,
    get_weekly_earnings_chart, get_driver_documents, update_driver_vehicle,
    set_driver_online_status, get_restaurant_location
)
from flask import Flask,request,render_template,redirect,url_for,jsonify,g
from flask_socketio import SocketIO, emit,join_room,leave_room
from redis_db import (
    add_cart, get_cart, update_cart_qty, acquire_lock, release_lock, search_driver,
    update_driver_location, accept_order_redis, delete_lock, set_driver_offline
)
from flask_cors import CORS
from flask_mail import Mail
from dotenv import load_dotenv
from itsdangerous import URLSafeTimedSerializer
from verify import upload_image   
# from verifpy1 import upload_image
from functools import wraps
import jwt
from datetime import datetime,timedelta
import requests
import os

load_dotenv(override=True)
mail_sever_name=os.getenv("Mail_server")
mail_port=int(os.getenv("Mail_port"))
mail_use_tls = os.getenv("Mail_use_tls", "False").lower() == "true"
mail_use_ssl = os.getenv("Mail_use_ssl", "True").lower() == "true"
mail_username=os.getenv("Mail")
mail_password=os.getenv("Mail_password")
secret_key=os.getenv("Mail_secret_key")
brevo_api=os.getenv("brevo_api_email")
app=Flask(__name__)
IS_PROD = os.getenv("FLASK_ENV") == "production"
COOKIE_SECURE = IS_PROD
ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "").split(",") if o.strip()]
CORS(app, supports_credentials=True, origins=ALLOWED_ORIGINS)
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

def rate_limit_key():
    if hasattr(g, "user_id"):
        return f"user:{g.user_id}"
    if hasattr(g, "res_id"):
        return f"res:{g.res_id}"
    return get_remote_address()

# limiter = Limiter(
#     app=app,
#     key_func=rate_limit_key,
#     storage_uri=f"redis://{os.getenv('Redis_uri')}:{os.getenv('Redis_port')}",
#     default_limits=["200 per minute"]
# )
redis_user = os.getenv("Redis_USERNAME", "")
redis_pass = os.getenv("Redis_PASSWORD", "")
redis_host = os.getenv("Redis_uri")
redis_port = os.getenv("Redis_port")

if redis_user or redis_pass:
    storage_uri = f"redis://{redis_user}:{redis_pass}@{redis_host}:{redis_port}"
else:
    storage_uri = f"redis://{redis_host}:{redis_port}"
# limiter = Limiter(app=app, key_func=rate_limit_key, storage_uri=storage_uri, default_limits=["200 per minute"])
app.config["MAIL_SERVER"] = mail_sever_name
app.config["MAIL_PORT"] = mail_port
app.config["MAIL_USE_TLS"] = mail_use_tls
app.config["MAIL_USE_SSL"]=mail_use_ssl
app.config["MAIL_USERNAME"] = mail_username
app.config["MAIL_PASSWORD"] = mail_password
app.config["SECRET_KEY"]=secret_key

#print("SERVER:", mail_sever_name, flush=True)
#print("PORT:", mail_port, flush=True)
#print("TLS:", mail_use_tls, flush=True)
#print("SSL:", mail_use_ssl, flush=True)
#print("USER:", mail_username, flush=True)
#print("PASS EXISTS:", bool(mail_password), flush=True)

brevo_api=os.getenv("brevo_api_email")
if redis_user and redis_pass:
    REDIS_URL = f"redis://{redis_user}:{redis_pass}@127.0.0.1:6379/0"
else:
    REDIS_URL = "redis://127.0.0.1:6379/0"
REDIS_URL = f"redis://{redis_user}:{redis_pass}@{redis_host}:{redis_port}/0"
#print("in server",REDIS_URL)
socketio = SocketIO(app, cors_allowed_origins="*",message_queue=REDIS_URL)
#print("ASYNC MODE:", socketio.async_mode)
# mail=Mail(app)


from itsdangerous import URLSafeTimedSerializer

serializer = URLSafeTimedSerializer(app.config["SECRET_KEY"])
def login_required(f):
    print("in login required")
    @wraps(f)
    def wrapper(*args, **kwargs):
        # token = request.cookies.get("token")
        token = (
            request.cookies.get("user_token") or
            request.cookies.get("seller_token")
        )
        if not token:
            #print(request.endpoint)
            if(request.endpoint=="home"):
                return redirect(url_for("login", role="seller"))
            elif(request.endpoint=="sellerTemplate"):
                return redirect(url_for("login", role="seller"))
            else:
            # return redirect(url_for('renderLanding'))
                return jsonify({"success": False,"message":"Token is missing or unauthorized access"}), 401

        try:
            payload = jwt.decode(
                token,
                app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )
            # #print(payload)
            g.type = payload["type"]
            if(g.type == "user"):
                g.user_id = payload["user_id"]
                g.username=payload["username"]
            elif(g.type == "seller"):
                g.res_id=payload["res_id"]
                g.username=payload["username"]
        except jwt.InvalidTokenError:
            # response=jsonify({"success": False}), 401
            # return jsonify({"success": False}), 401
            # response=jsonify({"success":True,"res_id":id}),401
            response=jsonify({"success":True,"msg":"invalid Token"}),401
            response.delete_cookie("user_token")
            response.delete_cookie("seller_token")
            return response

        return f(*args, **kwargs)

    return wrapper
def auth_driver(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        # #print("in auth driver")
        token = request.cookies.get("driver_token")
        # pri
        if not token:
            #print("unauthorized",token)
            return jsonify({"success": False, "message": "Unauthorized"}), 401
        try:
            payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
            # #print(payload)
            if payload.get("type") != "driver":
                return jsonify({"success": False, "message": "Unauthorized"}), 401
            g.type = "driver"
            g.driver_id = payload["driver_id"]
            g.username = payload.get("username")
            #print("after assignment")
        except jwt.InvalidTokenError:
            #print("invalid_token",request.endpoint)
            response = jsonify({"success": False, "message": "Invalid token"})
            response.delete_cookie("driver_token")
            return response, 401
        return f(*args, **kwargs)
    return wrapper
def auth_seller_res(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        # token = request.cookies.get("token")
        token = (
            request.cookies.get("seller_res_token")
        )
        if not token:
            return jsonify({"success": False}), 401

        try:
            payload = jwt.decode(
                token,
                app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )
            #print(payload)
            g.type = payload["type"]
            g.owner_id = payload["owner_id"]
            g.username = payload["username"]

        except jwt.InvalidTokenError:
            # response=jsonify({"success": False}), 401
            # return jsonify({"success": False}), 401
            # response=jsonify({"success":True,"res_id":id}),401
            response=jsonify({"success":True,"msg":"invalid Token"}),401
            response.delete_cookie("seller_res_token")
            return response

        return f(*args, **kwargs)

    return wrapper
def generate_verification_token(email,role):
    return serializer.dumps({
            "email": email,
            "role": role
        }, salt="email-verification")

def send_verification_email(user_email,role):
    try:
        #print("in send varification")
        #print("generating token")
        token = generate_verification_token(user_email,role)
        #print("verify url")
        print("token generated")
        verify_url = url_for(
            "verify_email",
            token=token,
            _external=True
        )
        print("after verify url")
        #print("msg")
        # msg = Message(
        #     subject="Verify Your Email",
        #     sender=app.config["MAIL_USERNAME"],
        #     recipients=[user_email]
        # )

        response = requests.post(
            "https://api.brevo.com/v3/smtp/email",
            headers={
                "accept": "application/json",
                "api-key": brevo_api,
                "content-type": "application/json"
            },
            json={
                "sender": {"email": "dummy.mail.saad@gmail.com"},
                "to": [{"email": user_email}],
                "subject": "Verify Email",
                "htmlContent": f"""
                <p>Click below to verify:</p>
                <a href="{verify_url}">{verify_url}</a>
                """
            }
        )
        print(response.status_code)
        #print(response.text,flush=True)
        if(response.status_code==201):
            #print("done sending email")
            return 1
        else:
            return 0
    except Exception as e:
        print("send verification error",str(e))


# #print("Email sent")
@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({
        "success": False,
        "message": "Too many requests, please slow down"
    }), 429
@app.route("/", methods=["GET", "POST"])
def land():
    return redirect(url_for('renderLanding'))
import os
from flask import send_from_directory

@app.route("/.well-known/assetlinks.json", methods=["GET"])
def serve_asset_links_file():
    # Assumes your assetlinks.json file is inside your 'static' folder
    static_file_dir = os.path.join(app.root_path, 'static')
    return send_from_directory(static_file_dir, 'assetlinks.json', mimetype='application/json')
@app.route("/user/<userid>", methods=["GET", "POST"])
@login_required
##@limiter.limit("10 per minute")
def home(userid):
    try:
        return render_template('home.html',page="home")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.route("/logout/seller", methods=["GET"])
def logout_seller():
    response = jsonify({"success": True, "message": "Logged out successfully"})
    response.delete_cookie("seller_token")
    return response
# @app.post("/add_res_items")
# def add_itemss():
#     try:
#         data=request.get_json()
#         res_id=data["res_id"]
#         itm_name=data["itm_name"]
#         itm_qty=data["itm_qty"]
#         price=data["price"]
#         sub_id=data["sub_id"]
#         desc=data["description"]
#         unit=data["unit"]
#         lowat=data["lowAt"]
#         available=data["available"]

#         # #print(res_id,itm)
#         res=add_resturant_items(res_id,itm_name,itm_qty,price,sub_id,desc,unit,lowat,available)
#         return ({"success":True,"id":res})
#     except Exception as e:
        # #print(e)
#         return({"success":False})
@app.post("/add_res_items")
@login_required
#@limiter.limit("10 per minute")
def add_itemss():
    try:
        # itm_name = request.form.get("itm_name")
        # # res_id = request.form.get("res_id")
        # res_id=g.res_id
        # itm_qty = request.form.get("itm_qty")
        # price = int(request.form.get("price"))
        # sub_id = request.form.get("sub_id")
        # desc = request.form.get("desc")
        # unit = request.form.get("unit")
        # lowat = request.form.get("lowat")
        # available=request.form.get("available")
        # photo = request.files.get("photo")
        if g.type != "seller":
            return jsonify({
                "success": False,
                "message": "Unauthorized"
            }), 403
        data,error=validate_item_form()
        if error:
            return error
        if data["photo"]:
            res_id=g.res_id
            file_id = upload_image(data["photo"])
            res = add_resturant_items(
                res_id,
                data["itm_name"],
                data["itm_qty"],
                data["price"],
                data["sub_id"],
                data["desc"],
                data["unit"],
                data["lowat"],
                data["available"],
                file_id
            )
        # if (photo):
        #     file_id=upload_image(photo)
        #     #print(file_id)
        #     res=add_resturant_items(res_id,itm_name,itm_qty,price,sub_id,desc,unit,lowat,available,file_id)
            # return ({"success":True,"id":res["id"],"img_url":res["url"]})
        else:
            res_id=g.res_id
            res=add_resturant_items(
                res_id,
                data["itm_name"],
                data["itm_qty"],
                data["price"],
                data["sub_id"],
                data["desc"],
                data["unit"],
                data["lowat"],
                data["available"]
            )
        return ({"success":True,"id":res["id"],"img_url":res["url"]})
        # #print(res_id,itm)
        # res=add_resturant_items(res_id,itm_name,itm_qty,price,sub_id,desc,unit,lowat,available)
        # return ({"success":True,"id":res})
    except Exception as e:
        #print("add itemss")
        #print(e) 
        return({"success":False})
ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg"}
def allowed_file(filename):
    return (
        "." in filename and
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS
    )
@app.post("/add_resturant")
@auth_seller_res
#@limiter.limit("5 per minute")
def add_resturant():
    try:
        token = request.cookies.get("seller_res_token")
        if not token:
            return jsonify({"success": False, "message": "Token is required"}), 400
        payload = jwt.decode(
                token,
                app.config["SECRET_KEY"],
                algorithms=["HS256"]
            )
        #print(payload)
        owner_id = payload["owner_id"]
        name = request.form.get("name")
        address = request.form.get("address")
        phone = request.form.get("phone")
        lat = request.form.get("lat")
        lng = request.form.get("lng")
        
        # owner_id = request.form.get("owner_id")
        photo = request.files.get("photo")
        # Required field validation
        if not owner_id:
            return jsonify({"success": False, "message": "Owner ID is required"}), 400

        if not name:
            return jsonify({"success": False, "message": "Restaurant name is required"}), 400

        if not address:
            return jsonify({"success": False, "message": "Address is required"}), 400

        if not phone:
            return jsonify({"success": False, "message": "Phone number is required"}), 400

        if not lat or not lng:
            return jsonify({"success": False, "message": "Latitude and Longitude are required"}), 400
        try:
            latt = round(float(lat),4)
            long = round(float(lng),4)
            if not (-90 <= latt <= 90):
                return jsonify({"success": False, "message": "Invalid latitude"}), 400

            if not (-180 <= long <= 180):
                return jsonify({"success": False, "message": "Invalid longitude"}), 400
        except ValueError:
            return jsonify({"success": False, "message": "Latitude and Longitude must be numbers"}), 400

        # Phone validation
        if not phone.isdigit() or len(phone) != 10:
            return jsonify({"success": False, "message": "Invalid phone number"}), 400
        if (photo):
            if photo.filename == "":
                return jsonify({"success": False, "message": "Invalid photo"}), 400

            if not allowed_file(photo.filename):
                return jsonify({
                    "success": False,
                    "message": "Only png, jpg, jpeg and webp files are allowed"
                }), 400
            file_id=upload_image(photo)
            #print(file_id)
            id=add_resturants(name,address,phone,owner_id,long,latt,file_id)
            # return ({"success":True,"res_id":id})
            response=jsonify({"success":True,"res_id":id})
            response.delete_cookie("seller_res_token")
            # return response
            res_id=id
            res_name=name
            token = jwt.encode(
                {
                    "type":"seller",
                    "res_id": str(res_id),
                    "res_name":res_name,
                    "username":g.username,
                    "exp": datetime.utcnow() + timedelta(days=7)
                },
                app.config["SECRET_KEY"],
                algorithm="HS256"
            )
            # response=jsonify({"success":True,"res_id":res_id,"res_name":res_name,"is_setup":is_setup})
            # response.delete_cookie("user_token")
            response.set_cookie(
                "seller_token",
                token,
                httponly=True,
                secure=COOKIE_SECURE,      # True in production with HTTPS
                samesite="Lax",
                max_age=7 * 24 * 60 * 60
            )
            return response
        else:
            id=add_resturants(name,address,phone,owner_id,long,latt)
            response=jsonify({"success":True,"res_id":id})
            response.delete_cookie("seller_res_token")
            # return response
            res_id=id
            res_name=name
            token = jwt.encode(
                {
                    "type":"seller",
                    "res_id": str(res_id),
                    "res_name":res_name,
                    "exp": datetime.utcnow() + timedelta(days=7)
                },
                app.config["SECRET_KEY"],
                algorithm="HS256"
            )
            # response=jsonify({"success":True,"res_id":res_id,"res_name":res_name,"is_setup":is_setup})
            # response.delete_cookie("user_token")
            response.set_cookie(
                "seller_token",
                token,
                httponly=True,
                secure=COOKIE_SECURE,      # True in production with HTTPS
                samesite="Lax",
                max_age=7 * 24 * 60 * 60
            )
            return response
    except Exception as e:
        #print(e)
        return jsonify({
    "success": False,
    "message": "Internal server error"
}), 500
@app.post("/remove_items")
@login_required
#@limiter.limit("30 per minute")
def remove_item():
    try:
        res_id=g.res_id
        data=request.get_json()
        item_id=data["item_id"]
        remove_itemss(item_id,res_id)
        return({"success":True})
    except Exception as e:
        #print(e)
        return({"success":False})

@app.post("/list_resturants")
def list_resturantss():
    try:
        data=request.get_json()
        latt=data["latt"]
        long=data["long"]
        dist=data["dist"]
        dist=int(dist)
        res=list_resturants(long,latt,dist)
        return ({"success":True,"results":res})
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/list_items")
@login_required
def list_item():
    data=request.get_json()
    types=g.type
    if(types=="seller"):
        res_id=g.res_id
    else:
        # res_id=data["res_id"]
        res_id="123"
    res=list_resturant_items(res_id,types)
    if(types=="seller"):
        return ({"success":True,"res":res["item_name"],"categories":res["categories"]})
    else:
        return ({"success":True,"res":res["item_name"]})
    # try:
    # except Exception as e:
    #     #print(e)
    #     return({"success":False})
@app.post("/update_item_details")
@login_required
#@limiter.limit("20 per minute")
def update_items():
    try:
        res_id=g.res_id
        data, error = validate_update_item()
        if error:
            return error
        res = update_resturant_item(
            data["item_id"],
            data["name"],
            data["price"],
            data["unit"],
            data["lowAt"],
            data["desc"],
            data["subId"],
            data["stock"],
            data["available"],
            res_id
        ) 
        if(res["success"]):
            return ({"success":True})
        else:
            return ({"success":False,"message":res["message"]})
    except Exception as e:
        #print(e)
        return({"success":False})

@app.get("/menu/<name>/<address>/<res_id>/<user_id>")
def list_items(name,address,res_id,user_id):
    try:
        # data=request.get_json()
        # res_id=data["res_id"]
        # res=list_resturant_items(res_id)
        # return ({"success":True,"res":res})
        return render_template("menu.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.get("/menu/sel/<id>")
def s_me(id):
    #print("running s_me")
    try:
        return render_template("menu_seller.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.get("/cart/<userid>")
def cartss(userid):
    try:
        return render_template("cart.html",page="cart")
    except Exception as e:
        return({"success":False})
@app.post("/get_cart_items")
@login_required
def list_cart_items():
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403
    try:
        #print("in get cart",g.__dict__)
        data=request.get_json()
        # userid=data["userid"]
        userid=g.user_id
        res=get_cart(userid)
        return ({"success":True,"results":res})
    except Exception as e:
        #print(e)
        return({"success":False})
# @app.post("/add_to_cart")
# @login_required
# def addToCart():
#     try:
#         #print("in addTOCart")
#         #print("userid in add to cart",g.__dict__)
#         data, error = validate_add_to_cart()
#         if error:
#             return error
#         userid = g.user_id
#         # response = get_resturantItem_price(data["resid"], data["item_id"])
#         # if(response["success"]):
#         #     price=response["price"]
#         #     available_qty=response["available_qty"]
#         price=data["price"]
#         available_qty=10
#         # #print(response)
#         try:
#             replace =data["replace"]
#             #print("in replace",replace)
#         except Exception as e:
#             #print(e)
#             replace=False
#         res = add_cart(
#             data["resid"],
#             userid,
#             data["item"],
#             data["ress_name"],
#             data["item_id"],
#             data["qty"],
#             # data["price"]
#             price,
#             available_qty,
#             replace
#         )

#         if(res["success"]):
#             return({"success":True,"Total":res["total"]})
#         return jsonify({"success": False,"message": res.get("message", "Unable to add item to cart")}), 400
#     except Exception as e:
#         #print(e)
#         return({"success":False ,"error":str(e)})


@app.post("/update_cart")
@login_required
#@limiter.limit("120 per minute")
def updateCart():
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403
    try:
        data = request.get_json(force=True) or {}
        item_id = data.get("item_id")
        qty = data.get("qty")

        if item_id is None or qty is None:
            print("error here")
            return jsonify({"success": False, "message": "item_id and qty are required"}), 400

        try:
            qty = int(qty)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "qty must be an integer"}), 400

        result = update_cart_qty(g.user_id, item_id, qty)
        # print(result)
        if result["success"]:
            return jsonify({
                "success": True,
                "total": result["total"],
                "removed": result.get("removed", False)
            })
        return jsonify({"success": False, "message": result.get("message", "Unable to update item")}), 400

    except Exception as e:
        #print("update_cart error:", e)
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500


@app.post("/add_to_cart")
#@limiter.limit("30 per minute")
@login_required
def addToCart():
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403
    try:
        data, error = validate_add_to_cart()
        if error:
            return error

        userid = g.user_id

        # TODO: re-enable server-side price/stock lookup instead of trusting the client.
        # response = get_resturantItem_price(data["resid"], data["item_id"])
        # price, available_qty = response["price"], response["available_qty"]
        price = data["price"]
        available_qty = 10000

        replace = data.get("replace", False)

        res = add_cart(
            # data["resid"],
            "123",
            userid,
            data["item"],
            data["ress_name"],
            data["item_id"],
            data["qty"],
            price,
            available_qty,
            replace
        )

        if res["success"]:
            return jsonify({"success": True, "Total": res["total"]})
        return jsonify({"success": False, "message": res.get("message", "Unable to add item to cart")}), 400

    except Exception as e:
        print("add_to_cart error:", e)
        return jsonify({"success": False, "message": "Something went wrong, please try again"}), 500
@app.get("/seller/menu/<name>/<seller_id>")
def seller_page(name,seller_id):
    try:
        return render_template("menu_seller.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/confirm_delivery")
@auth_driver
def confirm_delivery_route():
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    print('order_id',order_id)
    # otp = str(data.get("otp", "")).strip()

    # if not order_id or not otp:
    #     return jsonify({"success": False, "message": "order_id and otp are required"}), 400

    if not order_id :
        return jsonify({"success": False, "message": "order_id"}), 400

    result = confirm_delivery(order_id, g.driver_id)
    if result["success"]:
        return jsonify(result)
    return jsonify(result), 400


@app.post("/decline_order")
@auth_driver
def decline_order_route():
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    if not order_id:
        return jsonify({"success": False, "message": "order_id is required"}), 400

    decline_delivery_order(order_id, g.driver_id)
    return jsonify({"success": True})


@app.post("/advance_delivery_step")
@auth_driver
def advance_delivery_step_route():
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    if not order_id:
        return jsonify({"success": False, "message": "order_id is required"}), 400

    res = advance_delivery_step(order_id, g.driver_id)
    return jsonify(res)


@app.post("/driver/home_stats")
@auth_driver
def driver_home_stats_route():
    return jsonify(get_driver_home_stats(g.driver_id))


@app.post("/driver/history")
@auth_driver
def driver_history_route():
    data = request.get_json(silent=True) or {}
    print("driver_id",g.driver_id)
    return jsonify({"success": True, "history": get_driver_order_history(g.driver_id, data.get("range", "today"))})


@app.post("/driver/earnings")
@auth_driver
def driver_earnings_route():
    data = request.get_json(silent=True) or {}
    return jsonify({"success": True, "summary": get_driver_earnings_summary(g.driver_id, data.get("range", "today"))})


@app.get("/driver/earnings/weekly")
@auth_driver
def driver_earnings_weekly_route():
    return jsonify({"success": True, "chart": get_weekly_earnings_chart(g.driver_id)})


@app.get("/driver/documents")
@auth_driver
def driver_documents_route():
    return jsonify({"success": True, "documents": get_driver_documents(g.driver_id)})


@app.post("/driver/vehicle")
@auth_driver
def driver_vehicle_route():
    data = request.get_json(silent=True) or {}
    vehicle_type = data.get("vehicle_type")
    plate = data.get("plate")
    if not vehicle_type or not plate:
        return jsonify({"success": False, "message": "vehicle_type and plate are required"}), 400
    return jsonify(update_driver_vehicle(g.driver_id, vehicle_type, plate))

@app.post("/store_orders")
@login_required
def store_order():
    start=time.perf_counter()
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403

    user_id = g.user_id
    username = g.username
    data = request.get_json(silent=True) or {}
    coordinates = data.get("coordinates")
    if not coordinates:
        return jsonify({"success": False, "message": "coordinates are required"}), 400

    lock_key = f"lock:checkout:{user_id}"
    token = acquire_lock(lock_key, ttl_seconds=15)
    if not token:
        return jsonify({"success": False, "message": "Your order is already being processed"}), 409

    try:
        result = store_orders(user_id, coordinates)
        print(result)

        if result == 404:
            return jsonify({"success": False, "message": "Cart is empty"}), 400
        if result is False:
            return jsonify({"success": False, "message": "Unable to place order, please try again"}), 500
        if not result.get("success"):
            return jsonify({"success": False, "message": result.get("message", "Unable to place order")}), 400

        seller_order_id = result["order_id"]
        socketio.emit("new_order", {"msg": "refresh"}, room="warehouse")

        # print("resid",res_id)
        # res_location = get_restaurant_location(res_id)
        res_location = {"lat": 17.39532841640067, "lng": 78.43148662789395}
        if res_location:
            search_driver.delay(res_location, username, coordinates, seller_order_id, 10)
        #print("/store_order completed at",time.perf_counter()-start)
        return jsonify({"success": True, "id": seller_order_id})
    except Exception as e:
        print(e)
        return jsonify({"success": False}), 500
    finally:
        release_lock(lock_key, token)


@app.get("/orders/<userid>")
def renderOrders(userid):
    try:
        return render_template("orders.html",page="orders")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/get_orders/<userid>")
@login_required
def getOrders(userid):
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403
    try:
        userid=g.user_id
        orders=get_orders(userid)
        #print("oorders in server",orders)
        return({"success":True,"orders":orders})
    except Exception as e:
        #print(e)
        return({"success":False})
@app.route("/seller/orders",methods=["POST","GET"])
@login_required
def getsellerOrders():
    try:
        data=request.get_json()
        # res_id=data["res_id"]
        if g.type != "seller":
            return jsonify({
                "success": False,
                "message": "Unauthorized"
            }), 403
        res_id=g.res_id
        #print(res_id)
        orders=get_seller_ordes(res_id)
        #print("orders in server",orders)
        return({"success":True,"orders":orders})
    except Exception as e:
        print(e)
        return({"success":False})
# @app.post("/seller_orders")
# def store_seller_orde():
#     try:
#         data=request.get_json()
#         res_id=data["res_id"]
#         items=data["items"]
#         user_id=data["user_id"]
#         store_seller_orders(res_id,items,user_id)
#         return({"success":True})
#     except Exception as e:
        #print(e)
#         return({"success":False})
@app.get("/seller/orders/<res_name>/<res_id>")
def renderSellerOrders(res_name,res_id):
    try:
        return render_template("seller_orders.html",page="orders")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.route("/accept_order", methods=["POST"])
@auth_driver
def accept_order_server():
    start=time.perf_counter()
    driver_id = g.driver_id
    data = request.get_json(silent=True) or {}
    order_id = data.get("order_id")
    driver_coords=data.get("driver_coords")
    print("order_id",order_id)
    if not order_id:
        return jsonify({"success": False, "message": "order_id is required"}), 400

    won, redis_data = accept_order_redis(order_id, driver_id)
    print("won")
    if not won:
        print("not won")
        socketio.emit("order_taken", {"order_id": order_id}, room=f"driver_{driver_id}")
        return jsonify({"success": False, "message": "Order already taken"}), 409

    result = accept_delivery_order(order_id, driver_id, redis_data)
    if not result["success"]:
        print(result)
        delete_lock(order_id)
        return jsonify({"success": False, "message": result["message"]}), 400
    socketio.emit("driver_assigned", {"order_id": order_id,"warehouse_coords":result["order"]["warehouse_coords"],"driver_coords":driver_coords}, room="warehouse")
    socketio.emit("driver_assigned", {"order_id": order_id,"warehouse_coords":result["order"]["warehouse_coords"],"driver_coords":driver_coords}, room=order_id)
    #print("accept_order_server",time.perf_counter()-start)
    return jsonify({"success": True, "order": result["order"]})
@app.route("/driver/active_order",methods=["POST","GET"])
@auth_driver
def return_active_order():
    #print("in return active order")
    driver_id=g.driver_id
    res=get_active_driver_order(driver_id)
    if(res==None):
        return {"success":False,"order":None}
    return {"success":True,"order":res}
@app.get("/driver/<driver_id>")
@auth_driver
def renderdriverOrders(driver_id):
    return render_template("driver_ui.html")
@app.get("/driver")
# @auth_driver
def renderdriverOrdersss():
    return render_template("driver_ui.html")
# @socketio.on('join_user_room')
# @login_required
# def handle_user_join(data):
#     try:
#         print("hollas")
#         # user_id = data['user_id']
#         user_id=g.user_id
#         print("join_user_room",user_id)
#         join_room(user_id)
#         #print(f"User joined: {user_id}")
#     except Exception as e:
#         print(e)
#         return({"success":False})
@socketio.on('join_user_room')
@login_required
def handle_user_join(data):
    try:
        print("hollas")
        # user_id = data['user_id']
        # user_id=g.user_id
        order_id=data["order_id"]
        print("join_user_room",order_id)
        join_room(order_id)
        #print(f"User joined: {user_id}")
    except Exception as e:
        print(e)
        return({"success":False})
@socketio.on("track_order")
def tracks_order(data):
    order_id = data["order_id"]
    print("orderid in track order server",order_id)
    join_room(f"track_order:{order_id}")
@socketio.on("driver_location")
def driver_location(data):
    order_id = data["order_id"]
    print("orderid in driver_location server",order_id)
    emit(
        "update_driver_location",
        data,
        room=f"track_order:{order_id}"
    )
@socketio.on('join_seller_room')
@login_required
def handle_join(data):
    try:
        # seller_id = data['seller_id']
        seller_id=g.res_id
        join_room("warehouse")
    except Exception as e:
        print(e)
        return({"success":False})
def notify_new_order(seller_id, order):
    try:
        socketio.emit('new_order', order, room="warehouse")
    except Exception as e:
        print(e)
        return({"success":False})

@socketio.on("join_driver_room")
def join_driver_room(data):
    token = request.cookies.get("driver_token")
    if not token:
        emit("auth_error", {"message": "Not authenticated"})
        return
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        if payload.get("type") != "driver":
            raise jwt.InvalidTokenError()
        driver_id = payload["driver_id"]
    except jwt.InvalidTokenError:
        emit("auth_error", {"message": "Invalid token"})
        return

    room = f"driver_{driver_id}"
    join_room(room)
    emit("joined", {"room": room})


@socketio.on("leave_driver_room")
def leave_drivers_room(data):
    token = request.cookies.get("driver_token")
    if not token:
        return
    try:
        payload = jwt.decode(token, app.config["SECRET_KEY"], algorithms=["HS256"])
        driver_id = payload["driver_id"]
    except jwt.InvalidTokenError:
        return

    room = f"driver_{driver_id}"
    leave_room(room)
    emit("left", {"room": room})
# @socketio.on("track_order")
# def track_order(data):
#     order_id=data["order_id"]
#     print("in track order")
#     join_room(f"track_order:{order_id}")
# @socketio.on("driver_location")
# def driver_location(data):
#     print("in driver location")
#     order_id=data["order_id"]
#     emit("update_driver_location",data,room=f"track_order:{order_id}")

@socketio.on("leave_driver_room")
def leave_drivers_room(data):
    print(data)
    driver_id = data["driver_id"]
    
    #print("driver_id room:", driver_id)

    room = f"driver_{driver_id}"
    leave_room(room)

    #print("LEFT ROOM:", room)

    emit("left", {
        "room": room
    })
@socketio.on("order_completed")
@login_required
def handle_order_completed(data):
    try:
        print("Order completed:", data)

        token_no = data.get("token_no")
        # user_id=data.get("userid")
        order_id = data.get("order_id")
        # res_id=data.get("res_id")
        res_id=g.res_id
        user_order_id=verify_order(res_id,order_id)
        if(user_order_id==None):
            return {"success": False, "message": "Unauthorized order"}
        status=data.get("status")
        print("user_id",order_id,user_order_id)
        # send update to USER
        socketio.emit(
            "order_status_updated",
            {
                "order_id": order_id,
                "token_no":token_no,
                "res_id":res_id,
                "status": status
            },
            room=user_order_id
        )
        return({"success":True})
    except Exception as e:
        #print(e)
        return({"success":False,"message":str(e)})
import re

EMAIL_REGEX = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")
@app.post("/validate_driver")
def validate_driver():
    credentials, error = validate_credentials(request.get_json(silent=True))
    if error:
        return error

    res = check_existing_driver(credentials["email"], credentials["password"])

    if res.get("success") is True:
        token = jwt.encode(
            {
                "type": "driver",
                "driver_id": res["userid"],
                "username": res["username"],
                "exp": datetime.utcnow() + timedelta(days=30)
            },
            app.config["SECRET_KEY"],
            algorithm="HS256"
        )
        response = jsonify({"success": True, "driver_id": res["userid"], "username": res["username"]})
        response.set_cookie(
            "driver_token", token,
            httponly=True, secure=COOKIE_SECURE, samesite="Lax",
            max_age=30 * 24 * 60 * 60
        )
        return response

    return jsonify({"success": False, "message": "Invalid email or password"}), 401


@app.get("/logout/driver")
def logout_driver():
    response = jsonify({"success": True})
    response.delete_cookie("driver_token")
    return response


@app.get("/driver/me")
@auth_driver
def driver_me():
    return jsonify({"success": True, "driver_id": g.driver_id, "username": g.username})

@app.post("/signup_driver")
def signup_driver():
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"success": False, "message": "Request body is required"}), 400

    email = data.get("email", "").strip().lower()
    username = data.get("username", "").strip()
    password = data.get("password", "")

    if not email or not EMAIL_REGEX.match(email):
        return jsonify({"success": False, "message": "Valid email is required"}), 400
    if not username or len(username) < 3:
        return jsonify({"success": False, "message": "Username is required"}), 400
    if not password or len(password) < 8:
        return jsonify({"success": False, "message": "Password must be at least 8 characters"}), 400

    res = create_new_driver(email, username, password)
    token=jwt.encode({
        "username":username,
        "driver_id":res["id"],
        "type":"driver"
    },app.config["SECRET_KEY"],
    algorithm="HS256")
    response=jsonify({"success": True, "id": res["id"],})
    response.set_cookie("user_token",token,httponly=True,secure=COOKIE_SECURE,max_age=7 * 24 * 60 * 60)
    if res["success"]:
        return response
    return jsonify({"success": False, "message": res.get("message", "Signup failed")}), 400

@app.post("/validate_user")
#@limiter.limit("10 per minute")
def validate():
    try:
        data=request.get_json()
        if not data:
            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        credentials, error = validate_credentials(request.get_json())

        if error:
            return error

        res = check_existing_user(
            credentials["email"],
            credentials["password"]
        )
        #print("res",res)
        if(res["success"]==False): return jsonify({
                "success": False,
                "message": "Invalid email or password"
            }), 401
        elif(res["success"]==True):
            if(res["is_verified"]): 
                userid=str(res["userid"])
                username=res["username"]
                #print(userid)
                token = jwt.encode(
                    {   
                        "type":"user",
                        "user_id": str(userid),
                        "username":username,
                        "exp": datetime.utcnow() + timedelta(days=7)
                    },
                    app.config["SECRET_KEY"],
                    algorithm="HS256"
                )
                response=jsonify({"success":True,"user_id":userid,"username":username})
                response.delete_cookie("seller_token")
                response.set_cookie(
                    "user_token",
                    token,
                    httponly=True,
                    secure=COOKIE_SECURE,      # True in production with HTTPS
                    samesite="Lax",
                    max_age=7 * 24 * 60 * 60
                )
                return response
            else:
                print("in else block")
                res_email=send_verification_email(data["email"],"user")
                if (res_email == 1):
                    return jsonify({
                        "success": False,
                        "message": "Email not verified"
                    }), 403

                return jsonify({
                    "success": False,
                    "message": "Failed to send verification email"
                }), 500
                # if(res_email == 1): return({"success":False,"msg":"Not_verified"})
                # else: return ({"success":False,"msg":"Internal Server occured Please Try Again"})
        else: return({"success":False,"message":"Not_found"})
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/validate_owner")
#@limiter.limit("10 per minute")
def validate_owner():
    try:
        data=request.get_json()
        if not data:
            return ({"success":False})
        # #print("data in login",data)
        # email,password=validate_credentials(data)
        credentials, error = validate_credentials(data)

        if error:
            return error

        email = credentials["email"]
        password = credentials["password"]
        res=check_existing_owner(email,password)
        #print("res",res)
        if(res["success"]==False): return({"success":False})
        elif(res["success"]==True):
            if(res["is_verified"]): 
                if(res["is_setup"]==False):
                    token = jwt.encode(
                        {   
                            "type":"seller",
                            "username":res["username"],
                            "owner_id": str(res["id"]),
                            "exp": datetime.utcnow() + timedelta(hours=1)
                        },
                        app.config["SECRET_KEY"],
                        algorithm="HS256"
                        )
                    response=jsonify({"success":True,"user_id":res["id"],"is_setup":False})
                    response.set_cookie(
                        "seller_res_token",
                        token,
                        httponly=True,
                        secure=COOKIE_SECURE,      # True in production with HTTPS
                        samesite="Lax",
                        max_age=7 * 24 * 60 * 60
                    )
                    return response
                    # return({"success":True,"res_id":res["res_id"],"is_setup":False})
                res_id=str(res["res_id"])
                res_name=res["resturant_name"]
                is_setup=res["is_setup"]
                username=res["username"]
                token = jwt.encode(
                    {
                        "type":"seller",
                        "res_id": str(res_id),
                        "res_name":res_name,
                        "username":username,
                        "exp": datetime.utcnow() + timedelta(days=7)
                    },
                    app.config["SECRET_KEY"],
                    algorithm="HS256"
                )
                response=jsonify({"success":True,"res_id":res_id,"res_name":res_name,"is_setup":is_setup})
                response.delete_cookie("user_token")
                response.set_cookie(
                    "seller_token",
                    token,
                    httponly=True,
                    secure=COOKIE_SECURE,      # True in production with HTTPS
                    samesite="Lax",
                    max_age=7 * 24 * 60 * 60
                )
                return response
                # return ({"success":True,"user_id":userid,"username":username,"is_setup":is_setup})
            else:
                res_email=send_verification_email(data["email"],"owner")
                if(res_email==1): return({"success":False,"msg":"not_verified"})
                else: return({"success":False,"msg":"Internal Server occured Please Try again"})
        else: return({"success":False,"msg":"Not_found"})
    except Exception as e:
        #print("in exception validate owner")
        #print(e)
        return {"success": False}
@app.post("/signup_user")
#@limiter.limit("5 per minute")
def signup_user():
    try:
        # #print(signup)
        data=request.get_json()
        # #print("data in signup",data)
        # email=data["email"]
        # username=data["username"]
        # password=data["password"]
        # role=data["role"]
        # data=request.get_json()
        
        if not data:
            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        signup_data, error = validate_signup(data)

        if error:
            return error
        # #print(email)
        # #print("mail sent",role)
        res = create_new_user(
            signup_data["email"],
            signup_data["username"],
            signup_data["password"],
            signup_data["role"]
        )

        email=signup_data["email"]
        role=signup_data["role"]
        # if(verify)
        #print(res)
        if(res["success"]):
            res_email=send_verification_email(email,role)
            if (res_email==1):
                if(role=="seller"):
                    token = jwt.encode(
                    {   
                        "type":"seller",
                        "owner_id": str(res["id"]),
                        "username":signup_data["username"],
                        "exp": datetime.utcnow() + timedelta(hours=1)
                    },
                    app.config["SECRET_KEY"],
                    algorithm="HS256"
                    )
                    response=jsonify({"success":True,"user_id":res["id"]})
                    response.set_cookie(
                        "seller_res_token",
                        token,
                        httponly=True,
                        secure=COOKIE_SECURE,      # True in production with HTTPS
                        samesite="Lax",
                        max_age=7 * 24 * 60 * 60
                    )
                    return response
                else:
                    return ({"success":True,"user_id":res["id"]})
            else: return({"success":False,"msg":"Internal Server Occured Please Try Again"})
        else:
            return ({"success":False,"msg":"user already exists!"})
    except Exception as e:
        #print("in exception signup user")
        #print(e)
        return({"success":False,"msg":"Internal Error occured Please Try Again"})

@app.route("/verify/<token>")
def verify_email(token):
    try:
        data = serializer.loads(
        token,
        salt="email-verification",
        max_age=3600
    )
        email = data["email"]
        role = data["role"]
    except Exception:
        return "Invalid or expired link."

    userid=set_verified(email,role)

    return f"""
        <h1>Email verified successfully ✅</h1>
        <p>Redirecting to login page in 3 seconds...</p>

        <script>
        const role = "{role}";

        setTimeout(() => {{
            if(role === "user")
                window.location.href = "/login/user";
            else
                window.location.href = "/login/seller";
        }}, 3000);
        </script>
        """

@app.post("/save_subcategory")
@login_required
#@limiter.limit("30 per minute")
def save_subcats():
    # data=request.get_json()
    # # res_id=data["res_id"]
    # res_id=g.res_id
    # cat_id=data["category_id"]
    # subcat_name=data["name"]
    data, error = validate_subcategory()

    if error:
        return error
    res = add_subcategory(
            g.res_id,
            data["category_id"],
            data["name"]
        )
    if(res["success"]):
        return {"success": True,"subcategory": res["subcategory"]}
    else:
        return {"success":False}
@app.get("/seller/resturantSetup/<seller_id>")
@auth_seller_res
def renderSetup(seller_id):
    try:
        return render_template("resturant_setup.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.route("/login/<role>")
def login(role):
    try:
        return render_template("auth.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.route("/signup/<role>")
def signup(role):
    try:
        return render_template("signup.html")
    except Exception as e:
        #print(e)
        return({"success":False})
# @app.get("/seller/<name>/<seller_id>")
# def sellerTemplate(name,seller_id):
#     try:
#         return render_template("seller.html")
#     except Exception as e:
#         #print(e)
#         return({"success":False})
@app.get("/seller/<name>/<seller_id>")
@login_required
def sellerTemplate(name,seller_id):
    try:
        username=g.username
        #print(username)
        return render_template("seller_dashboard.html",page="dashboard",username=username)
    except Exception as e:
        #print(e)
        return({"success":False})
@app.get("/landing")
def renderLanding():
    try:
        return render_template("landing.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/update_order")
@login_required
#@limiter.limit("30 per minute")
def update_status():
    try:
        res_id=g.res_id
        data=request.get_json()
        order_id=data["order_id"]
        status=data["status"]
        userid=data["user_id"]
        res=update_order_status_seller(order_id,status,userid,res_id)
        if(res["success"]):
            return ({"success":True})
        else:
            return({"success":False,"message":res["message"]})
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/update_order_user")
@login_required
#@limiter.limit("30 per minute")
def update_status_user():
    try:
        userid=g.user_id
        data=request.get_json()
        order_id=data["order_id"]
        status=data["status"]
        print("holla")
        # userid=data["user_id"]
        result=update_order_status_user(order_id,status,userid)
        print(result)
        if result["success"]:
            return jsonify(result)

        return jsonify(result), 403
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/stats")
@login_required
def returnstats():
    try:
        res_id=g.res_id
        data=request.get_json()
        # res_id=data["res_id"]
        res=resturant_stats(res_id)
        return({"success":True,"stats":res})
    except Exception as e:
        #print(e)
        return({"success":False})
@app.get("/seller/analytics/<res_id>")
def render_analytics_template(res_id):
    try:
        #print("seller_anlytics")
        return render_template("analytics.html")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/seller/analytics")
@login_required
def return_seller_stats():
    try:
        data=request.get_json()
        # res_id=data["res_id"]
        res_id=g.res_id
        stats=return_res_analytics(res_id)
        return({"success":True,"stats":stats})
    except Exception as e:
        #print(e)
        return({"success":False})
    
@app.post("/seller/stats")
@login_required
def return_seller_statistics():
    try:
        res_id=g.res_id
        stats=get_seller_analytics(res_id)
        return({"success":True,"stats":stats})
    except Exception as e:
        #print(e)
        return({"success":False})
# @app.post("/update_cart")
# @login_required
# def update_cart():
#     try:
#         # data=request.get_json()
#         # # userid=data["user_id"]
#         # userid=g.user_id
#         # item_id=data["item_id"]
#         # qty=data["qty"]
#         data, error = validate_update_cart()

#         if error:
#             return error

#         userid = g.user_id
#         res = update_cart_qty(userid,data["item_id"],data["qty"])
#         #print(res)
#         if not res["success"]:
#             return jsonify({"success": False,"message": res.get("message", "Unable to update cart")}), 400
#         return ({"success":True,"total":res["total"]})
#     except Exception as e:
#         #print(e)
#         return({"success":False})
# @app.post("/update_cart")
# @login_required
# def updateCart():
#     data = request.get_json()
#     result = update_cart_qty(g.user_id, data["item_id"], int(data["qty"]))
#     if result["success"]:
#         return jsonify({"success": True, "total": result["total"]})
#     return jsonify({"success": False, "message": result.get("message", "Unable to update item")}), 400
@socketio.on("user_cancelled_order")
def handle_user_cancel(data):
    try:
        print("in cancelled order")
        # data['res_ids'] is now a LIST: ["res1", "res2"]
        # res_list = data.get("res_ids", [])
        emit("seller_order_cancelled", data, room="warehouse")
    except Exception as e:
        #print(e)
        return({"success":False})
@app.post("/save_address")
@login_required
#@limiter.limit("10 per minute")
def save_address_type():
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403
    try:    
        # data=request.get_json()
        # address=data["address"]
        # types=data["address_type"]
        # # uid=data["userId"]
        # uid=g.user_id
        # cordinates=data["cordinates"]
        # result=save_address(address,types,uid,cordinates)
        data, error = validate_address()

        if error:
            return error

        result = save_address(
            data["address"],
            data["address_type"],
            g.user_id,
            data["cordinates"]
            )
        if(result["success"]):
            return ({"success":True})
        else:
            return ({"success":False})
    except Exception as e:
        #print(e)
        return jsonify({"success": False,"message": "Internal server error"}), 500
@app.post("/fetch_address")
@login_required
def fetch_addresss():
    if g.type != "user":
        return jsonify({"success": False, "message": "Unauthorized"}), 403
    try:
        data=request.get_json()
        # uid=data["user_id"]
        uid=g.user_id
        address=fetch_address(uid)
        if(address["success"]):
            if(address["status"]==200):
                return({"success":True,"address":address["address"]}),200
            return({"success":False,"msg":"No Address Found","status":404})
        else:
            return({"success":False,"status":500})
    except AttributeError:
        # return({"success":False,"msg":"Login Please"})
        response=jsonify({"success":False,"msg":"Login Please"})
        # token = (
        #     request.cookies.get("seller_token")
        # )
        
        response.delete_cookie("seller_token")
        return response
    except:
        return({"success":False})
    
@app.post("/save_categories")
@login_required
#@limiter.limit("20 per minute")
def sve_cate():
    # data=request.get_json()
    # # res_id=data["res_id"]
    # res_id=g.res_id
    # cat_name=data["cat_name"]
    # sub_cats=data["subcats"]
    # res=save_category(res_id,cat_name,sub_cats)
    data, error = validate_category()

    if error:
        return error

    res = save_category(
        g.res_id,
        data["cat_name"],
        data["subcats"]
    )
    if(res["success"]):
        #print(res)
        return({"success":True,"category":res["category_data"]})
    else:
        #print(res)
        return({"success":False,"error":res["error"]})
    

############################# VALIDATION FNS ######################

from flask import jsonify

ALLOWED_EXTENSIONS = {"png", "jpg", "jpeg", "webp"}

def allowed_file(filename):
    return "." in filename and \
        filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_item_form():
    itm_name = request.form.get("itm_name", "").strip()
    itm_qty = request.form.get("itm_qty", "").strip()
    price = request.form.get("price")
    sub_id = request.form.get("sub_id", "").strip()
    desc = request.form.get("desc", "").strip()
    unit = request.form.get("unit", "").strip()
    lowat = request.form.get("lowat", "").strip()
    available = request.form.get("available", "").strip()
    photo = request.files.get("photo")

    # Required fields
    if not itm_name:
        return None, (jsonify({"success": False, "message": "Item name is required"}), 400)

    if not itm_qty:
        return None, (jsonify({"success": False, "message": "Item quantity is required"}), 400)

    if not price:
        return None, (jsonify({"success": False, "message": "Price is required"}), 400)

    if not sub_id:
        return None, (jsonify({"success": False, "message": "Category is required"}), 400)

    if not unit:
        return None, (jsonify({"success": False, "message": "Unit is required"}), 400)

    if available == "":
        return None, (jsonify({"success": False, "message": "Availability is required"}), 400)

    # Price
    try:
        price = int(price)
        if price < 0:
            return None, (jsonify({"success": False, "message": "Price must be positive"}), 400)
    except ValueError:
        return None, (jsonify({"success": False, "message": "Invalid price"}), 400)

    # Quantity
    try:
        itm_qty = float(itm_qty)
        if itm_qty <= 0:
            return None, (jsonify({"success": False, "message": "Quantity must be greater than 0"}), 400)
    except ValueError:
        return None, (jsonify({"success": False, "message": "Invalid quantity"}), 400)

    # Low stock alert (optional)
    if lowat:
        try:
            lowat = float(lowat)
            if lowat < 0:
                return None, (jsonify({"success": False, "message": "Invalid low stock value"}), 400)
        except ValueError:
            return None, (jsonify({"success": False, "message": "Invalid low stock value"}), 400)
    else:
        lowat = None

    # Available
    if available.lower() not in ("true", "false", "0", "1"):
        return None, (jsonify({"success": False, "message": "Invalid availability"}), 400)

    available = available.lower() in ("true", "1")

    # Image
    if photo:
        if photo.filename == "":
            return None, (jsonify({"success": False, "message": "Invalid image"}), 400)

        if not allowed_file(photo.filename):
            return None, (
                jsonify({
                    "success": False,
                    "message": "Only PNG, JPG, JPEG and WEBP images are allowed"
                }),
                400
            )

    return {
        "itm_name": itm_name,
        "itm_qty": itm_qty,
        "price": price,
        "sub_id": sub_id,
        "desc": desc,
        "unit": unit,
        "lowat": lowat,
        "available": available,
        "photo": photo
    }, None
#################22222222222222#################
from flask import jsonify, request

def validate_update_item():
    data = request.get_json(silent=True)
    #print("data=",data)
    if not data:
        return None, (jsonify({
            "success": False,
            "message": "Invalid JSON payload"
        }), 400)

    # Required fields
    required = [
        "item_id",
        "name",
        "price",
        "unit",
        "lowAt",
        "desc",
        "subId",
        "stock",
        "available"
    ]

    for field in required:
        if field not in data:
            return None, (jsonify({
                "success": False,
                "message": f"{field} is required"
            }), 400)

    # Name
    name = str(data["name"]).strip()
    if not name:
        return None, (jsonify({
            "success": False,
            "message": "Item name cannot be empty"
        }), 400)

    # Price
    try:
        price = int(data["price"])
        if price < 0:
            raise ValueError
    except (ValueError, TypeError):
        return None, (jsonify({
            "success": False,
            "message": "Invalid price"
        }), 400)

    # Stock
    try:
        stock = float(data["stock"])
        if stock < 0:
            raise ValueError
    except (ValueError, TypeError):
        return None, (jsonify({
            "success": False,
            "message": "Invalid stock quantity"
        }), 400)

    # Low stock alert
    try:
        low_at = float(data["lowAt"])
        if low_at < 0:
            raise ValueError
    except (ValueError, TypeError):
        return None, (jsonify({
            "success": False,
            "message": "Invalid low stock value"
        }), 400)

    # Available
    if not isinstance(data["available"], bool):
        return None, (jsonify({
            "success": False,
            "message": "available must be true or false"
        }), 400)

    validated = {
        "item_id": data["item_id"],
        "name": name,
        "price": price,
        "unit": str(data["unit"]).strip(),
        "lowAt": low_at,
        "desc": str(data["desc"]).strip(),
        "subId": data["subId"],
        "stock": stock,
        "available": data["available"]
    }

    return validated, None
####################33333333333333333333333######################
from flask import request, jsonify

def validate_add_to_cart():
    data = request.get_json(silent=True)
    # #print(data)
    # #print("validate_add to cart",data)
    if not data:
        return None, (jsonify({
            "success": False,
            "message": "Invalid JSON payload"
        }), 400)
    

    required = [
        # "resid",
        "item",
        "qty",
        "item_id",
        "ress_name",
        "price"
    ]

    for field in required:
        if field not in data:
            return None, (jsonify({
                "success": False,
                "message": f"{field} is required"
            }), 400)

    # Item name
    item = str(data["item"]).strip()
    if not item:
        return None, (jsonify({
            "success": False,
            "message": "Item name cannot be empty"
        }), 400)

    replace= data["replace"]
    if(type(replace)!=bool):
        return None, (jsonify({
            "success": False,
            "message": "Replace value must be a Boolean"
        }), 400)
    # Restaurant name
    res_name = str(data["ress_name"]).strip()
    if not res_name:
        return None, (jsonify({
            "success": False,
            "message": "Restaurant name cannot be empty"
        }), 400)

    # Quantity
    try:
        qty = int(data["qty"])
        if qty <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return None, (jsonify({
            "success": False,
            "message": "Quantity must be greater than 0"
        }), 400)

    # Price
    try:
        price = float(data["price"])
        if price < 0:
            raise ValueError
    except (ValueError, TypeError):
        return None, (jsonify({
            "success": False,
            "message": "Invalid price"
        }), 400)

    # IDs
    try:
        # resid = (data["resid"])
        item_id = (data["item_id"])
    except Exception as e:
        #print(e)
        return None, (jsonify({
            "success": False,
            "message": "Invalid restaurant or item id"
        }), 400)

    return {
        # "resid": resid,
        "item": item,
        "qty": qty,
        "item_id": item_id,
        "ress_name": res_name,
        "price": price,
        "replace":replace
    }, None
def validate_update_cart():
    data = request.get_json(silent=True)
    #print("valid update cart",data)
    if not data:
        return None, (jsonify({
            "success": False,
            "message": "Invalid JSON"
        }), 400)

    if "item_id" not in data:
        return None, (jsonify({
            "success": False,
            "message": "item_id is required"
        }), 400)

    if "qty" not in data:
        return None, (jsonify({
            "success": False,
            "message": "qty is required"
        }), 400)

    try:
        item_id = (data["item_id"])
        qty = int(data["qty"])
    except (TypeError, ValueError):
        return None, (jsonify({
            "success": False,
            "message": "Invalid item_id or qty"
        }), 400)

    # if qty < 0:
    #     return None, (jsonify({
    #         "success": False,
    #         "message": "Quantity cannot be negative"
    #     }), 400)

    return {
        "item_id": item_id,
        "qty": qty
    }, None
from flask import request, jsonify

def validate_subcategory():
    data = request.get_json(silent=True)

    if not data:
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid JSON payload"
            }),
            400
        )

    if "category_id" not in data:
        return None, (
            jsonify({
                "success": False,
                "message": "category_id is required"
            }),
            400
        )

    if "name" not in data:
        return None, (
            jsonify({
                "success": False,
                "message": "Subcategory name is required"
            }),
            400
        )

    try:
        category_id = int(data["category_id"])
    except (ValueError, TypeError):
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid category_id"
            }),
            400
        )

    name = str(data["name"]).strip()

    if not name:
        return None, (
            jsonify({
                "success": False,
                "message": "Subcategory name cannot be empty"
            }),
            400
        )

    if len(name) > 100:
        return None, (
            jsonify({
                "success": False,
                "message": "Subcategory name is too long"
            }),
            400
        )

    return {
        "category_id": category_id,
        "name": name
    }, None
from flask import request, jsonify

from flask import request, jsonify

def validate_category():
    data = request.get_json(silent=True)

    if not data:
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid JSON payload"
            }),
            400
        )

    cat_name = str(data.get("cat_name", "")).strip()

    if not cat_name:
        return None, (
            jsonify({
                "success": False,
                "message": "Category name is required"
            }),
            400
        )

    if len(cat_name) > 100:
        return None, (
            jsonify({
                "success": False,
                "message": "Category name is too long"
            }),
            400
        )

    subcats = data.get("subcats")

    if subcats is None:
        return None, (
            jsonify({
                "success": False,
                "message": "subcats is required"
            }),
            400
        )

    if not isinstance(subcats, list):
        return None, (
            jsonify({
                "success": False,
                "message": "subcats must be a list"
            }),
            400
        )

    cleaned_subcats = []
    seen = set()

    for i, subcat in enumerate(subcats):
        if not isinstance(subcat, str):
            return None, (
                jsonify({
                    "success": False,
                    "message": f"Subcategory at index {i} must be a string"
                }),
                400
            )

        subcat = subcat.strip()

        if not subcat:
            continue

        if len(subcat) > 100:
            return None, (
                jsonify({
                    "success": False,
                    "message": f"Subcategory '{subcat}' is too long"
                }),
                400
            )

        key = subcat.lower()

        if key not in seen:
            seen.add(key)
            cleaned_subcats.append(subcat)

    if not cleaned_subcats:
        return None, (
            jsonify({
                "success": False,
                "message": "At least one valid subcategory is required"
            }),
            400
        )

    return {
        "cat_name": cat_name,
        "subcats": cleaned_subcats
    }, None
from flask import request, jsonify

from flask import request, jsonify

def validate_address():
    data = request.get_json(silent=True)

    if not data:
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid JSON payload"
            }),
            400
        )

    address = str(data.get("address", "")).strip()

    if not address:
        return None, (
            jsonify({
                "success": False,
                "message": "Address is required"
            }),
            400
        )

    address_type = str(data.get("address_type", "")).strip()

    if not address_type:
        return None, (
            jsonify({
                "success": False,
                "message": "Address type is required"
            }),
            400
        )

    # Modify these values if your frontend uses different names
    allowed_types = {"Home", "Work", "Other"}

    if address_type not in allowed_types:
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid address type"
            }),
            400
        )

    coordinates = data.get("cordinates")

    if not isinstance(coordinates, dict):
        return None, (
            jsonify({
                "success": False,
                "message": "Coordinates are required"
            }),
            400
        )

    latt = coordinates.get("latt")
    longitude = coordinates.get("long")

    if latt is None or longitude is None:
        return None, (
            jsonify({
                "success": False,
                "message": "Latitude and longitude are required"
            }),
            400
        )

    try:
        latt = float(latt)
        longitude = float(longitude)
    except (ValueError, TypeError):
        return None, (
            jsonify({
                "success": False,
                "message": "Coordinates must be valid numbers"
            }),
            400
        )

    if not (-90 <= latt <= 90):
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid latitude"
            }),
            400
        )

    if not (-180 <= longitude <= 180):
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid longitude"
            }),
            400
        )

    return {
        "address": address,
        "address_type": address_type,
        "cordinates": {
            "latt": latt,
            "long": longitude
        }
    }, None
def validate_credentials(data):
    if not data:
        return None, (
            jsonify({
                "success": False,
                "message": "Request body is required"
            }),
            400
        )

    email = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email:
        return None, (
            jsonify({
                "success": False,
                "message": "Email is required"
            }),
            400
        )

    if not EMAIL_REGEX.match(email):
        return None, (
            jsonify({
                "success": False,
                "message": "Invalid email format"
            }),
            400
        )

    if not password:
        return None, (
            jsonify({
                "success": False,
                "message": "Password is required"
            }),
            400
        )

    return {
        "email": email,
        "password": password
    }, None
def validate_signup(data):
    if not data:
        return None, (
            jsonify({
                "success": False,
                "message": "Request body is required"
            }),
            400
        )

    email = data.get("email", "").strip().lower()
    username = data.get("username", "").strip()
    password = data.get("password", "")
    role = data.get("role", "").strip().lower()

    if not email:
        return None, (jsonify({"success": False, "message": "Email is required"}), 400)

    if not EMAIL_REGEX.match(email):
        return None, (jsonify({"success": False, "message": "Invalid email"}), 400)

    if not username:
        return None, (jsonify({"success": False, "message": "Username is required"}), 400)

    if len(username) < 3:
        return None, (jsonify({"success": False, "message": "Username is too short"}), 400)

    if not password:
        return None, (jsonify({"success": False, "message": "Password is required"}), 400)

    if len(password) < 8:
        return None, (jsonify({"success": False, "message": "Password must be at least 8 characters"}), 400)

    if role not in ("user", "seller"):
        return None, (jsonify({"success": False, "message": "Invalid role"}), 400)

    return {
        "email": email,
        "username": username,
        "password": password,
        "role": role
    }, None

# @app.route("/search_partner",methods=["POST"])
# def find_driver():
#     data=request.get_json()
#     user_location=data["user_loc"]
#     res_location=data["res_location"]

#     res=search_driver(res_location)
#     if res["success"]:
#         return res
#     else:
#         return ({"success":False})

@app.route("/partner_online", methods=["POST"])
@auth_driver
def set_online():
    data = request.get_json(silent=True) or {}
    try:
        lat = float(data["lat"])
        lng = float(data["lng"])
    except (KeyError, TypeError, ValueError):
        return jsonify({"success": False, "message": "Valid lat/lng required"}), 400

    driver_id = g.driver_id
    res = update_driver_location(driver_id, lat, lng)
    set_driver_online_status(driver_id, True)

    if res["success"]:
        return jsonify({"success": True})
    return jsonify({"success": False}), 500


@app.route("/partner_offline", methods=["POST"])
@auth_driver
def set_offline():
    driver_id = g.driver_id
    set_driver_offline(driver_id)
    set_driver_online_status(driver_id, False)
    return jsonify({"success": True})



if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0" , port=5000,debug=True)  # never True once FLASK_ENV=production
# from waitress import serve

# serve(
#     app,
#     host="0.0.0.0",
#     port=5000,
#     threads=32,
#     connection_limit=500
# )
