import os
import decimal
import hashlib
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key
from flask import Flask, jsonify, request
from flask_cors import CORS


AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LOGIN_TABLE = os.getenv("LOGIN_TABLE", "login")
MUSIC_TABLE = os.getenv("MUSIC_TABLE", "music")
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


def make_hash(value, length=24):
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:length]


def make_subscription_song_id(song):
    raw = "|".join(
        [
            norm(song.get("artist")),
            norm(song.get("title")),
            str(song.get("year", "")).strip(),
            norm(song.get("album")),
        ]
    )
    return make_hash(raw)


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


def add_image_url(item):
    item = dict(item)
    key = item.get("image_s3_key", "")
    fallback = item.get("original_image_url", "") or item.get("image_url", "")

    if key and S3_BUCKET:
        try:
            item["image_url"] = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": S3_BUCKET, "Key": key},
                ExpiresIn=3600,
            )
        except Exception:
            item["image_url"] = fallback
    else:
        item["image_url"] = fallback

    item["img_url"] = item.get("image_url", "")
    return item


def filter_and(items, title="", artist="", year="", album=""):
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


@app.route("/", methods=["GET"])
def home():
    return send(
        {
            "success": True,
            "message": "Music backend is running on EC2 port 80",
            "service": "ec2",
        }
    )


@app.route("/health", methods=["GET"])
def health():
    return send(
        {
            "success": True,
            "message": "healthy",
            "service": "music-backend-ec2",
            "region": AWS_REGION,
            "time": datetime.now(timezone.utc).isoformat(),
        }
    )


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

        return send(
            {
                "success": True,
                "message": "login successful",
                "user": {
                    "email": user.get("email"),
                    "user_name": user.get("user_name", user.get("username", "")),
                },
            }
        )

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/register", methods=["POST"])
def register():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email"))
    user_name = str(data.get("user_name") or data.get("username") or "").strip()
    password = str(data.get("password", "")).strip()

    if not email or not user_name or not password:
        return send({"success": False, "message": "email, username and password are required"}, 400)

    try:
        existing = login_table.get_item(Key={"email": email})

        if "Item" in existing:
            return send({"success": False, "message": "The email already exists"}, 409)

        login_table.put_item(
            Item={
                "email": email,
                "user_name": user_name,
                "password": password,
                "created_at": datetime.now(timezone.utc).isoformat(),
            },
            ConditionExpression="attribute_not_exists(email)",
        )

        return send({"success": True, "message": "registration successful"})

    except ClientError as e:
        if e.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            return send({"success": False, "message": "The email already exists"}, 409)

        return send({"success": False, "message": str(e)}, 500)


