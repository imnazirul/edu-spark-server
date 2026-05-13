const express = require("express");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const cors = require("cors");
const jwt = require("jsonwebtoken");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

const stripe = process.env.STRIPE_TEST_KEY
    ? require("stripe")(process.env.STRIPE_TEST_KEY)
    : null;

const allowedOrigins = [
    "http://localhost:5173",
    "https://eduspark-live.web.app",
    "https://eduspark-live.firebaseapp.com",
];

app.use(
    cors({
        origin: function (origin, callback) {
            if (!origin || allowedOrigins.includes(origin)) {
                return callback(null, true);
            }

            return callback(new Error("Not allowed by CORS"));
        },
        methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
    })
);

app.options("*", cors());
app.use(express.json({ limit: "1mb" }));

const asyncHandler = (fn) => {
    return function (req, res, next) {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
};

const escapeRegex = (value = "") => {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

const getPagination = (req, defaultSize = 20, maxSize = 100) => {
    const page = Math.max(parseInt(req.query.page, 10) || 0, 0);
    const size = Math.min(
        Math.max(parseInt(req.query.size, 10) || defaultSize, 1),
        maxSize
    );

    return {
        page,
        size,
        skip: page * size,
    };
};

const toObjectId = (id) => {
    if (!ObjectId.isValid(id)) {
        const error = new Error("Invalid ID format");
        error.status = 400;
        throw error;
    }

    return new ObjectId(id);
};

const requiredEnv = ["DB_USER", "DB_PASS", "ACCESS_TOKEN_SECRET"];

for (const key of requiredEnv) {
    if (!process.env[key]) {
        console.warn(`Missing environment variable: ${key}`);
    }
}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.kygk2l2.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
    serverSelectionTimeoutMS: 8000,
    connectTimeoutMS: 8000,
    maxPoolSize: 5,
    maxIdleTimeMS: 30000,
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    },
});

const db = client.db("EduSparkDB");

const ArticleCollection = db.collection("eduArticles");
const userCollection = db.collection("users");
const classCollection = db.collection("classes");
const teacherRequestCollection = db.collection("teacherRequests");
const assignmentCollection = db.collection("assignments");
const enrolledClassCollection = db.collection("enrolledClasses");
const feedbackCollection = db.collection("feedbacks");

const verifyToken = (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
    }

    jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).send({ message: "unauthorized access" });
        }

        req.decoded = decoded;
        next();
    });
};

const verifyAdmin = asyncHandler(async (req, res, next) => {
    const email = req.decoded?.email;

    if (!email) {
        return res.status(401).send({ message: "unauthorized access" });
    }

    const user = await userCollection.findOne({ email });

    if (!user || user.role !== "admin") {
        return res.status(403).send({ message: "forbidden access" });
    }

    next();
});

const verifyTeacher = asyncHandler(async (req, res, next) => {
    const email = req.decoded?.email;

    if (!email) {
        return res.status(401).send({ message: "unauthorized access" });
    }

    const user = await userCollection.findOne({ email });

    if (!user || user.role !== "teacher") {
        return res.status(403).send({ message: "forbidden access" });
    }

    next();
});

app.get("/", (req, res) => {
    res.send("EduSpark Server is Running...");
});

app.get(
    "/health",
    asyncHandler(async (req, res) => {
        await db.command({ ping: 1 });

        res.send({
            status: "ok",
            message: "Server and MongoDB connection are working",
        });
    })
);

// JWT APIs
app.post(
    "/jwt",
    asyncHandler(async (req, res) => {
        const user = req.body;

        if (!process.env.ACCESS_TOKEN_SECRET) {
            return res.status(500).send({
                message: "ACCESS_TOKEN_SECRET is missing",
            });
        }

        const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
            expiresIn: "24h",
        });

        res.send({ token });
    })
);

// Payment APIs
app.post(
    "/create-payment-intent",
    verifyToken,
    asyncHandler(async (req, res) => {
        if (!stripe) {
            return res.status(500).send({
                message: "Stripe key is missing",
            });
        }

        const price = Number(req.body.price);

        if (!Number.isFinite(price) || price <= 0) {
            return res.status(400).send({
                message: "Valid price is required",
            });
        }

        const calculatedAmount = Math.round(price * 100);

        const paymentIntent = await stripe.paymentIntents.create({
            amount: calculatedAmount,
            currency: "usd",
            payment_method_types: ["card"],
        });

        res.send({ clientSecret: paymentIntent.client_secret });
    })
);

