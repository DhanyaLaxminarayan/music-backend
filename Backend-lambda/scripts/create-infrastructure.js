/**
 * Create AWS infrastructure for the Music Subscription assignment.
 *
 * Required environment variables:
 * - AWS_REGION=us-east-1
 * - LOGIN_TABLE=login
 * - MUSIC_TABLE=music
 * - SUBSCRIPTIONS_TABLE=subscriptions
 * - S3_BUCKET=your-bucket-name
 */

import {
  CreateTableCommand,
  DescribeTableCommand,
  DynamoDBClient,
  ResourceInUseException,
  waitUntilTableExists
} from '@aws-sdk/client-dynamodb';
import {
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client
} from '@aws-sdk/client-s3';

const region = process.env.AWS_REGION || 'us-east-1';
const loginTable = process.env.LOGIN_TABLE || 'login';
const musicTable = process.env.MUSIC_TABLE || 'music';
const subscriptionsTable = process.env.SUBSCRIPTIONS_TABLE || 'subscriptions';
const bucket = process.env.S3_BUCKET;

if (!bucket) {
  console.error('Missing S3_BUCKET environment variable.');
  process.exit(1);
}

const dynamoClient = new DynamoDBClient({ region });
const s3Client = new S3Client({ region });

async function bucketExists(bucketName) {
  try {
    await s3Client.send(new HeadBucketCommand({ Bucket: bucketName }));
    return true;
  } catch (error) {
    if ([301, 403, 404].includes(error.$metadata?.httpStatusCode)) {
      return error.$metadata.httpStatusCode !== 404;
    }

    if (['NotFound', 'NoSuchBucket'].includes(error.name)) {
      return false;
    }

    throw error;
  }
}

async function createBucket(bucketName) {
  if (await bucketExists(bucketName)) {
    console.log(`S3 bucket already exists: ${bucketName}`);
    return;
  }

  try {
    const commandInput = { Bucket: bucketName };

    if (region !== 'us-east-1') {
      commandInput.CreateBucketConfiguration = {
        LocationConstraint: region
      };
    }

    await s3Client.send(new CreateBucketCommand(commandInput));
    console.log(`Created S3 bucket: ${bucketName}`);
  } catch (error) {
    if (['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error.name)) {
      console.log(`S3 bucket already exists: ${bucketName}`);
      return;
    }

    throw error;
  }
}

async function tableExists(tableName) {
  try {
    await dynamoClient.send(new DescribeTableCommand({ TableName: tableName }));
    return true;
  } catch (error) {
    if (error.name === 'ResourceNotFoundException') {
      return false;
    }

    throw error;
  }
}

async function waitForTable(tableName) {
  await waitUntilTableExists(
    {
      client: dynamoClient,
      maxWaitTime: 180,
      minDelay: 2,
      maxDelay: 10
    },
    { TableName: tableName }
  );
  console.log(`DynamoDB table is ACTIVE: ${tableName}`);
}

async function createTable(tableName, createTableInput) {
  if (await tableExists(tableName)) {
    console.log(`DynamoDB table already exists: ${tableName}`);
    await waitForTable(tableName);
    return;
  }

  try {
    await dynamoClient.send(new CreateTableCommand(createTableInput));
    console.log(`Creating DynamoDB table: ${tableName}`);
    await waitForTable(tableName);
  } catch (error) {
    if (error instanceof ResourceInUseException || error.name === 'ResourceInUseException') {
      console.log(`DynamoDB table already exists: ${tableName}`);
      await waitForTable(tableName);
      return;
    }

    throw error;
  }
}

function loginTableDefinition() {
  return {
    TableName: loginTable,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'email', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'email', KeyType: 'HASH' }
    ]
  };
}

function musicTableDefinition() {
  return {
    TableName: musicTable,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'artist', AttributeType: 'S' },
      { AttributeName: 'song_id', AttributeType: 'S' },
      { AttributeName: 'album', AttributeType: 'S' },
      { AttributeName: 'year', AttributeType: 'N' }
    ],
    KeySchema: [
      { AttributeName: 'artist', KeyType: 'HASH' },
      { AttributeName: 'song_id', KeyType: 'RANGE' }
    ],
    LocalSecondaryIndexes: [
      {
        IndexName: 'album-index',
        KeySchema: [
          { AttributeName: 'artist', KeyType: 'HASH' },
          { AttributeName: 'album', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'year-artist-index',
        KeySchema: [
          { AttributeName: 'year', KeyType: 'HASH' },
          { AttributeName: 'artist', KeyType: 'RANGE' }
        ],
        Projection: { ProjectionType: 'ALL' }
      }
    ]
  };
}

function subscriptionsTableDefinition() {
  return {
    TableName: subscriptionsTable,
    BillingMode: 'PAY_PER_REQUEST',
    AttributeDefinitions: [
      { AttributeName: 'email', AttributeType: 'S' },
      { AttributeName: 'song_id', AttributeType: 'S' }
    ],
    KeySchema: [
      { AttributeName: 'email', KeyType: 'HASH' },
      { AttributeName: 'song_id', KeyType: 'RANGE' }
    ]
  };
}

async function createInfrastructure() {
  try {
    console.log(`Creating infrastructure in ${region}...`);

    await createBucket(bucket);
    console.log(`Artist image bucket: ${bucket}`);

    await createTable(loginTable, loginTableDefinition());
    await createTable(musicTable, musicTableDefinition());
    await createTable(subscriptionsTable, subscriptionsTableDefinition());

    console.log('\nInfrastructure is ready.');
    console.log(`LOGIN_TABLE=${loginTable}`);
    console.log(`MUSIC_TABLE=${musicTable}`);
    console.log(`SUBSCRIPTIONS_TABLE=${subscriptionsTable}`);
    console.log(`S3_BUCKET=${bucket}`);
  } catch (error) {
    console.error('Error creating infrastructure:', error);
    process.exit(1);
  }
}

createInfrastructure();
