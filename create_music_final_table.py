import boto3

REGION = "us-east-1"
TABLE_NAME = "music-final"

client = boto3.client("dynamodb", region_name=REGION)

try:
    client.describe_table(TableName=TABLE_NAME)
    print(f"{TABLE_NAME} already exists.")
except client.exceptions.ResourceNotFoundException:
    client.create_table(
        TableName=TABLE_NAME,
        AttributeDefinitions=[
            {"AttributeName": "artist", "AttributeType": "S"},
            {"AttributeName": "song_id", "AttributeType": "S"},
            {"AttributeName": "album", "AttributeType": "S"},
            {"AttributeName": "year", "AttributeType": "S"},
        ],
        KeySchema=[
            {"AttributeName": "artist", "KeyType": "HASH"},
            {"AttributeName": "song_id", "KeyType": "RANGE"},
        ],
        LocalSecondaryIndexes=[
            {
                "IndexName": "album-index",
                "KeySchema": [
                    {"AttributeName": "artist", "KeyType": "HASH"},
                    {"AttributeName": "album", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        GlobalSecondaryIndexes=[
            {
                "IndexName": "YearArtistIndex",
                "KeySchema": [
                    {"AttributeName": "year", "KeyType": "HASH"},
                    {"AttributeName": "artist", "KeyType": "RANGE"},
                ],
                "Projection": {"ProjectionType": "ALL"},
            }
        ],
        BillingMode="PAY_PER_REQUEST",
    )
    waiter = client.get_waiter("table_exists")
    waiter.wait(TableName=TABLE_NAME)
    print(f"{TABLE_NAME} created with GSI YearArtistIndex and LSI album-index.")