app.get(
    "/total_site_data",
    asyncHandler(async (req, res) => {
        const [totalUser, totalClasses, totalEnrollmentResult] = await Promise.all([
            userCollection.estimatedDocumentCount(),
            classCollection.countDocuments({ status: "approved" }),
            classCollection
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
                .toArray(),
        ]);

        res.send({
            totalUser,
            totalClasses,
            totalEnrollment: totalEnrollmentResult[0]?.totalEnrollmentSum || 0,
        });
    })
);

// Users APIs
app.get(
    "/users",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const search = req.query.search;
        const { skip, size } = getPagination(req, 20, 100);

        let query = {};

        if (search) {
            query = {
                email: {
                    $regex: escapeRegex(search),
                    $options: "i",
                },
            };
        }

        const result = await userCollection
            .find(query)
            .skip(skip)
            .limit(size)
            .toArray();

        res.send(result);
    })
);

app.get(
    "/users_count",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const search = req.query.search;

        let query = {};

        if (search) {
            query = {
                email: {
                    $regex: escapeRegex(search),
                    $options: "i",
                },
            };
        }

        const totalUsers = await userCollection.countDocuments(query);

        res.send({ totalUsers });
    })
);

app.get(
    "/users/:email",
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        const result = await userCollection.findOne({ email });

        res.send(result);
    })
);

app.get(
    "/users/role/:email",
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        let role = "unknown";

        const user = await userCollection.findOne({ email });

        if (user) {
            role = user.role;
        }

        res.send({ role });
    })
);

app.post(
    "/users",
    asyncHandler(async (req, res) => {
        const user = req.body;

        if (!user?.email) {
            return res.status(400).send({
                message: "User email is required",
            });
        }

        const existsUser = await userCollection.findOne({
            email: user.email,
        });

        if (existsUser) {
            return res.send({
                message: "user already exists",
                insertedId: null,
            });
        }

        const result = await userCollection.insertOne(user);

        res.send(result);
    })
);

app.patch(
    "/users/:email",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        const result = await userCollection.updateOne(
            { email },
            {
                $set: {
                    role: "admin",
                },
            },
            { upsert: true }
        );

        res.send(result);
    })
);

// Enrolled classes APIs
app.get(
    "/enrolled_classes_ids/:email",
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        const result = await enrolledClassCollection
            .find({ enrolledEmail: email })
            .project({ enrolledClassId: 1, _id: 0 })
            .toArray();

        const enrolledClassIds = result.map((classItem) => {
            return classItem.enrolledClassId;
        });

        res.send(enrolledClassIds);
    })
);

app.get(
    "/my_enrolled_classes/:email",
    verifyToken,
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        const enrolledIdsAOB = await enrolledClassCollection
            .find({ enrolledEmail: email })
            .project({ enrolledClassId: 1, _id: 0 })
            .toArray();

        const enrolledIds = enrolledIdsAOB
            .filter((classItem) => ObjectId.isValid(classItem.enrolledClassId))
            .map((classItem) => new ObjectId(classItem.enrolledClassId));

        if (!enrolledIds.length) {
            return res.send([]);
        }

        const result = await classCollection
            .find({
                _id: {
                    $in: enrolledIds,
                },
            })
            .toArray();

        res.send(result);
    })
);

app.post(
    "/enrolled_classes",
    verifyToken,
    asyncHandler(async (req, res) => {
        const enrollData = req.body;

        if (!enrollData?.enrolledClassId) {
            return res.status(400).send({
                message: "enrolledClassId is required",
            });
        }

        const classId = toObjectId(enrollData.enrolledClassId);

        const result = await enrolledClassCollection.insertOne(enrollData);

        const updateResult = await classCollection.updateOne(
            {
                _id: classId,
            },
            {
                $inc: {
                    totalEnrollment: 1,
                },
            }
        );

        res.send({
            insertedId: result.insertedId,
            acknowledged: result.acknowledged,
            enrollmentUpdated: updateResult.modifiedCount > 0,
        });
    })
);

// Teacher request APIs
app.get(
    "/teacher_requests",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const { skip, size } = getPagination(req, 20, 100);

        const result = await teacherRequestCollection
            .find()
            .skip(skip)
            .limit(size)
            .toArray();

        res.send(result);
    })
);

