const { MongoClient } = require('mongodb');

async function main() {
  const uri = "mongodb://test_user:testuser__1@atlas-sql-6837491fb7eddf3deab780ea-druplg.a.query.mongodb.net:27017/sample_mflix?ssl=true&authSource=admin";
  const client = new MongoClient(uri);

  try {
    // Connect to the MongoDB cluster
    await client.connect();

    // List databases as a test
    const databasesList = await client.db().admin().listDatabases();
    console.log("Databases:");
    databasesList.databases.forEach(db => console.log(` - ${db.name}`));
  } catch (e) {
    console.error(e);
  } finally {
    await client.close();
  }
}

main().catch(console.error); 