const express = require("express");
const cors = require("cors");
require("dotenv").config();
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:5173"],
  })
);
app.use(express.json());

const { MongoClient, ServerApiVersion } = require("mongodb");
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kygk2l2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const ArticleCollection = client.db("EduSparkDB").collection("eduArticles");
    const userCollection = client.db("EduSparkDB").collection("users");
    const classCollection = client.db("EduSparkDB").collection("classes");

    // users Api
    app.get("/users", async (req, res) => {
      const search = req.query.search;
      let query = {};
      if (search) {
        query = {
          email: { $regex: search, $options: "i" },
        };
      }
      const result = await userCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        email,
      };
      const result = await userCollection.findOne(query);
      console.log(result);
      res.send(result);
    });

    app.get("/users/role/:email", async (req, res) => {
      const query = {
        email: req.params.email,
      };

      let role = "unknown";
      const user = await userCollection.findOne(query);
      if (user) {
        role = user?.role;
      }
      res.send({ role });
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      const query = {
        email: user?.email,
      };
      const ExistsUser = await userCollection.findOne(query);
      if (ExistsUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }

      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    //class apis

    app.get("/classes", async (req, res) => {
      const result = await classCollection.find().toArray();
      res.send(result);
    });

    //article

    app.get("/articles", async (req, res) => {
      const result = await ArticleCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", async (req, res) => {
  res.send("EduSpark Server is Running...");
});

app.listen(port, () => {
  console.log(`server is running on port ${port}`);
});
