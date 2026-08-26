from celery import Celery

celery = Celery(
    "myapp",
    broker="redis://default:dqmSgyy091TgedgTzAgY70XdjfoZxbAi@citrus-apparel-partner-35901.db.redis.io:19530/0"
)
print(celery.connection().connect())
print("Connected!")