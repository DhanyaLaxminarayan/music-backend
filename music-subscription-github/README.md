# Music Subscription App - EC2 Backend

This repository contains the EC2 backend source code for the AWS music subscription application.

## Files

- `backend-ec2/app.py`
- `backend-ec2/setup_data.py`
- `backend-ec2/requirements.txt`
- `backend-ec2/Dockerfile`

## Backend URL used in deployment

```text
http://100.30.49.178
```

## Main API endpoints

| Method | Endpoint |
|---|---|
| GET | `/health` |
| POST | `/login` |
| POST | `/register` |
| GET | `/music` |
| GET | `/getMusic` |
| GET | `/subscriptions` |
| GET | `/getSub` |
| POST | `/subscriptions` |
| POST | `/createSub` |
| DELETE | `/subscriptions` |
| DELETE | `/deleteSub` |

## DynamoDB tables

- `login`
- `music`
- `subscriptions`

## DynamoDB indexes

- LSI: `year_title-index`
- GSI: `album_artist-index`

## Docker build

```bash
cd backend-ec2
docker build -t music-backend-final .
```

## Run setup

Put `2026a2_songs.json` inside `backend-ec2/` before running setup.

```bash
docker run --rm --network host   -e AWS_REGION=us-east-1   -e LOGIN_TABLE=login   -e MUSIC_TABLE=music   -e SUBSCRIPTIONS_TABLE=subscriptions   -e S3_BUCKET=music-a2-images-307302876893-final   -e RESET_TABLES=true   music-backend-final python setup_data.py
```

## Run backend on EC2 port 80

```bash
docker rm -f music-backend-final || true

docker run -d --name music-backend-final --restart unless-stopped -p 80:5000   -e AWS_REGION=us-east-1   -e LOGIN_TABLE=login   -e MUSIC_TABLE=music   -e SUBSCRIPTIONS_TABLE=subscriptions   -e S3_BUCKET=music-a2-images-307302876893-final   -e FRONTEND_ORIGIN="*"   music-backend-final
```

## Test

```bash
curl http://100.30.49.178/health
curl "http://100.30.49.178/getMusic?artist=Taylor%20Swift&album=Fearless"
```

## Security

Do not upload `.pem`, `.ppk`, AWS credentials, access keys, secret keys, or temporary tokens to GitHub.
