# Lambda Backend Report Notes

---

## 1. Files Reviewed

| File | Purpose |
|---|---|
| `Backend-lambda/src/handler.js` | Lambda entry point for API Gateway proxy requests. Parses `httpMethod`, `path`, JSON body, and query parameters, then routes requests to feature handlers. |
| `Backend-lambda/src/routes/auth.js` | Implements login and register logic. Uses DynamoDB `login` table through `getItem` and `putItem`. |
| `Backend-lambda/src/routes/music.js` | Implements music search for `title`, `artist`, `album`, and `year`. Uses a mix of DynamoDB `Query` and `Scan`. |
| `Backend-lambda/src/routes/subscriptions.js` | Implements add, remove, and list subscription features. Uses DynamoDB `subscriptions` table and reads song details from `music`. |
| `Backend-lambda/src/services/dynamo.js` | Shared DynamoDB access layer using AWS SDK v3 commands: `GetCommand`, `PutCommand`, `QueryCommand`, `ScanCommand`, and `DeleteCommand`. |
| `Backend-lambda/src/utils/response.js` | Builds API Gateway-compatible JSON responses and CORS headers. |
| `Backend-lambda/openapi.yaml` | OpenAPI documentation for the Lambda API. Some documented status codes do not match the actual implementation. |
| `Backend-lambda/scripts/create-infrastructure.js` | Creates DynamoDB tables and S3 bucket. Defines table key schemas, LSI, and GSI. |
| `Backend-lambda/scripts/seed-music-data.js` | Reads `2026a2_songs.json`, transforms songs, generates `song_id`, builds S3 image URLs, and batch writes music items to DynamoDB. |
| `Backend-lambda/scripts/upload-images-to-s3.js` | Downloads artist images from source URLs and uploads them to S3 under `artist-images/`. |
| `Backend-lambda/scripts/seed-login-data.js` | Seeds one test user into the `login` table. |
| `Backend-lambda/scripts/seed-music.js` | Thin wrapper that imports and runs `seed-music-data.js`. |
| `Backend-lambda/package.json` | Node.js package metadata, dependencies, local testing, seeding, packaging, and Lambda code update script. |
| `Backend-lambda/src/local.js` | Local test runner that simulates API Gateway events. |
| `Backend-lambda/2026a2_songs.json` | Source music dataset with title, artist, year, album, and original image URL. |

---

## 2. Backend-Lambda Overview

The `Backend-lambda` implementation is a Node.js AWS Lambda backend intended to run behind API Gateway using Lambda Proxy Integration. API Gateway sends each HTTP request to the Lambda function as an event object. The event contains values such as `httpMethod`, `path`, `body`, and `queryStringParameters`.

The main Lambda entry point is `src/handler.js`. It first handles CORS preflight requests when `event.httpMethod === 'OPTIONS'`. For normal requests, it parses the request path using `parseRoute()`, which removes leading and trailing slashes and uses only the first path segment as the route resource. For example, `/login` becomes `login`, and `/subscriptions` becomes `subscriptions`. If a request body exists, the handler attempts to parse it as JSON. Invalid JSON returns a `400` error response.

Routing is implemented with a `switch` statement in `handler.js`. The Lambda routes `POST /login` and `POST /register` to authentication handlers, `GET /music` to the music search handler, and `GET`, `POST`, and `DELETE /subscriptions` to subscription handlers. Unsupported paths return `404`, and unsupported HTTP methods return `405`.

DynamoDB is the main data store. The Lambda code uses three tables: `login`, `music`, and `subscriptions`. The shared service file `src/services/dynamo.js` wraps DynamoDB operations such as get, put, query, scan, and delete. S3 is used for artist images, but the Lambda request handler does not directly call S3. Instead, image files are uploaded to S3 by a script, and generated S3 URLs are stored in DynamoDB as `image_url`. Lambda returns those URLs to the frontend.

Not found: there is no API Gateway creation/deployment script in the repository. `package.json` only updates Lambda function code with `aws lambda update-function-code`. The OpenAPI file documents routes, but no code was found that creates API Gateway resources, methods, integrations, deployment stages, or Lambda invoke permissions.

---

## 3. API Routes and HTTP Methods

### Actual Implementation

