const express = require("express");
const cors = require("cors");
require("dotenv").config();
const stripe = require("stripe")(process.env.STRIPE_TEST_KEY);
const app = express();
const port = process.env.PORT || 5000;

app.use(
  cors({
    origin: ["http://localhost:5173"],
  })
);
app.use(express.json());

const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
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
    const teacherRequestCollection = client
      .db("EduSparkDB")
      .collection("teacherRequests");
    const assignmentCollection = client
      .db("EduSparkDB")
      .collection("assignments");
    const enrolledClassCollection = client
      .db("EduSparkDB")
      .collection("enrolledClasses");
    const feedbackCollection = client.db("EduSparkDB").collection("feedbacks");

    //payment apis
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;

      const calculatedAmount = parseInt(price * 100);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: calculatedAmount,
        currency: "usd",
        payment_method_types: ["card"],
      });
      console.log(paymentIntent);
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.get("/total_site_data", async (req, res) => {
      const totalUser = await userCollection.countDocuments();
      const totalClasses = await classCollection.countDocuments({
        status: "approved",
      });
      const totalEnrollment = await classCollection
        .aggregate([
          {
            $match: {
              status: "approved",
            },
          },
          {
            $group: {
              _id: null,
              totalEnrollmentSum: {
                $sum: "$totalEnrollment",
              },
            },
          },
        ])
        .toArray();
      res.send({
        totalUser,
        totalClasses,
        totalEnrollment: totalEnrollment[0].totalEnrollmentSum,
      });
    });

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

    app.patch("/users/:email", async (req, res) => {
      const email = req.params.email;
      const filter = {
        email: email,
      };
      const updatedDoc = {
        $set: {
          role: "admin",
        },
      };
      const options = { upsert: true };

      const result = await userCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    //enrolled classes apis

    app.get("/enrolled_classes_ids/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        enrolledEmail: email,
      };

      const result = await enrolledClassCollection
        .find(query)
        .project({ enrolledClassId: 1, _id: 0 })
        .toArray();

      const enrolledClassIds = result.map(
        (classItem) => classItem.enrolledClassId
      );

      res.send(enrolledClassIds);
    });

    app.get("/my_enrolled_classes/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        enrolledEmail: email,
      };

      const EnrolledIdsAOB = await enrolledClassCollection
        .find(query)
        .project({ enrolledClassId: 1, _id: 0 })
        .toArray();

      const EnrolledIds = EnrolledIdsAOB.map(
        (classItem) => new ObjectId(classItem.enrolledClassId)
      );

      const result = await classCollection
        .find({ _id: { $in: EnrolledIds } })
        .toArray();

      res.send(result);
    });

    app.post("/enrolled_classes", async (req, res) => {
      const enrollData = req.body;
      const result = await enrolledClassCollection.insertOne(enrollData);
      res.send(result);
      //TODO: increment the totalEnrollment after successfully enrolled
      const filter = {
        _id: new ObjectId(req.body.enrolledClassId),
      };
      const updatedTotalEnrollment = {
        $inc: { totalEnrollment: 1 },
      };
      const increaseTotalEnrollment = await classCollection.updateOne(
        filter,
        updatedTotalEnrollment
      );
    });

    //teacher request

    app.get("/teacher_request", async (req, res) => {
      const result = await teacherRequestCollection.find().toArray();
      res.send(result);
    });

    app.get("/teacher_requests/:email", async (req, res) => {
      const email = req.params.email;
      const query = {
        email: email,
      };
      const result = await teacherRequestCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/teacher_requests", async (req, res) => {
      const teacherInfo = req.body;
      const result = await teacherRequestCollection.insertOne(teacherInfo);
      res.send(result);
    });

    app.patch("/teacher_requests/:id", async (req, res) => {
      const statusInfo = req.body;
      const id = req.params.id;
      const filter = {
        _id: new ObjectId(id),
      };
      const updatedDoc = {
        $set: {
          status: statusInfo.status,
        },
      };
      const options = {
        upsert: true,
      };

      // CHANGE USER ROLE TO TEACHER
      if (statusInfo.status === "approved") {
        const teacherFilter = {
          email: statusInfo.email,
        };
        const updatedTeacherDoc = {
          $set: {
            role: "teacher",
          },
        };
        const makeTeacher = await userCollection.updateOne(
          teacherFilter,
          updatedTeacherDoc,
          options
        );
      }

      const result = await teacherRequestCollection.updateOne(
        filter,
        updatedDoc,
        options
      );

      res.send(result);
    });

    //class apis

    app.get("/classes", async (req, res) => {
      const result = await classCollection.find().toArray();
      res.send(result);
    });
    app.get("/approved_classes", async (req, res) => {
      const query = {
        status: "approved",
      };
      const result = await classCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/single_class/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id),
      };
      const result = await classCollection.findOne(query);
      res.send(result);
    });

    app.get("/teacher_classes/:email", async (req, res) => {
      const query = {
        email: req.params.email,
      };
      const result = await classCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/total_classes_data/:id", async (req, res) => {
      const id = req.params.id;
      console.log(id);
      const query = {
        _id: new ObjectId(id),
      };
      console.log(id);
      const { totalEnrollment: totalEnrolled } = await classCollection.findOne(
        query
      );
      const totalAssignment = await assignmentCollection
        .find({
          classId: id,
        })
        .project({ total_submitted: 1, _id: 0 })
        .toArray();

      //TODO: PER DAY SUBMISSION

      res.send({ totalEnrolled, totalAssignment });
    });

    app.post("/classes", async (req, res) => {
      const classInfo = req.body;
      const result = await classCollection.insertOne(classInfo);
      res.send(result);
    });

    app.patch("/classes/:id", async (req, res) => {
      const id = req.params.id;
      const classInfo = req.body;

      const filter = {
        _id: new ObjectId(id),
      };
      const options = { upsert: true };

      const updatedDoc = {
        $set: {
          ...classInfo,
        },
      };
      const result = await classCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.patch("/classes/:id", async (req, res) => {
      const id = req.params.id;
      const upStatus = req.body;
      // console.log(id, upStatus);
      const filter = {
        _id: new ObjectId(id),
      };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          status: upStatus.status,
        },
      };
      const result = await classCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    app.delete("/classes/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        _id: new ObjectId(id),
      };
      const result = await classCollection.deleteOne(query);
      res.send(result);
    });

    // assignment apis

    app.get("/assignments/:id", async (req, res) => {
      const id = req.params.id;
      const query = {
        classId: id,
      };
      const result = await assignmentCollection.find(query).toArray();
      res.send(result);
    });

    app.post("/assignments", async (req, res) => {
      const assignment = req.body;
      const result = await assignmentCollection.insertOne(assignment);
      res.send(result);
    });

    app.patch("/assignments/:id", async (req, res) => {
      const id = req.params.id;
      const updatedSubmittedEmails = req.body;
      const filter = {
        _id: new ObjectId(id),
      };
      const updatedDoc = {
        $set: {
          submittedEmails: updatedSubmittedEmails,
        },
        $inc: {
          total_submitted: 1,
        },
      };
      const options = { upsert: true };

      const result = await assignmentCollection.updateOne(
        filter,
        updatedDoc,
        options
      );
      res.send(result);
    });

    //feedback apis

    app.get("/feedbacks", async (req, res) => {
      const result = await feedbackCollection.find().limit(10).toArray();
      res.send(result);
    });

    app.post("/feedbacks", async (req, res) => {
      const feedbackData = req.body;
      const result = await feedbackCollection.insertOne(feedbackData);
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
