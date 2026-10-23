
const request = require('supertest');
const app = require('../app');
const db = require('../config/db');
const User = require('../models/User');
const Feedback = require('../models/Feedback');
const { connectMongo, closeMongo } = require('../config/mongo');

let restaurantId;
let otherRestaurantId;
let adminId;

const adminEmail = 'feedback.admin.sherubtse@rub.edu.bt';

beforeAll(async () => {
  const r1 = await db.one(
    `INSERT INTO restaurants (name, cuisine, rating)
     VALUES ($1, $2, $3) RETURNING id`,
    ['Feedback Cafe', 'Test', 4]
  );

  const r2 = await db.one(
    `INSERT INTO restaurants (name, cuisine, rating)
     VALUES ($1, $2, $3) RETURNING id`,
    ['Other Cafe', 'Test', 4]
  );

  restaurantId = r1.id;
  otherRestaurantId = r2.id;

  const admin = await User.createUser({
    name: 'Feedback Admin',
    email: adminEmail,
    password: 'adminpass123',
    verificationToken: 'not-needed',
  });

  adminId = admin.id;

  await db.none(
    `UPDATE users
     SET is_verified = true, role = 'admin'
     WHERE id = $1`,
    [adminId]
  );

  await db.none(
    'UPDATE restaurants SET owner_id = $1 WHERE id = $2',
    [adminId, restaurantId]
  );

  // Connect to the MongoDB test database.
  await connectMongo();
});

afterAll(async () => {
  try {
    const mongo = await connectMongo();

    // Remove feedback created by these tests.
    await mongo.collection('feedback').deleteMany({
      restaurantId: {
        $in: [restaurantId, otherRestaurantId, 999999],
      },
    });

    // Clear the foreign key before deleting the admin.
    if (restaurantId !== undefined && adminId !== undefined) {
      await db.none(
        'UPDATE restaurants SET owner_id = NULL WHERE id = $1',
        [restaurantId]
      );
    }

    if (adminId !== undefined) {
      await db.none(
        'DELETE FROM users WHERE id = $1',
        [adminId]
      );
    }

    if (
      restaurantId !== undefined &&
      otherRestaurantId !== undefined
    ) {
      await db.none(
        'DELETE FROM restaurants WHERE id IN ($1, $2)',
        [restaurantId, otherRestaurantId]
      );
    }
  } finally {
    try {
      await closeMongo();
    } finally {
      await db.$pool.end();
    }
  }
});

describe('POST /restaurants/:id/feedback', () => {
  it('stores valid feedback in MongoDB', async () => {
    const res = await request(app)
      .post(`/restaurants/${restaurantId}/feedback`)
      .type('form')
      .send({
        customerName: 'Pema',
        rating: '5',
        comment: 'Great momos',
      });

    expect(res.status).toBe(302);

    const docs =
      await Feedback.getFeedbackForRestaurant(restaurantId);

    const saved = docs.find(
      d => d.comment === 'Great momos'
    );

    expect(saved).toBeDefined();
    expect(Number(saved.rating)).toBe(5);
    expect(String(saved.restaurantId))
      .toBe(String(restaurantId));
  });

  it('rejects an invalid rating without saving feedback', async () => {
    const before =
      await Feedback.getFeedbackForRestaurant(otherRestaurantId);

    await request(app)
      .post(`/restaurants/${otherRestaurantId}/feedback`)
      .type('form')
      .send({
        customerName: 'Pema',
        rating: '9',
        comment: 'Invalid rating',
      });

    const after =
      await Feedback.getFeedbackForRestaurant(otherRestaurantId);

    expect(after.length).toBe(before.length);
  });

  it('returns 404 when the restaurant does not exist', async () => {
    const res = await request(app)
      .post('/restaurants/999999/feedback')
      .type('form')
      .send({
        customerName: 'Pema',
        rating: '4',
        comment: 'Ghost restaurant',
      });

    expect(res.status).toBe(404);

    const mongo = await connectMongo();

    const count = await mongo
      .collection('feedback')
      .countDocuments({ restaurantId: 999999 });

    expect(count).toBe(0);
  });
});

describe('GET /admin/dashboard', () => {
  it('shows the admin their restaurant feedback without exposing another restaurant feedback', async () => {
    await Feedback.createFeedback({
      restaurantId,
      customerName: 'Dorji',
      rating: 4,
      comment: 'Seen on dashboard',
    });

    await Feedback.createFeedback({
      restaurantId: otherRestaurantId,
      customerName: 'Dorji',
      rating: 1,
      comment: 'Secret other cafe',
    });

    const agent = request.agent(app);

    const loginRes = await agent
      .post('/login')
      .type('form')
      .send({
        email: adminEmail,
        password: 'adminpass123',
      });

    expect([200, 302]).toContain(loginRes.status);

    const res = await agent.get('/admin/dashboard');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Feedback Cafe');
    expect(res.text).toContain('Seen on dashboard');
    expect(res.text).not.toContain('Secret other cafe');
  });
});