app.get(
    "/teacher_requests_count",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const count = await teacherRequestCollection.estimatedDocumentCount();

        res.send({ count });
    })
);

app.get(
    "/teacher_requests/:email",
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        const result = await teacherRequestCollection.find({ email }).toArray();

        res.send(result);
    })
);

app.post(
    "/teacher_requests",
    verifyToken,
    asyncHandler(async (req, res) => {
        const teacherInfo = req.body;

        const result = await teacherRequestCollection.insertOne(teacherInfo);

        res.send(result);
    })
);

app.patch(
    "/teacher_requests/:id",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const statusInfo = req.body;
        const id = req.params.id;

        const requestId = toObjectId(id);

        if (!statusInfo?.status) {
            return res.status(400).send({
                message: "status is required",
            });
        }

        if (statusInfo.status === "approved" && statusInfo.email) {
            await userCollection.updateOne(
                {
                    email: statusInfo.email,
                },
                {
                    $set: {
                        role: "teacher",
                    },
                },
                {
                    upsert: true,
                }
            );
        }

        const result = await teacherRequestCollection.updateOne(
            {
                _id: requestId,
            },
            {
                $set: {
                    status: statusInfo.status,
                },
            },
            {
                upsert: true,
            }
        );

        res.send(result);
    })
);

// Classes APIs
app.get(
    "/popular_classes",
    asyncHandler(async (req, res) => {
        const result = await classCollection
            .find({
                status: "approved",
            })
            .sort({
                totalEnrollment: -1,
            })
            .limit(10)
            .toArray();

        res.send(result);
    })
);

app.get(
    "/classes",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const { skip, size } = getPagination(req, 20, 100);

        const result = await classCollection.find().skip(skip).limit(size).toArray();

        res.send(result);
    })
);

app.get(
    "/classes_count",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const totalClasses = await classCollection.estimatedDocumentCount();

        res.send({ totalClasses });
    })
);

app.get(
    "/approved_classes",
    asyncHandler(async (req, res) => {
        const { skip, size } = getPagination(req, 50, 100);

        const result = await classCollection
            .find({
                status: "approved",
            })
            .skip(skip)
            .limit(size)
            .toArray();

        res.send(result);
    })
);

app.get(
    "/single_class/:id",
    asyncHandler(async (req, res) => {
        const id = req.params.id;

        const result = await classCollection.findOne({
            _id: toObjectId(id),
        });

        if (!result) {
            return res.status(404).send({
                message: "Class not found",
            });
        }

        res.send(result);
    })
);

app.get(
    "/teacher_classes/:email",
    verifyToken,
    verifyTeacher,
    asyncHandler(async (req, res) => {
        const email = req.params.email;

        const result = await classCollection.find({ email }).toArray();

        res.send(result);
    })
);

app.get(
    "/total_classes_data/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = req.params.id;

        const classInfo = await classCollection.findOne({
            _id: toObjectId(id),
        });

        if (!classInfo) {
            return res.status(404).send({
                message: "Class not found",
            });
        }

        const totalAssignment = await assignmentCollection.countDocuments({
            classId: id,
        });

        res.send({
            totalEnrolled: classInfo.totalEnrollment || 0,
            totalAssignment,
        });
    })
);

app.get(
    "/per_day_assignment_submissions/:id",
    verifyToken,
    verifyTeacher,
    asyncHandler(async (req, res) => {
        const classId = req.params.id;

        const startOfTheDay = new Date();
        startOfTheDay.setHours(0, 0, 0, 0);

        const endOfTheDay = new Date();
        endOfTheDay.setHours(23, 59, 59, 999);

        const startOfDay = startOfTheDay.getTime();
        const endOfDay = endOfTheDay.getTime();

        const perDaySubmissions = await assignmentCollection
            .aggregate([
                {
                    $match: {
                        classId,
                        "submittedEmails.date": {
                            $gte: startOfDay,
                            $lt: endOfDay,
                        },
                    },
                },
                {
                    $unwind: "$submittedEmails",
                },
                {
                    $match: {
                        "submittedEmails.date": {
                            $gte: startOfDay,
                            $lt: endOfDay,
                        },
                    },
                },
                {
                    $group: {
                        _id: "$_id",
                        count: {
                            $sum: 1,
                        },
                    },
                },
                {
                    $group: {
                        _id: null,
                        perDayCount: {
                            $sum: "$count",
                        },
                    },
                },
            ])
            .toArray();

        if (perDaySubmissions[0]) {
            return res.send(perDaySubmissions[0]);
        }

        res.send({
            perDayCount: 0,
        });
    })
);

