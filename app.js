const crypto = require("crypto");
const cors = require("cors");
const express = require("express");
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const {
  DynamoDBDocumentClient,
  DeleteCommand,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand
} = require("@aws-sdk/lib-dynamodb");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

const AWS_REGION = process.env.AWS_REGION || "us-east-1";
const LOGIN_TABLE = process.env.LOGIN_TABLE || "login";
const MUSIC_TABLE = process.env.MUSIC_TABLE || "music-final";
const SUBSCRIPTIONS_TABLE = process.env.SUBSCRIPTIONS_TABLE || "subscriptions";
const S3_BUCKET = process.env.S3_BUCKET || "music-a2-images-307302876893-final";
const PORT = Number(process.env.PORT || 5000);

const app = express();
// ECS uses the task role credentials to access DynamoDB and S3.
const dynamoClient = new DynamoDBClient({ region: AWS_REGION });
const dynamodb = DynamoDBDocumentClient.from(dynamoClient);
const s3 = new S3Client({ region: AWS_REGION });

app.use(cors());
app.use(express.json());

function norm(value) {
  return value == null ? "" : String(value).trim().toLowerCase();
}

function makeHash(value, length = 24) {
  return crypto.createHash("sha1").update(value, "utf8").digest("hex").slice(0, length);
}

function makeSubscriptionSongId(song) {
  if (song.title_year) {
    return String(song.title_year);
  }

  const raw = [
    norm(song.artist),
    norm(song.title),
    song.year == null ? "" : String(song.year).trim(),
    norm(song.album)
  ].join("|");

  return makeHash(raw);
}

async function sendCommand(command) {
  return dynamodb.send(command);
}