| Route | Method | Handler | Description |
|---|---|---|---|
| `/login` | `POST` | `handleLogin` | Authenticates a user using JSON body `{ "email": "...", "password": "..." }`. Returns `success`, `message`, and user info on success. |
| `/register` | `POST` | `handleRegister` | Registers a user using JSON body `{ "email": "...", "user_name": "...", "password": "..." }`. Uses conditional write to reject duplicate email. |
| `/music` | `GET` | `handleMusicSearch` | Searches music using query parameters `title`, `artist`, `album`, and/or `year`. Returns `success`, `count`, and `songs`. |
| `/subscriptions` | `GET` | `handleGetSubscriptions` | Lists subscriptions for a user using query parameter `email`. Returns subscribed songs with music details. |
| `/subscriptions` | `POST` | `handleAddSubscription` | Adds a subscription using JSON body `{ "email": "...", "song_id": "..." }`. |
| `/subscriptions` | `DELETE` | `handleRemoveSubscription` | Removes a subscription using JSON body `{ "email": "...", "song_id": "..." }`. |
| Any route | `OPTIONS` | `corsPreflightResponse` | Returns CORS preflight headers. |

### RESTful 評估

- The Lambda backend uses `GET`, `POST`, and `DELETE`, so it is not implemented as one generic `POST` endpoint.
- `GET /music` is RESTful for querying/searching music.
- `GET /subscriptions`, `POST /subscriptions`, and `DELETE /subscriptions` separate read, create, and delete actions by HTTP method.
- `POST /login` and `POST /register` are acceptable for authentication/account creation workflows.
- The main RESTful weakness is `DELETE /subscriptions`, because it expects `email` and `song_id` in the JSON body. A more RESTful design would use a URL such as `DELETE /users/{email}/subscriptions/{song_id}` or query parameters.
- The current router only uses the first path segment. It cannot currently support nested RESTful paths such as `/users/{email}/subscriptions/{song_id}` without changing `parseRoute()` and the routing logic.

---

## 4. DynamoDB Integration

The Lambda backend uses AWS SDK v3. `src/services/dynamo.js` creates a `DynamoDBClient` using `process.env.AWS_REGION || 'us-east-1'` and exposes helper functions for DynamoDB operations.

### Tables Used

| Table | Environment Variable | Fallback Name | Purpose |
|---|---|---|---|
| `login` | `LOGIN_TABLE` | `login` | Stores user accounts for login and register. |
| `music` | `MUSIC_TABLE` | `music` | Stores song records, metadata, generated `song_id`, and `image_url`. |
| `subscriptions` | `SUBSCRIPTIONS_TABLE` | `subscriptions` | Stores user-song subscription relationships. |

### Key Schema and Indexes

Defined in `Backend-lambda/scripts/create-infrastructure.js`:

| Table / Index | Key Schema |
|---|---|
| `login` table | Partition key: `email` |
| `music` table | Partition key: `artist`, sort key: `song_id` |
| `music` LSI `album-index` | Partition key: `artist`, sort key: `album` |
| `music` GSI `year-artist-index` | Partition key: `year`, sort key: `artist` |
| `subscriptions` table | Partition key: `email`, sort key: `song_id` |

### Query vs Scan Usage

| Feature | DynamoDB Operation | Efficient? | Notes |
|---|---|---:|---|
| Login | `GetCommand` | Yes | Direct key lookup by `email`. |
| Register | `PutCommand` with `ConditionExpression` | Yes | Prevents overwriting an existing email. |
| Music search by `artist` | `QueryCommand` on base table | Yes | Uses `artist` partition key. |
| Music search by `artist + album` | `QueryCommand` with `album-index` | Yes | Uses LSI and `begins_with(album, :album)`. |
| Music search by `year + artist` | `QueryCommand` with `year-artist-index` | Yes | Uses GSI. |
| Music search by title only | `ScanCommand` through `scanAllItems()` | No | Scans full music table, then filters in Lambda. |
| Music search by album only | `ScanCommand` through `scanAllItems()` | No | Cannot use `album-index` without artist because LSI has same partition key as table. |
| Music search by year only | `ScanCommand` through `scanAllItems()` | Partially inefficient | A GSI exists with `year` as partition key, but current code only uses it when both `year` and `artist` are provided. |
| Get subscriptions by email | `QueryCommand` | Yes | Uses `email` partition key in `subscriptions`. |
| Get song details for each subscription | `ScanCommand` through `getSongBySongId()` | No | Scans `music` by `song_id` because there is no `song_id` GSI. |
| Add subscription | `PutCommand` with condition | Mostly yes | Prevents duplicate subscription for the same `email + song_id`. Does not verify song exists. |
| Remove subscription | `DeleteCommand` | Yes for delete access pattern | Does not check whether item existed before returning success. |