app.post(
    "/classes",
    verifyToken,
    verifyTeacher,
    asyncHandler(async (req, res) => {
        const classInfo = req.body;

        const result = await classCollection.insertOne(classInfo);

        res.send(result);
    })
);

app.patch(
    "/classes/:id",
    verifyToken,
    verifyTeacher,
    asyncHandler(async (req, res) => {
        const id = req.params.id;
        const classInfo = req.body;

        const result = await classCollection.updateOne(
            {
                _id: toObjectId(id),
            },
            {
                $set: {
                    ...classInfo,
                },
            },
            {
                upsert: false,
            }
        );

        res.send(result);
    })
);

app.patch(
    "/class_status/:id",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const id = req.params.id;
        const upStatus = req.body;

        if (!upStatus?.status) {
            return res.status(400).send({
                message: "status is required",
            });
        }

        const result = await classCollection.updateOne(
            {
                _id: toObjectId(id),
            },
            {
                $set: {
                    status: upStatus.status,
                },
            },
            {
                upsert: false,
            }
        );

        res.send(result);
    })
);

app.delete(
    "/classes/:id",
    verifyToken,
    verifyTeacher,
    asyncHandler(async (req, res) => {
        const id = req.params.id;

        const result = await classCollection.deleteOne({
            _id: toObjectId(id),
        });

        res.send(result);
    })
);

// Assignment APIs
app.get(
    "/assignments/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = req.params.id;
        const { skip, size } = getPagination(req, 20, 100);

        const result = await assignmentCollection
            .find({
                classId: id,
            })
            .skip(skip)
            .limit(size)
            .toArray();

        res.send(result);
    })
);

app.get(
    "/assignments_count/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = req.params.id;

        const totalIdsAssignment = await assignmentCollection.countDocuments({
            classId: id,
        });

        res.send({ totalIdsAssignment });
    })
);

app.post(
    "/assignments",
    verifyToken,
    verifyTeacher,
    asyncHandler(async (req, res) => {
        const assignment = req.body;

        const result = await assignmentCollection.insertOne(assignment);

        res.send(result);
    })
);

app.patch(
    "/assignments/:id",
    verifyToken,
    asyncHandler(async (req, res) => {
        const id = req.params.id;
        const updatedSubmittedEmails = req.body;

        const result = await assignmentCollection.updateOne(
            {
                _id: toObjectId(id),
            },
            {
                $set: {
                    submittedEmails: updatedSubmittedEmails,
                },
                $inc: {
                    total_submitted: 1,
                },
            },
            {
                upsert: false,
            }
        );

        res.send(result);
    })
);

// Feedback APIs
app.get(
    "/feedbacks",
    asyncHandler(async (req, res) => {
        const result = await feedbackCollection
            .find()
            .sort({
                rating: -1,
            })
            .limit(10)
            .toArray();

        res.send(result);
    })
);

app.get(
    "/feedback/:id",
    verifyToken,
    verifyAdmin,
    asyncHandler(async (req, res) => {
        const id = req.params.id;

        const result = await feedbackCollection
            .find({
                classId: id,
            })
            .limit(100)
            .toArray();

        res.send(result);
    })
);

app.post(
    "/feedbacks",
    verifyToken,
    asyncHandler(async (req, res) => {
        const feedbackData = req.body;

        const result = await feedbackCollection.insertOne(feedbackData);

        res.send(result);
    })
);

// Article APIs
app.get(
    "/articles",
    asyncHandler(async (req, res) => {
        const { skip, size } = getPagination(req, 50, 100);

        const result = await ArticleCollection.find()
            .skip(skip)
            .limit(size)
            .toArray();

        res.send(result);
    })
);

app.use((req, res) => {
    res.status(404).send({
        message: "Route not found",
        path: req.originalUrl,
    });
});

app.use((err, req, res, next) => {
    console.error("API Error:", err);

    if (res.headersSent) {
        return next(err);
    }

    res.status(err.status || 500).send({
        message: err.message || "Internal server error",
    });
});

if (!process.env.VERCEL) {
    app.listen(port, () => {
        console.log(`server is running on port ${port}`);
    });
}

module.exports = app;