async function queryAll(input) {
  const items = [];
  let ExclusiveStartKey;

  do {
    const result = await sendCommand(new QueryCommand({ ...input, ExclusiveStartKey }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function scanAll(input) {
  const items = [];
  let ExclusiveStartKey;

  do {
    const result = await sendCommand(new ScanCommand({ ...input, ExclusiveStartKey }));
    items.push(...(result.Items || []));
    ExclusiveStartKey = result.LastEvaluatedKey;
  } while (ExclusiveStartKey);

  return items;
}

async function addImageUrl(item) {
  const output = { ...item };
  const key = output.image_s3_key || "";
  const fallback = output.original_image_url || output.image_url || output.img_url || "";

  // Artist images are stored privately in S3 and returned as short-lived signed URLs.
  if (key && S3_BUCKET) {
    try {
      output.image_url = await getSignedUrl(
        s3,
        new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
        { expiresIn: 3600 }
      );
    } catch {
      output.image_url = fallback;
    }
  } else {
    output.image_url = fallback;
  }

  output.img_url = output.image_url || "";
  return output;
}

async function addImageUrls(items) {
  return Promise.all(items.map(addImageUrl));
}

function filterMusic(items, { title = "", artist = "", album = "", year = "" }) {
  const titleNorm = norm(title);
  const artistNorm = norm(artist);
  const albumNorm = norm(album);
  const yearValue = year ? String(year).trim() : "";

  return items.filter((item) => {
    if (titleNorm && norm(item.title) !== titleNorm) return false;
    if (artistNorm && norm(item.artist) !== artistNorm) return false;
    if (albumNorm && norm(item.album) !== albumNorm) return false;
    if (yearValue && String(item.year || "").trim() !== yearValue) return false;
    return true;
  });
}

function yearCandidates(year) {
  const value = String(year || "").trim();

  if (!value) {
    return [];
  }

  const asNumber = Number(value);

  if (Number.isInteger(asNumber)) {
    return [asNumber, value];
  }

  return [value];
}

async function queryYearIndex(yearValue, artistValue = "") {
  let lastError;

  for (const candidate of yearCandidates(yearValue)) {
    try {
      const input = {
        TableName: MUSIC_TABLE,
        IndexName: "YearArtistIndex",
        KeyConditionExpression: "#yr = :year",
        ExpressionAttributeNames: {
          "#yr": "year"
        },
        ExpressionAttributeValues: {
          ":year": candidate
        }
      };

      if (artistValue) {
        input.KeyConditionExpression += " AND artist = :artist";
        input.ExpressionAttributeValues[":artist"] = artistValue;
      }

      return await queryAll({
        ...input
      });
    } catch (error) {
      lastError = error;

      if (error.name !== "ValidationException") {
        throw error;
      }
    }
  }

  throw lastError;
}

function success(res, payload, status = 200) {
  return res.status(status).json(payload);
}

function failure(res, message, status = 400) {
  return res.status(status).json({ success: false, message });
}

app.get("/", (req, res) => {
  return success(res, {
    success: true,
    message: "Music backend is running on ECS",
    service: "ecs"
  });
});

app.get("/health", (req, res) => {
  return success(res, {
    success: true,
    message: "healthy",
    service: "music-backend-ecs",
    region: AWS_REGION,
    time: new Date().toISOString()
  });
});

app.post("/login", async (req, res) => {
  const email = norm(req.body.email);
  const password = String(req.body.password || "").trim();

  if (!email || !password) {
    return failure(res, "email or password is invalid", 400);
  }

  try {
    const result = await sendCommand(
      new GetCommand({
        TableName: LOGIN_TABLE,
        Key: { email }
      })
    );

    const user = result.Item;

    if (!user || String(user.password || "") !== password) {
      return failure(res, "email or password is invalid", 401);
    }

    return success(res, {
      success: true,
      message: "Login successful",
      user: {
        email: user.email,
        user_name: user.user_name || user.username || ""
      }
    });
  } catch (error) {
    return failure(res, error.message, 500);
  }
});

app.post("/register", async (req, res) => {
  const email = norm(req.body.email);
  const userName = String(req.body.user_name || req.body.username || "").trim();
  const password = String(req.body.password || "").trim();

  if (!email || !userName || !password) {
    return failure(res, "Email, username and password are required", 400);
  }

  try {
    await sendCommand(
      new PutCommand({
        TableName: LOGIN_TABLE,
        Item: {
          email,
          user_name: userName,
          password,
          created_at: new Date().toISOString()
        },
        ConditionExpression: "attribute_not_exists(email)"
      })
    );

    return success(
      res,
      {
        success: true,
        message: "Registration successful",
        user: { email, user_name: userName }
      },
      201
    );
  } catch (error) {
    if (error.name === "ConditionalCheckFailedException") {
      return success(res, { success: false, message: "The email already exists" }, 409);
    }

    return failure(res, error.message, 500);
  }
});

app.get(["/music", "/getMusic"], async (req, res) => {
  const { title = "", artist = "", album = "", year = "" } = req.query;

  if (!String(title).trim() && !String(artist).trim() && !String(album).trim() && !String(year).trim()) {
    return failure(res, "At least one field must be completed", 400);
  }

  const artistValue = String(artist || "").trim();
  const albumValue = String(album || "").trim();
  const yearValue = year ? String(year).trim() : "";
  let operation = "Scan";

  try {
    let rawItems;

    if (artistValue && albumValue) {
      // LSI supports the common artist + album search pattern.
      operation = "Query using LSI";
      rawItems = await queryAll({
        TableName: MUSIC_TABLE,
        IndexName: "album-index",
        KeyConditionExpression: "artist = :artist AND album = :album",
        ExpressionAttributeValues: {
          ":artist": artistValue,
          ":album": albumValue
        }
      });
    } else if (yearValue) {
      // GSI supports year and artist + year searches such as Jimmy Buffett in 1974.
      operation = "Query using GSI";
      rawItems = await queryYearIndex(yearValue, artistValue);
    } else if (artistValue) {
      // Main table key supports artist-only searches.
      operation = "Query using main key";
      rawItems = await queryAll({
        TableName: MUSIC_TABLE,
        KeyConditionExpression: "artist = :artist",
        ExpressionAttributeValues: {
          ":artist": artistValue
        }
      });
    } else {
      rawItems = await scanAll({ TableName: MUSIC_TABLE });
    }

    const filteredItems = filterMusic(rawItems, { title, artist, album, year });
    const songs = await addImageUrls(filteredItems);

    if (songs.length === 0) {
      return success(res, {
        success: true,
        message: "No result is retrieved. Please query again",
        operation,
        count: 0,
        items: [],
        songs: []
      });
    }

    return success(res, {
      success: true,
      message: "results retrieved",
      operation,
      count: songs.length,
      items: songs,
      songs
    });
  } catch (error) {
    return failure(res, error.message, 500);
  }
});

app.get(["/subscriptions", "/getSubscriptions", "/getSub"], async (req, res) => {
  const email = norm(req.query.email);

  if (!email) {
    return failure(res, "email is required", 400);
  }

  try {
    const items = await queryAll({
      TableName: SUBSCRIPTIONS_TABLE,
      KeyConditionExpression: "email = :email",
      ExpressionAttributeValues: {
        ":email": email
      }
    });

    const subscriptions = await addImageUrls(items);

    return success(res, {
      success: true,
      count: subscriptions.length,
      items: subscriptions,
      subscriptions
    });
  } catch (error) {
    return failure(res, error.message, 500);
  }
});

app.post(["/subscriptions", "/subscribe", "/createSub"], async (req, res) => {
  const email = norm(req.body.email);
  const song = req.body.song && typeof req.body.song === "object" ? req.body.song : req.body;
  const title = song.title;
  const artist = song.artist;
  const year = song.year == null ? "" : String(song.year).trim();
  const album = song.album || "";
  const songId = song.song_id || makeSubscriptionSongId(song);

  if (!email || !title || !artist) {
    return failure(res, "email, title and artist are required", 400);
  }

  const item = {
    // subscriptions table key: email + song_id
    email,
    song_id: songId,
    title,
    artist,
    year,
    album,
    title_year: song.title_year || `${title}#${year}`,
    artist_norm: norm(artist),
    title_norm: norm(title),
    album_norm: norm(album),
    image_s3_key: song.image_s3_key || "",
    original_image_url: song.original_image_url || song.image_url || song.img_url || "",
    subscribed_at: new Date().toISOString()
  };

  try {
    await sendCommand(
      new PutCommand({
        TableName: SUBSCRIPTIONS_TABLE,
        Item: item
      })
    );

    return success(
      res,
      {
        success: true,
        message: "Subscription added successfully",
        item: await addImageUrl(item)
      },
      201
    );
  } catch (error) {
    return failure(res, error.message, 500);
  }
});

async function findSubscriptionSongId(email, body) {
  if (body.song_id) {
    return body.song_id;
  }

  if (body.title && body.artist) {
    return makeSubscriptionSongId(body);
  }

  if (!body.title) {
    return "";
  }

  const items = await queryAll({
    TableName: SUBSCRIPTIONS_TABLE,
    KeyConditionExpression: "email = :email",
    ExpressionAttributeValues: {
      ":email": email
    }
  });

  const match = items.find((item) => norm(item.title) === norm(body.title));
  return match ? match.song_id : "";
}

app.delete(["/subscriptions", "/removeSubscription", "/deleteSub"], async (req, res) => {
  const email = norm(req.body.email || req.query.email);

  if (!email) {
    return failure(res, "email is required", 400);
  }

  try {
    const songId = await findSubscriptionSongId(email, { ...req.query, ...req.body });

    if (!songId) {
      return failure(res, "email and song_id or song details are required", 400);
    }

    await sendCommand(
      new DeleteCommand({
        TableName: SUBSCRIPTIONS_TABLE,
        Key: {
          email,
          song_id: songId
        }
      })
    );

    return success(res, {
      success: true,
      message: "Subscription deleted successfully"
    });
  } catch (error) {
    return failure(res, error.message, 500);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
