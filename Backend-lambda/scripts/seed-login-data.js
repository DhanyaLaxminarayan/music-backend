/**
 * Seed one login user into DynamoDB.
 *
 * Optional environment variables:
 * - SEED_EMAIL=test@example.com
 * - SEED_USER_NAME=testuser
 * - SEED_PASSWORD=password123
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const region = process.env.AWS_REGION || 'us-east-1';
const loginTable = process.env.LOGIN_TABLE || 'login';
const email = process.env.SEED_EMAIL || 'test@example.com';
const userName = process.env.SEED_USER_NAME || 'testuser';
const password = process.env.SEED_PASSWORD || 'password123';

const dynamoClient = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));

async function seedLoginData() {
  try {
    await dynamoClient.send(
      new PutCommand({
        TableName: loginTable,
        Item: {
          email,
          user_name: userName,
          password,
          created_at: new Date().toISOString()
        },
        ConditionExpression: 'attribute_not_exists(email)'
      })
    );

    console.log(`Seeded login user ${email} into ${loginTable}.`);
  } catch (error) {
    if (error.name === 'ConditionalCheckFailedException') {
      console.log(`Login user already exists: ${email}`);
      return;
    }

    console.error('Error seeding login data:', error);
    process.exit(1);
  }
}

seedLoginData();
