import os
import decimal
import hashlib
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from flask import Flask, jsonify, request
from flask_cors import CORS


AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LOGIN_TABLE = os.getenv("LOGIN_TABLE", "login")
MUSIC_TABLE = os.getenv("MUSIC_TABLE", "music-final")
SUBSCRIPTIONS_TABLE = os.getenv("SUBSCRIPTIONS_TABLE", "subscriptions")
S3_BUCKET = os.getenv("S3_BUCKET", "")
FRONTEND_ORIGIN = os.getenv("FRONTEND_ORIGIN", "*")

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)

login_table = dynamodb.Table(LOGIN_TABLE)
music_table = dynamodb.Table(MUSIC_TABLE)
subscriptions_table = dynamodb.Table(SUBSCRIPTIONS_TABLE)

app = Flask(__name__)
CORS(
    app,
    resources={
        r"/*": {
            "origins": FRONTEND_ORIGIN if FRONTEND_ORIGIN != "*" else "*",
            "methods": ["GET", "POST", "DELETE", "OPTIONS"],
            "allow_headers": ["Content-Type", "Authorization"],
        }
    },
)


def norm(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def clean_json(value):
    if isinstance(value, list):
        return [clean_json(v) for v in value]
    if isinstance(value, dict):
        return {k: clean_json(v) for k, v in value.items()}
    if isinstance(value, decimal.Decimal):
        return int(value) if value % 1 == 0 else float(value)
    return value


def send(payload, status=200):
    return jsonify(clean_json(payload)), status


def make_song_id(song):
    raw = "|".join([
        norm(song.get("artist")),
        norm(song.get("title")),
        str(song.get("year", "")).strip(),
        norm(song.get("album")),
    ])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def add_image_url(item):
    item = dict(item)

    key = item.get("image_s3_key", "")
    fallback = (
        item.get("img_url", "")
        or item.get("image_url", "")
        or item.get("original_image_url", "")
    )

    if key and S3_BUCKET:
        try:
            url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": key},
                ExpiresIn=3600,
            )
            item["image_url"] = url
            item["img_url"] = url
        except Exception:
            item["image_url"] = fallback
            item["img_url"] = fallback
    else:
        item["image_url"] = fallback
        item["img_url"] = fallback

    return item


def scan_all_music():
    items = []
    kwargs = {}

    while True:
        result = music_table.scan(**kwargs)
        items.extend(result.get("Items", []))

        if "LastEvaluatedKey" not in result:
            break

        kwargs["ExclusiveStartKey"] = result["LastEvaluatedKey"]

    return items


def filter_music(items, title="", artist="", album="", year=""):
    title_n = norm(title)
    artist_n = norm(artist)
    album_n = norm(album)
    year_s = str(year).strip() if year else ""

    output = []

    for item in items:
        if title_n and norm(item.get("title")) != title_n:
            continue
        if artist_n and norm(item.get("artist")) != artist_n:
            continue
        if album_n and norm(item.get("album")) != album_n:
            continue
        if year_s and str(item.get("year", "")).strip() != year_s:
            continue

        output.append(add_image_url(item))

    return output


@app.route("/", methods=["GET"])
@app.route("/health", methods=["GET"])
def health():
    return send({
        "success": True,
        "message": "healthy",
        "service": "music-backend-ec2",
        "region": AWS_REGION,
        "music_table": MUSIC_TABLE,
        "time": datetime.now(timezone.utc).isoformat(),
    })


