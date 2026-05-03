from flask import Flask, request, jsonify
import boto3

app = Flask(__name__)

dynamodb = boto3.resource('dynamodb', region_name='us-east-1')

login_table = dynamodb.Table('login')
music_table = dynamodb.Table('music')
sub_table = dynamodb.Table('subscription')

# ---------------- INSERT DEFAULT USERS ----------------
def insert_default_users():
    users = [
        {"email": "s41395540@student.rmit.edu.au", "user_name": "DhanyaLaxminarayan0", "password": "012345"},
        {"email": "s41395541@student.rmit.edu.au", "user_name": "DhanyaLaxminarayan1", "password": "123456"},
        {"email": "s41395542@student.rmit.edu.au", "user_name": "DhanyaLaxminarayan2", "password": "234567"},
        {"email": "s41395543@student.rmit.edu.au", "user_name": "DhanyaLaxminarayan3", "password": "345678"},
        {"email": "s41395544@student.rmit.edu.au", "user_name": "DhanyaLaxminarayan4", "password": "456789"}
    ]

    for user in users:
        response = login_table.get_item(Key={"email": user["email"]})
        if "Item" not in response:
            login_table.put_item(Item=user)

# ---------------- LOGIN ----------------
@app.route('/login', methods=['POST'])
def login():
    data = request.json
    email = data.get('email')
    password = data.get('password')

    if not email or not password:
        return jsonify({"success": False, "message": "Email and password are required"}), 400

    response = login_table.get_item(Key={'email': email})

    if 'Item' in response and response['Item']['password'] == password:
        return jsonify({
            "success": True,
            "message": "Login successful",
            "user": {
                "email": email,
                "user_name": response['Item'].get('user_name', 'Unknown')
            }
        })

    return jsonify({"success": False, "message": "email or password is invalid"}), 401


# ---------------- REGISTER ----------------
@app.route('/register', methods=['POST'])
def register():
    data = request.json

    email = data.get('email')
    user_name = data.get('user_name')
    password = data.get('password')

    if not email or not user_name or not password:
        return jsonify({"success": False, "message": "Email, username, and password are required"}), 400

    response = login_table.get_item(Key={'email': email})

    if 'Item' in response:
        return jsonify({"success": False, "message": "The email already exists"}), 409

    login_table.put_item(Item={
        "email": email,
        "user_name": user_name,
        "password": password
    })

    return jsonify({
        "success": True,
        "message": "Registration successful",
        "user": {
            "email": email,
            "user_name": user_name
        }
    }), 201


# ---------------- MUSIC SEARCH ----------------
@app.route('/music', methods=['GET'])
def search_music():
    title = request.args.get('title')
    artist = request.args.get('artist')
    album = request.args.get('album')
    year = request.args.get('year')

    if not (title or artist or album or year):
        return jsonify({"success": False, "message": "At least one query parameter is required"}), 400

    response = music_table.scan()
    items = response.get('Items', [])

    results = []

    for item in items:
        if title and title.lower() not in item.get('title', '').lower():
            continue
        if artist and artist.lower() not in item.get('artist', '').lower():
            continue
        if album and album.lower() not in item.get('album', '').lower():
            continue
        if year and str(year) != str(item.get('year')):
            continue

        results.append(item)

    return jsonify({
        "success": True,
        "count": len(results),
        "songs": results,
        "message": "No result is retrieved. Please query again" if len(results) == 0 else ""
    })


# ---------------- SUBSCRIPTIONS ----------------
@app.route('/subscriptions', methods=['GET'])
def get_subscriptions():
    email = request.args.get('email')

    if not email:
        return jsonify({"success": False, "message": "Email parameter is required"}), 400

    response = sub_table.scan()
    subs = [item for item in response.get('Items', []) if item['email'] == email]

    return jsonify({
        "success": True,
        "count": len(subs),
        "subscriptions": subs
    })


@app.route('/subscriptions', methods=['POST'])
def add_sub():
    data = request.json
    email = data.get('email')
    song_id = data.get('song_id')

    if not email or not song_id:
        return jsonify({"success": False, "message": "Email and song_id are required"}), 400

    sub_table.put_item(Item={
        "email": email,
        "song_id": song_id
    })

    return jsonify({"success": True, "message": "Subscription added successfully"}), 201


@app.route('/subscriptions', methods=['DELETE'])
def delete_sub():
    data = request.json
    email = data.get('email')
    song_id = data.get('song_id')

    if not email or not song_id:
        return jsonify({"success": False, "message": "Email and song_id are required"}), 400

    sub_table.delete_item(Key={
        "email": email,
        "song_id": song_id
    })

    return jsonify({"success": True, "message": "Subscription removed successfully"})


# ---------------- MAIN ----------------
if __name__ == '__main__':
    insert_default_users()  #  THIS AUTO ADDS USERS
    app.run(host='0.0.0.0', port=5000, debug=True)