### AND Logic for Music Query

The music query supports `title`, `artist`, `album`, and `year`. After retrieving candidate songs using either `Query` or `Scan`, the code applies JavaScript filtering:

```js
return matchesTitle && matchesArtist && matchesAlbum && matchesYear;
```

Therefore, multiple provided query conditions are combined with AND logic. A song must satisfy all supplied query parameters to be returned.

### Assignment Requirement Evaluation

- The backend does use DynamoDB key schema, LSI, and GSI.
- It correctly uses `Query` for several key-supported access patterns.
- It still uses `Scan` for title-only, album-only, year-only, and subscription song detail lookup.
- This partially satisfies the requirement to use efficient queries, but may lose marks because not all important access patterns are supported by indexes.
- Register uses conditional write, so it avoids overwriting existing users.
- Add subscription uses conditional write, so it avoids duplicate subscription records.
- Music seeding uses `BatchWriteCommand`, which can overwrite existing music items with the same key because batch write put requests do not include a condition.

---

## 5. S3 Image Integration

Artist image integration is handled during data preparation rather than during each Lambda API request.

The script `Backend-lambda/scripts/upload-images-to-s3.js` reads `2026a2_songs.json`, downloads each unique image URL, generates an S3 key based on the artist name, and uploads the image into S3:

```text
artist-images/{slugified-artist}.jpg
```

The script `Backend-lambda/scripts/seed-music-data.js` then builds an S3 URL for each artist image:

```text
https://{S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/artist-images/{slugified-artist}.jpg
```

This URL is stored in the `music` DynamoDB table as `image_url`. The Lambda backend returns `image_url` in music query results and subscription results.

Lambda does not directly call S3 `GetObject`, does not generate presigned URLs, and does not check whether the S3 object exists when returning a response. The frontend must be able to load the returned S3 URL directly. This likely requires public S3 object access or another bucket policy/CDN setup. From a security best-practice perspective, relying on public S3 URLs is simple but less controlled than using signed URLs or CloudFront with restricted access.

Not found: no Lambda route was found for proxying image downloads from S3.

---

## 6. Functional Coverage（對照作業要求）

- [x] Login: Implemented with `POST /login` and DynamoDB `GetCommand`.
- [x] Register: Implemented with `POST /register` and conditional `PutCommand`.
- [x] Music query（AND 條件）: Implemented. Multiple query parameters are filtered with AND logic.
- [x] Add subscription: Implemented with `POST /subscriptions`.
- [x] Remove subscription: Implemented with `DELETE /subscriptions`.
- [x] Get subscriptions: Implemented with `GET /subscriptions?email=...`.
- [ ] Logout/session: Missing. No session, JWT, token storage, or logout route found.
- [x] RESTful API: Partially implemented. Uses `GET`, `POST`, and `DELETE`, but `DELETE /subscriptions` uses JSON body rather than a resource URL.
- [x] DynamoDB Query vs Scan 正確使用: Partially. `Query` is used for some access patterns, but important operations still use full table scans.
- [x] GSI / LSI 使用: Implemented for `artist + album` and `year + artist` music searches.
- [x] S3 image integration: Partially implemented. S3 image URLs are stored and returned, but Lambda does not directly access S3 or generate signed URLs.

---

## 7. Assignment Compliance Issues（⚠️很重要）

1. **Some music queries still use Scan instead of Query.**  
   The assignment requires efficient querying and correct use of DynamoDB Query vs Scan. The Lambda backend uses `scanAllItems()` for title-only, album-only, year-only, and other query combinations that are not supported by the current key/index design.

2. **The existing GSI is underused.**  
   `year-artist-index` has `year` as the partition key, so it could support year-only queries. However, the code only uses this GSI when both `year` and `artist` are supplied.