@app.route("/login", methods=["POST"])
def login():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email"))
    password = str(data.get("password", "")).strip()

    if not email or not password:
        return send({"success": False, "message": "email or password is invalid"}, 400)

    try:
        result = login_table.get_item(Key={"email": email})
        user = result.get("Item")

        if not user or str(user.get("password", "")) != password:
            return send({"success": False, "message": "email or password is invalid"}, 401)

        return send({
            "success": True,
            "message": "Login successful",
            "user": {
                "email": user.get("email"),
                "user_name": user.get("user_name", user.get("username", "")),
            },
        })

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email"))
    user_name = str(data.get("user_name") or data.get("username") or "").strip()
    password = str(data.get("password", "")).strip()

    if not email or not user_name or not password:
        return send({"success": False, "message": "Email, username and password are required"}, 400)

    try:
        login_table.put_item(
            Item={
                "email": email,
                "user_name": user_name,
                "password": password,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            ConditionExpression="attribute_not_exists(email)",
        )

        return send({
            "success": True,
            "message": "Registration successful",
            "user": {
                "email": email,
                "user_name": user_name,
            },
        }, 201)

    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return send({"success": False, "message": "The email already exists"}, 409)

        return send({"success": False, "message": str(e)}, 500)


@app.route("/music", methods=["GET"])
@app.route("/getMusic", methods=["GET"])
def get_music():
    title = request.args.get("title", "")
    artist = request.args.get("artist", "")
    album = request.args.get("album", "")
    year = request.args.get("year", "")

    if not any([title.strip(), artist.strip(), album.strip(), year.strip()]):
        return send({"success": False, "message": "At least one field must be completed"}, 400)

    artist_value = str(artist).strip()
    album_value = str(album).strip()
    year_value = str(year).strip() if year else ""

    try:
        operation = "Scan"
        raw_items = []

        if artist_value and album_value:
            operation = "Query using LSI album-index"
            result = music_table.query(
                IndexName="album-index",
                KeyConditionExpression=Key("artist").eq(artist_value) & Key("album").eq(album_value),
            )
            raw_items = result.get("Items", [])

        elif year_value:
            operation = "Query using GSI YearArtistIndex"

            if artist_value:
                result = music_table.query(
                    IndexName="YearArtistIndex",
                    KeyConditionExpression=Key("year").eq(year_value) & Key("artist").eq(artist_value),
                )
            else:
                result = music_table.query(
                    IndexName="YearArtistIndex",
                    KeyConditionExpression=Key("year").eq(year_value),
                )

            raw_items = result.get("Items", [])

        elif artist_value:
            operation = "Query using main table artist key"
            result = music_table.query(
                KeyConditionExpression=Key("artist").eq(artist_value)
            )
            raw_items = result.get("Items", [])

        else:
            raw_items = scan_all_music()

        items = filter_music(raw_items, title=title, artist=artist, album=album, year=year)

        if not items:
            fallback_items = scan_all_music()
            items = filter_music(fallback_items, title=title, artist=artist, album=album, year=year)
            if items:
                operation = operation + " with Scan fallback"

        if not items:
            return send({
                "success": True,
                "message": "No result is retrieved. Please query again",
                "operation": operation,
                "count": 0,
                "items": [],
                "songs": [],
            })

        return send({
            "success": True,
            "message": "results retrieved",
            "operation": operation,
            "count": len(items),
            "items": items,
            "songs": items,
        })

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/subscriptions", methods=["GET"])
@app.route("/getSub", methods=["GET"])
@app.route("/getSubscriptions", methods=["GET"])
def get_subscriptions():
    email = norm(request.args.get("email", ""))

    if not email:
        return send({"success": False, "message": "email is required"}, 400)

    try:
        result = subscriptions_table.query(
            KeyConditionExpression=Key("email").eq(email)
        )

        items = [add_image_url(item) for item in result.get("Items", [])]

        return send({
            "success": True,
            "count": len(items),
            "items": items,
            "subscriptions": items,
        })

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/subscriptions", methods=["POST"])
@app.route("/createSub", methods=["POST"])
@app.route("/subscribe", methods=["POST"])
def create_subscription():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email"))
    song = data.get("song") if isinstance(data.get("song"), dict) else data

    title = song.get("title")
    artist = song.get("artist", "")
    album = song.get("album", "")
    year = str(song.get("year", "")).strip()
    song_id = song.get("song_id") or make_song_id(song)

    if not email or not title or not artist:
        return send({"success": False, "message": "email, title and artist are required"}, 400)

    item = {
        "email": email,
        "song_id": song_id,
        "title": title,
        "artist": artist,
        "album": album,
        "year": year,
        "title_year": song.get("title_year", f"{title}#{year}"),
        "artist_norm": norm(artist),
        "title_norm": norm(title),
        "album_norm": norm(album),
        "img_url": song.get("img_url", ""),
        "image_url": song.get("image_url", ""),
        "image_s3_key": song.get("image_s3_key", ""),
        "original_image_url": song.get("original_image_url", song.get("image_url", song.get("img_url", ""))),
        "subscribed_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        subscriptions_table.put_item(Item=item)

        return send({
            "success": True,
            "message": "Subscription added successfully",
            "item": add_image_url(item),
        }, 201)

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/subscriptions", methods=["DELETE"])
@app.route("/deleteSub", methods=["DELETE", "POST"])
@app.route("/removeSubscription", methods=["DELETE", "POST"])
def delete_subscription():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email") or request.args.get("email", ""))
    song_id = data.get("song_id") or request.args.get("song_id", "")
    title = data.get("title") or request.args.get("title", "")
    artist = data.get("artist") or request.args.get("artist", "")
    album = data.get("album") or request.args.get("album", "")
    year = data.get("year") or request.args.get("year", "")

    if not email:
        return send({"success": False, "message": "email is required"}, 400)

    try:
        if not song_id:
            temp_song = {
                "title": title,
                "artist": artist,
                "album": album,
                "year": year,
            }
            song_id = make_song_id(temp_song)

        subscriptions_table.delete_item(
            Key={
                "email": email,
                "song_id": song_id,
            }
        )

        return send({
            "success": True,
            "message": "Subscription deleted successfully",
        })

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
