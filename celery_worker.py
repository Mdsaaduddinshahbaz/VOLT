from celery import Celery

celery = Celery(
    "myapp",
    broker="redis://default:9EaR55kom1p9DAAtx1T3uEahpLfIYEQ3@redis-15710.crce281.ap-south-1-3.ec2.cloud.redislabs.com:15710/0"
)
print(celery.connection().connect())
print("Connected!")