@app.route("/music", methods=["GET"])
@app.route("/getMusic", methods=["GET"])
def get_music():
    title = request.args.get("title", "")
    artist = request.args.get("artist", "")
    year = request.args.get("year", "")
    album = request.args.get("album", "")

    if not any([title.strip(), artist.strip(), year.strip(), album.strip()]):
        return send({"success": False, "message": "At least one field must be completed"}, 400)

    artist_n = norm(artist)
    album_n = norm(album)
    year_s = str(year).strip() if year else ""

    try:
        raw_items = []
        operation = "Scan"

        if artist_n and year_s:
            operation = "Query using LSI"
            result = music_table.query(
                IndexName="year_title-index",
                KeyConditionExpression=Key("artist_norm").eq(artist_n)
                & Key("year_title").begins_with(f"{year_s}#"),
            )
            raw_items = result.get("Items", [])

        elif album_n:
            operation = "Query using GSI"
            result = music_table.query(
                IndexName="album_artist-index",
                KeyConditionExpression=Key("album_norm").eq(album_n),
            )
            raw_items = result.get("Items", [])

        elif artist_n:
            operation = "Query using main key"
            result = music_table.query(
                KeyConditionExpression=Key("artist_norm").eq(artist_n)
            )
            raw_items = result.get("Items", [])

        else:
            raw_items = scan_all_music()

        items = filter_and(raw_items, title=title, artist=artist, year=year, album=album)

        if not items:
            return send(
                {
                    "success": True,
                    "message": "No result is retrieved. Please query again",
                    "operation": operation,
                    "items": [],
                    "songs": [],
                }
            )

        return send(
            {
                "success": True,
                "message": "results retrieved",
                "operation": operation,
                "count": len(items),
                "items": items,
                "songs": items,
            }
        )

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/subscriptions", methods=["GET"])
@app.route("/getSubscriptions", methods=["GET"])
@app.route("/getSub", methods=["GET"])
def get_subscriptions():
    email = norm(request.args.get("email", ""))

    if not email:
        return send({"success": False, "message": "email is required"}, 400)

    try:
        result = subscriptions_table.query(
            KeyConditionExpression=Key("email").eq(email)
        )

        items = [add_image_url(item) for item in result.get("Items", [])]

        return send({"success": True, "count": len(items), "items": items, "subscriptions": items})

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/subscriptions", methods=["POST"])
@app.route("/subscribe", methods=["POST"])
@app.route("/createSub", methods=["POST"])
def add_subscription():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email"))
    song = data.get("song") if isinstance(data.get("song"), dict) else data

    title = song.get("title")
    artist = song.get("artist")
    year = str(song.get("year", "")).strip()
    album = song.get("album", "")
    song_id = song.get("song_id") or make_subscription_song_id(song)

    if not email or not title or not artist:
        return send({"success": False, "message": "email, title and artist are required"}, 400)

    try:
        item = {
            "email": email,
            "song_id": song_id,
            "title": title,
            "artist": artist,
            "year": year,
            "album": album,
            "artist_norm": norm(artist),
            "title_norm": norm(title),
            "album_norm": norm(album),
            "image_s3_key": song.get("image_s3_key", ""),
            "original_image_url": song.get("original_image_url", song.get("image_url", song.get("img_url", ""))),
            "subscribed_at": datetime.now(timezone.utc).isoformat(),
        }

        subscriptions_table.put_item(Item=item)

        return send({"success": True, "message": "subscription added", "item": add_image_url(item)})

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/subscriptions", methods=["DELETE"])
@app.route("/removeSubscription", methods=["DELETE", "POST"])
def remove_subscription():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email") or request.args.get("email", ""))
    song_id = data.get("song_id") or request.args.get("song_id", "")

    if not song_id:
        title = data.get("title") or request.args.get("title", "")
        artist = data.get("artist") or request.args.get("artist", "")
        year = data.get("year") or request.args.get("year", "")
        album = data.get("album") or request.args.get("album", "")
        song_id = make_subscription_song_id(
            {"title": title, "artist": artist, "year": year, "album": album}
        )

    if not email or not song_id:
        return send({"success": False, "message": "email and song_id are required"}, 400)

    try:
        subscriptions_table.delete_item(
            Key={
                "email": email,
                "song_id": song_id,
            }
        )

        return send({"success": True, "message": "subscription removed"})

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


@app.route("/deleteSub", methods=["DELETE", "POST"])
def delete_sub_legacy():
    data = request.get_json(silent=True) or {}

    email = norm(data.get("email") or request.args.get("email", ""))
    title = data.get("title") or request.args.get("title", "")
    artist = data.get("artist") or request.args.get("artist", "")
    year = data.get("year") or request.args.get("year", "")
    album = data.get("album") or request.args.get("album", "")
    song_id = data.get("song_id") or request.args.get("song_id", "")

    if not email:
        return send({"success": False, "message": "email is required"}, 400)

    try:
        if song_id:
            subscriptions_table.delete_item(
                Key={
                    "email": email,
                    "song_id": song_id,
                }
            )
            return send({"success": True, "message": "subscription removed"})

        result = subscriptions_table.query(
            KeyConditionExpression=Key("email").eq(email)
        )

        items = result.get("Items", [])

        for item in items:
            title_match = title and norm(item.get("title")) == norm(title)
            artist_match = (not artist) or norm(item.get("artist")) == norm(artist)
            year_match = (not year) or str(item.get("year", "")).strip() == str(year).strip()
            album_match = (not album) or norm(item.get("album")) == norm(album)

            if title_match and artist_match and year_match and album_match:
                subscriptions_table.delete_item(
                    Key={
                        "email": email,
                        "song_id": item["song_id"],
                    }
                )
                return send({"success": True, "message": "subscription removed"})

        return send({"success": True, "message": "subscription removed"})

    except ClientError as e:
        return send({"success": False, "message": str(e)}, 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