3. **Subscription detail lookup is inefficient.**  
   `GET /subscriptions` queries the `subscriptions` table by email, but then calls `getSongBySongId()` for each subscription. That function scans the entire `music` table by `song_id`. This is inefficient and may be marked down for not designing an index for the access pattern.

4. **No `song_id` GSI exists on the music table.**  
   Since subscriptions store only `song_id`, the backend needs an efficient way to retrieve a song by `song_id`. Current table design makes that difficult because `song_id` is a sort key, not a partition key.

5. **Plaintext passwords.**  
   Register stores `password: body.password`, and login compares plaintext passwords. This is not secure and should be mentioned as a limitation.

6. **Lambda logs full API Gateway event.**  
   `handler.js` logs the full event, which can include email and password in login/register request bodies.

7. **Missing session or logout handling.**  
   Login returns user information but does not create a session token, JWT, cookie, or logout mechanism. If the assignment expects session handling, this is missing.

8. **API Gateway deployment is not fully represented in code.**  
   `package.json` can package and update Lambda code, and `openapi.yaml` documents routes. However, no script was found for creating API Gateway, connecting routes to Lambda, deploying a stage, or granting API Gateway permission to invoke Lambda.

9. **OpenAPI file does not fully match actual behavior.**  
   OpenAPI documents `409` for duplicate registration/subscription and `404` for missing song/subscription. Actual code returns `400` for duplicates and does not implement some `404` checks.

10. **Subscription add does not validate that the song exists.**  
    `POST /subscriptions` can create a subscription for any arbitrary `song_id`.

11. **Subscription delete always returns success.**  
    `DELETE /subscriptions` does not check whether a matching item existed.

12. **CORS is broad.**  
    The backend uses `Access-Control-Allow-Origin: *` and allows `PUT` even though no `PUT` route exists. This works for development but is not strict production configuration.

13. **Hardcoded fallback configuration.**  
    The code falls back to `us-east-1`, `login`, `music`, and `subscriptions` if environment variables are missing. This is convenient but risky because a misconfigured deployment may silently use the wrong resources.

14. **Frontend mismatch cannot be verified.**  
    Not found: no frontend source code exists in this repository, so frontend API URL or payload mismatch could not be checked.

15. **Root backend table name differs from Lambda backend.**  
    The root Flask `app.py` uses table name `subscription`, while Lambda uses `subscriptions`. This is outside Lambda scope but could cause confusion if both versions share AWS resources.

---

## 8. Recommended Fixes

1. Add a `song_id` GSI to the `music` table and change `getSongBySongId()` from `Scan` to `Query`.

2. Update `handleMusicSearch()` to use `year-artist-index` for year-only queries, not only `year + artist`.

3. Consider adding additional indexes or a search-friendly duplicated table for title/album access patterns, because DynamoDB cannot efficiently query arbitrary partial title/album matches without a suitable key design.

4. Validate `song_id` before adding a subscription. If the song does not exist, return `404`.

5. Use `ConditionExpression` on delete, or read before delete, so removing a non-existing subscription can return a meaningful `404`.

6. Align `openapi.yaml` with actual implementation, or update code to match the documented `409` and `404` responses.

7. Remove full request-body logging from `handler.js`. Log route, method, and request id instead.

8. Hash passwords before storing them. For example, use a password hashing library and compare hashed passwords during login.

9. Add API Gateway deployment steps or automation. The project should document or script API Gateway routes, Lambda proxy integration, stage deployment, and Lambda invoke permission.

10. Make production environment variables explicit. Required Lambda environment variables should include `AWS_REGION`, `LOGIN_TABLE`, `MUSIC_TABLE`, and `SUBSCRIPTIONS_TABLE`. Data preparation scripts also require `S3_BUCKET`.

11. Decide on S3 access strategy. For a simple assignment, public-read URLs may be acceptable, but the report should mention this limitation. A more secure design would use signed URLs or CloudFront.

12. Improve RESTful subscription URLs. For example, use `GET /users/{email}/subscriptions`, `POST /users/{email}/subscriptions`, and `DELETE /users/{email}/subscriptions/{song_id}`.

---

## 9. Report-Ready Paragraphs

