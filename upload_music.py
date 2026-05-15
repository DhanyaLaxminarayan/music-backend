import json
import boto3
import requests

# connect to AWS
dynamodb = boto3.resource('dynamodb', region_name='us-east-1')
music_table = dynamodb.Table('music')

s3 = boto3.client('s3')
bucket_name = "music-images-app-2026"

# read JSON file
with open("2026a2_songs.json") as f:
    data = json.load(f)

# handle both formats
songs = data["songs"] if isinstance(data, dict) else data

for song in songs:
    title = song.get("title")
    artist = song.get("artist")
    year = str(song.get("year"))
    album = song.get("album")

    # image field might be named differently
    image_url = song.get("img_url") or song.get("image_url")

    # simple file name
    filename = f"{artist}_{title}.jpg".replace(" ", "_")

    s3_url = ""

    if image_url:
        try:
            res = requests.get(image_url)
            with open(filename, "wb") as img:
                img.write(res.content)

            s3.upload_file(filename, bucket_name, filename)

            s3_url = f"https://{bucket_name}.s3.amazonaws.com/{filename}"

        except Exception as e:
            print(f"image issue for {title}: {e}")

    music_table.put_item(
        Item={
            "title": title,
            "title_year": f"{title}#{year}",
            "song_id": f"{title}#{year}",
            "artist": artist,
            "year": year,
            "album": album,
            "img_url": s3_url,
            "image_url": s3_url
        }
    )

print("done uploading songs and images")