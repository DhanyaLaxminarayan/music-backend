import json
import boto3

dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
table = dynamodb.Table("music")

with open("2026a2_songs.json", "r", encoding="utf-8") as f:
    data = json.load(f)

# 👇 FIX HERE
songs = data["songs"] if isinstance(data, dict) else data

for song in songs:
    artist = song.get("artist", "")
    title = song.get("title", "")
    year = str(song.get("year", ""))
    album = song.get("album", "")
    image_url = song.get("img_url", "")

    item = {
        "artist": artist,
        "title_year": f"{title}#{year}",
        "song_id": f"{artist}#{title}#{year}",
        "title": title,
        "year": year,
        "album": album,
        "img_url": image_url
    }

    table.put_item(Item=item)

print("All songs uploaded successfully")