The Lambda backend is implemented as a Node.js serverless API behind Amazon API Gateway. API Gateway forwards client requests to Lambda using the proxy event format, including the HTTP method, path, request body, and query string parameters. The Lambda handler parses the event, handles CORS preflight requests, validates JSON request bodies, and dispatches requests to separate route modules for authentication, music search, and subscription management. This structure keeps the entry point small while separating application logic by feature.

This architecture fits the music subscription application because the backend operations are event-driven and request-based. Each user action, such as logging in, registering, searching music, or changing a subscription, can be handled independently by a Lambda invocation. The backend does not need to maintain server-side state between requests. DynamoDB is used as the persistent data layer for users, music records, and subscriptions, while Lambda provides the application logic that validates requests and performs database operations.

The backend integrates with DynamoDB through a shared service layer using AWS SDK v3. The `login` table uses `email` as the primary key, allowing efficient user lookup during login and conditional writes during registration. The `music` table uses `artist` and `song_id` as its main key schema and also defines an LSI for album queries and a GSI for year-and-artist queries. The `subscriptions` table uses `email` and `song_id` as a composite key, which supports efficient lookup of all songs subscribed by a user. Multiple music search conditions are combined using AND logic, so returned songs must match every supplied query parameter.

Artist image integration is handled through S3 and DynamoDB together. A preparation script downloads artist images from the source dataset and uploads them to an S3 bucket. The music seeding script then stores the generated S3 image URL in each DynamoDB music item as `image_url`. During API requests, Lambda returns this stored URL to the frontend as part of music search and subscription responses. This keeps the runtime Lambda logic simple, but it also means image access depends on the S3 URL being readable by the frontend.

The current implementation satisfies the main functional requirements for login, register, music search, subscription add/remove/list, CORS, and basic RESTful method usage. However, there are limitations that should be discussed in the report. Some music search patterns and subscription song lookups still use DynamoDB scans, which is less efficient than query-based access and may not fully satisfy the assignment requirement for efficient DynamoDB design. The backend also stores plaintext passwords, does not implement session/logout handling, and does not include complete API Gateway deployment automation in the repository.

---

## 10. Design Rationale

### 1. Why API Gateway + Lambda

API Gateway and AWS Lambda are suitable for this music subscription application because the backend workload is request-driven. User actions such as login, registration, music search, adding a subscription, removing a subscription, and listing subscriptions are independent HTTP requests. These operations do not require a long-running backend process or persistent server-side memory, so they fit naturally into Lambda's event-driven execution model.

In this design, API Gateway acts as the public HTTP entry point and converts frontend requests into Lambda proxy events. Lambda then executes only when a request arrives. This is appropriate for an assignment-scale music application because the backend can remain simple, stateless, and focused on handling individual API operations. The application state is stored in DynamoDB rather than in the Lambda runtime, which means each invocation can be treated independently.

This design also works well with DynamoDB because both services are managed AWS services and integrate cleanly through the AWS SDK. Lambda can read and write DynamoDB records directly without managing database connections or server infrastructure. For operations such as login lookup, registration, music query, and subscription changes, Lambda only needs to perform short database operations and return a JSON response to API Gateway.

### 2. DynamoDB Design Rationale

The `login` table uses `email` as the partition key because email is the unique identifier supplied during both login and registration. Login requires a direct lookup of one user record by email, so using email as the primary key allows the backend to use an efficient `GetItem` operation. Registration also benefits from this design because DynamoDB can use a conditional write on the same key to prevent duplicate email accounts.

The `music` table uses `artist` as the partition key and `song_id` as the sort key because artist is one of the main search fields in the application. This allows the backend to efficiently query all songs by a specific artist. The `song_id` value is generated from artist, album, year, and title, which makes each song record unique within the table and allows multiple songs by the same artist to be stored under the same partition.

The `album-index` LSI is included to support queries that search within an artist's albums. Because an LSI keeps the same partition key as the base table, it can support access patterns such as finding songs for a given artist where the album begins with a provided album value. This is useful when the query includes both artist and album, because DynamoDB can avoid scanning the full table.

The `year-artist-index` GSI is included to support queries based on release year and artist. Unlike an LSI, a GSI can use a different partition key, so this index uses `year` as the partition key and `artist` as the sort key. This is intended to support access patterns where the application needs to retrieve songs by year, especially when combined with artist filtering. The presence of this GSI shows that the design attempts to support more than one query pattern instead of relying only on table scans.

