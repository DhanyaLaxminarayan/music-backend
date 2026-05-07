import hashlib
import json
import mimetypes
import os
import re
import time
from pathlib import Path
from urllib.parse import urlparse

import boto3
import requests
from botocore.exceptions import ClientError


AWS_REGION = os.getenv("AWS_REGION", "us-east-1")
LOGIN_TABLE = os.getenv("LOGIN_TABLE", "login")
MUSIC_TABLE = os.getenv("MUSIC_TABLE", "music")
SUBSCRIPTIONS_TABLE = os.getenv("SUBSCRIPTIONS_TABLE", "subscriptions")
S3_BUCKET = os.getenv("S3_BUCKET", "music-a2-images-307302876893-final")
RESET_TABLES = os.getenv("RESET_TABLES", "false").lower() == "true"

dynamodb = boto3.resource("dynamodb", region_name=AWS_REGION)
client = boto3.client("dynamodb", region_name=AWS_REGION)
s3 = boto3.client("s3", region_name=AWS_REGION)

LOGIN_USERS = [
    {"email": "user1@student.rmit.edu.au", "user_name": "user1", "password": "password1"},
    {"email": "user2@student.rmit.edu.au", "user_name": "user2", "password": "password2"},
    {"email": "user3@student.rmit.edu.au", "user_name": "user3", "password": "password3"},
    {"email": "user4@student.rmit.edu.au", "user_name": "user4", "password": "password4"},
    {"email": "user5@student.rmit.edu.au", "user_name": "user5", "password": "password5"},
    {"email": "user6@student.rmit.edu.au", "user_name": "user6", "password": "password6"},
    {"email": "user7@student.rmit.edu.au", "user_name": "user7", "password": "password7"},
    {"email": "user8@student.rmit.edu.au", "user_name": "user8", "password": "password8"},
    {"email": "user9@student.rmit.edu.au", "user_name": "user9", "password": "password9"},
    {"email": "user10@student.rmit.edu.au", "user_name": "user10", "password": "password10"},
]

FALLBACK_SONGS = [
    {"title": "Migration", "artist": "Jimmy Buffett", "year": "1974", "album": "A1A", "image_url": ""},
    {"title": "Tin Cup Chalice", "artist": "Jimmy Buffett", "year": "1974", "album": "A1A", "image_url": ""},
    {"title": "Trying to Reason with Hurricane Season", "artist": "Jimmy Buffett", "year": "1974", "album": "A1A", "image_url": ""},
    {"title": "Fearless", "artist": "Taylor Swift", "year": "2008", "album": "Fearless", "image_url": ""},
]


def norm(value):
    if value is None:
        return ""
    return str(value).strip().lower()


def safe_name(value):
    value = norm(value)
    value = re.sub(r"[^a-z0-9]+", "-", value).strip("-")
    return value or "unknown"


def make_hash(value, length=24):
    return hashlib.sha1(value.encode("utf-8")).hexdigest()[:length]


def make_song_id(song, index):
    raw = "|".join(
        [
            norm(song.get("artist")),
            norm(song.get("title")),
            str(song.get("year", "")).strip(),
            norm(song.get("album")),
            str(index),
        ]
    )
    return make_hash(raw)


def table_exists(name):
    try:
        client.describe_table(TableName=name)
        return True
    except client.exceptions.ResourceNotFoundException:
        return False


def wait_table_exists(name):
    waiter = client.get_waiter("table_exists")
    waiter.wait(TableName=name)


def wait_table_not_exists(name):
    waiter = client.get_waiter("table_not_exists")
    waiter.wait(TableName=name)


def delete_table_if_exists(name):
    if table_exists(name):
        client.delete_table(TableName=name)
        wait_table_not_exists(name)


