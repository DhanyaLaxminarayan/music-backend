import boto3
import hashlib

dynamodb = boto3.resource("dynamodb", region_name="us-east-1")

SOURCE_TABLE = "music"
TARGET_TABLE = "music-final"

source = dynamodb.Table(SOURCE_TABLE)
target = dynamodb.Table(TARGET_TABLE)


def norm(value):
    if value is None:
        return ""
    return str(value).strip()


def make_song_id(item, index):
    raw = "|".join([
        norm(item.get("artist")),
        norm(item.get("title")),
        norm(item.get("year")),
        norm(item.get("album")),
        str(index),
    ])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:24]


def scan_all(table):
    items = []
    kwargs = {}

    while True:
        response = table.scan(**kwargs)
        items.extend(response.get("Items", []))

        if "LastEvaluatedKey" not in response:
            break

        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]

    return items


items = scan_all(source)
print("Items found in music:", len(items))

inserted = 0

for index, item in enumerate(items):
    title = item.get("title") or item.get("Title")
    artist = item.get("artist") or item.get("Artist")
    album = item.get("album") or item.get("Album") or ""
    year = item.get("year") or item.get("Year")
    img_url = item.get("img_url") or item.get("image_url") or item.get("original_image_url") or ""
    image_s3_key = item.get("image_s3_key") or ""
    original_image_url = item.get("original_image_url") or img_url

    if not title or not artist or not year:
        print("Skipping item:", item)
        continue

    song_id = item.get("song_id") or make_song_id(item, index)

    new_item = {
        "artist": str(artist),
        "song_id": str(song_id),
        "title": str(title),
        "album": str(album),
        "year": str(year),
        "img_url": str(img_url),
        "image_url": str(img_url),
        "image_s3_key": str(image_s3_key),
        "original_image_url": str(original_image_url),
    }

    target.put_item(Item=new_item)
    inserted += 1

print("Inserted into music-final:", inserted)