### 3. Query vs Scan Design Trade-Off

The backend uses DynamoDB `Query` when the request matches the table's key schema or an available index. For example, searching by artist uses the base table partition key, searching by artist and album uses the `album-index` LSI, and searching by year and artist uses the `year-artist-index` GSI. These cases are more efficient because DynamoDB can locate a specific partition or index range rather than reading every item in the table.

The backend falls back to `Scan` when the requested search pattern is not supported by the current key schema or indexes. This happens for title-only searches, album-only searches, and some mixed queries where artist or year is not available in the right form for the existing indexes. The current design needs this fallback because DynamoDB is optimized around known access patterns, and arbitrary partial matching on fields such as title and album cannot be efficiently handled unless those access patterns are designed into the table or indexes.

This is an important design trade-off. For a small assignment dataset, scanning and then filtering in Lambda can produce correct functional results with less schema complexity. However, in a real-world system, scans would become expensive and slow as the music table grows. A production design would add indexes or supporting tables for common access patterns, use a dedicated search service for partial text search, or store normalized search fields that allow more efficient query-based lookup.

The current implementation therefore demonstrates both DynamoDB Query usage and the limitation of incomplete access-pattern design. It uses efficient queries where the schema supports them, but it still relies on scans where the query requirements exceed the available key and index structure.

### 4. Subscription Design Rationale

The `subscriptions` table uses `email` as the partition key and `song_id` as the sort key because the main subscription access pattern is to retrieve all songs subscribed by a specific user. With this key design, `GET /subscriptions?email=...` can use a DynamoDB `Query` operation on the email partition and return all subscription records for that user efficiently.

The composite key also prevents a user from having multiple identical subscription records for the same song. When adding a subscription, the backend writes an item using the user's email and the song ID. The conditional write checks whether that combination already exists, which supports duplicate prevention at the database level.

The limitation is that subscription records only store `song_id`, while the frontend needs full song details such as title, artist, album, year, and image URL. The current backend solves this by looking up each subscribed song in the `music` table. However, this lookup is not efficient because `song_id` is not available as a partition key or GSI in the music table. As a result, the backend scans the music table to find each song. A stronger design would add a `song_id` GSI or store enough denormalized song data directly in each subscription item.

### 5. S3 Design Rationale

The backend stores `image_url` in DynamoDB because the frontend only needs a URL that can be rendered in the user interface. By storing the S3 image URL with each music item, the Lambda function can return complete song metadata in one response without calling S3 during every API request. This keeps the runtime API path simple and fast.

Lambda does not directly call S3 for image retrieval in the current design. Instead, image upload and URL generation are handled by setup scripts before the application is used. This reduces the amount of work performed during each Lambda invocation and avoids adding S3 read latency to music query and subscription responses. For this assignment application, that is a practical design because image files are static assets and do not need to be dynamically processed by Lambda.

The advantage of this approach is simplicity. DynamoDB stores the song metadata and the image URL together, and Lambda only needs to return the stored record. The disadvantage is reduced control over image access. If the frontend loads the S3 URL directly, the bucket or objects must be publicly readable or otherwise accessible through a configured distribution. A more secure production design would use CloudFront, signed URLs, or a controlled image delivery mechanism.

### 6. Limitations

The main DynamoDB limitation is that some access patterns still require scans. Although the backend uses `Query` for artist-based searches and selected index-supported queries, title-only searches, album-only searches, and subscription song detail lookups are not fully supported by the current key schema. This limits scalability and should be identified as an area for improvement in the report.

The authentication design also has security limitations. Passwords are stored and compared in plaintext, which is not suitable for a real production system. A stronger implementation would hash passwords before storing them and compare submitted credentials against the stored password hash. The backend also does not implement sessions, JWT tokens, cookies, or logout handling, so login only returns basic user information rather than establishing a secure authenticated session.

The S3 image design is simple but has access-control limitations. Because Lambda returns stored S3 URLs directly, image loading depends on the S3 objects being accessible to the frontend. This may be acceptable for a controlled assignment environment, but in a production system public S3 access should be avoided or carefully restricted. A more robust design would use signed URLs, CloudFront, or another controlled delivery mechanism.