def create_login_table():
    if table_exists(LOGIN_TABLE):
        return

    table = dynamodb.create_table(
        TableName=LOGIN_TABLE,
        KeySchema=[
            {"AttributeName": "email", "KeyType": "HASH"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "email", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )

    wait_table_exists(LOGIN_TABLE)
    return table


def create_music_table():
    if table_exists(MUSIC_TABLE):
        return

    table = dynamodb.create_table(
        TableName=MUSIC_TABLE,
        KeySchema=[
            {"AttributeName": "artist_norm", "KeyType": "HASH"},
            {"AttributeName": "song_id", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "artist_norm", "AttributeType": "S"},
            {"AttributeName": "song_id", "AttributeType": "S"},
            {"AttributeName": "year_title", "AttributeType": "S"},
            {"AttributeName": "album_norm", "AttributeType": "S"},
            {"AttributeName": "artist_year_title", "AttributeType": "S"},
        ],
        LocalSecondaryIndexes=[
            {
                "IndexName": "year_title-index",
                "KeySchema": [
                    {"AttributeName": "artist_norm", "KeyType": "HASH"},
                    {"AttributeName": "year_title", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "album_artist-index",
                "KeySchema": [
                    {"AttributeName": "album_norm", "KeyType": "HASH"},
                    {"AttributeName": "artist_year_title", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        BillingMode="PAY_PER_REQUEST",
    )

    wait_table_exists(MUSIC_TABLE)
    return table


def create_subscriptions_table():
    if table_exists(SUBSCRIPTIONS_TABLE):
        return

    table = dynamodb.create_table(
        TableName=SUBSCRIPTIONS_TABLE,
        KeySchema=[
            {"AttributeName": "email", "KeyType": "HASH"},
            {"AttributeName": "song_id", "KeyType": "RANGE"},
        ],
        AttributeDefinitions=[
            {"AttributeName": "email", "AttributeType": "S"},
            {"AttributeName": "song_id", "AttributeType": "S"},
        ],
        BillingMode="PAY_PER_REQUEST",
    )

    wait_table_exists(SUBSCRIPTIONS_TABLE)
    return table


def create_bucket():
    try:
        s3.head_bucket(Bucket=S3_BUCKET)
        return
    except ClientError:
        pass

    if AWS_REGION == "us-east-1":
        s3.create_bucket(Bucket=S3_BUCKET)
    else:
        s3.create_bucket(
            Bucket=S3_BUCKET,
            CreateBucketConfiguration={"LocationConstraint": AWS_REGION},
        )

    s3.put_public_access_block(
        Bucket=S3_BUCKET,
        PublicAccessBlockConfiguration={
            "BlockPublicAcls": True,
            "IgnorePublicAcls": True,
            "BlockPublicPolicy": True,
            "RestrictPublicBuckets": True,
        },
    )


def get_field(song, names, default=""):
    for name in names:
        if name in song and song[name] is not None:
            return song[name]
    return default


def load_songs():
    path = Path("2026a2_songs.json")

    if not path.exists():
        return FALLBACK_SONGS

    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, list):
        raw_songs = data
    elif isinstance(data, dict):
        raw_songs = data.get("songs") or data.get("Items") or data.get("music") or []
    else:
        raw_songs = []

    songs = []

    for item in raw_songs:
        if not isinstance(item, dict):
            continue

        songs.append(
            {
                "title": str(get_field(item, ["title", "Title"], "")).strip(),
                "artist": str(get_field(item, ["artist", "Artist"], "")).strip(),
                "year": str(get_field(item, ["year", "Year"], "")).strip(),
                "album": str(get_field(item, ["album", "Album"], "")).strip(),
                "image_url": str(get_field(item, ["image_url", "img_url", "image", "Image_URL"], "")).strip(),
            }
        )

    return songs


def upload_image(artist, image_url):
    if not image_url:
        return ""

    try:
        parsed = urlparse(image_url)
        ext = Path(parsed.path).suffix.lower()

        if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
            ext = ".jpg"

        key = f"artist-images/{safe_name(artist)}-{make_hash(image_url, 12)}{ext}"

        try:
            s3.head_object(Bucket=S3_BUCKET, Key=key)
            return key
        except ClientError:
            pass

        result = requests.get(image_url, timeout=20, headers={"User-Agent": "Mozilla/5.0"})
        result.raise_for_status()

        content_type = result.headers.get("Content-Type") or mimetypes.guess_type(key)[0] or "image/jpeg"

        s3.put_object(
            Bucket=S3_BUCKET,
            Key=key,
            Body=result.content,
            ContentType=content_type,
        )

        return key

    except Exception:
        return ""


def seed_login_table():
    table = dynamodb.Table(LOGIN_TABLE)

    for user in LOGIN_USERS:
        table.put_item(
            Item={
                "email": norm(user["email"]),
                "user_name": user["user_name"],
                "password": str(user["password"]),
            }
        )


def seed_music_table():
    table = dynamodb.Table(MUSIC_TABLE)
    songs = load_songs()
    seen = set()

    for index, song in enumerate(songs):
        title = song.get("title", "").strip()
        artist = song.get("artist", "").strip()
        year = str(song.get("year", "")).strip()
        album = song.get("album", "").strip()
        image_url = song.get("image_url", "").strip()

        if not title or not artist:
            continue

        song_id = make_song_id(song, index)

        while song_id in seen:
            song_id = make_hash(song_id + str(time.time()))

        seen.add(song_id)

        artist_norm = norm(artist)
        title_norm = norm(title)
        album_norm = norm(album)
        image_s3_key = upload_image(artist, image_url)

        item = {
            "artist_norm": artist_norm,
            "song_id": song_id,
            "title": title,
            "title_norm": title_norm,
            "artist": artist,
            "year": year,
            "album": album,
            "album_norm": album_norm,
            "year_title": f"{year}#{title_norm}#{song_id}",
            "artist_year_title": f"{artist_norm}#{year}#{title_norm}#{song_id}",
            "original_image_url": image_url,
            "image_s3_key": image_s3_key,
        }

        table.put_item(Item=item)


def main():
    print("Starting setup")
    print(f"Region: {AWS_REGION}")
    print(f"S3 bucket: {S3_BUCKET}")

    if RESET_TABLES:
        delete_table_if_exists(SUBSCRIPTIONS_TABLE)
        delete_table_if_exists(MUSIC_TABLE)
        delete_table_if_exists(LOGIN_TABLE)

    create_bucket()
    create_login_table()
    create_music_table()
    create_subscriptions_table()
    seed_login_table()
    seed_music_table()

    print("Setup complete")


if __name__ == "__main__":
    main()
